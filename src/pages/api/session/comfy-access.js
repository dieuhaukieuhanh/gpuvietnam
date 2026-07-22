import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  isComfyProxyEnabled,
  resolveComfyProxyBaseUrl,
  issueComfyAccessToken,
} from '@/lib/comfy-proxy';
import { encodeComfyCpBootstrapHash } from '@/lib/cp-runtime/comfy-graph-document';
import { ensureActiveCpWorkflow } from '@/lib/cp-runtime/ensure-active-workflow';
import { buildConsumerEndpoint } from '@/lib/endpoint-utils';
import { getActiveMachineForUser } from '@/lib/machines';
import { isProjectionTrafficReady } from '@/lib/scb-read-path';

/**
 * POST /api/session/comfy-access
 *
 * Body (optional):
 *   { mode?: 'editor' | 'runtime' }
 *
 * - mode=editor (or no running machine): A1 M1 editor-only token (upstream=null)
 * - otherwise: runtime token bound to active machine upstream
 *
 * Mint a short-lived brand-domain work URL (Level C proxy). Upstream never returned.
 * Also ensures a CP workflow exists for Comfy ↔ CP sync.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isComfyProxyEnabled()) {
    return res.status(503).json({
      error: 'Comfy proxy chưa bật.',
      code: 'COMFY_PROXY_DISABLED',
    });
  }

  if (!resolveComfyProxyBaseUrl()) {
    return res.status(503).json({
      error: 'COMFY_PROXY_BASE_URL chưa cấu hình.',
      code: 'COMFY_PROXY_BASE_MISSING',
    });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const wantEditor = String(body.mode || '').toLowerCase() === 'editor';

    const supabaseAdmin = getSupabaseAdmin();
    const machine = await getActiveMachineForUser(supabaseAdmin, user.id);

    /** @type {'editor' | 'runtime'} */
    let mode = 'editor';
    /** @type {string | null} */
    let machineId = null;
    /** @type {string | null} */
    let upstreamUrl = null;

    if (!wantEditor && machine) {
      const healthOk = isProjectionTrafficReady(machine);
      const endpoint = buildConsumerEndpoint(machine, healthOk);
      if (endpoint.comfyUrl) {
        mode = 'runtime';
        machineId = String(machine.id);
        upstreamUrl = endpoint.comfyUrl;
      }
    }

    if (wantEditor) {
      mode = 'editor';
      machineId = null;
      upstreamUrl = null;
    }

    if (mode === 'runtime' && !upstreamUrl) {
      return res.status(409).json({
        error: 'ComfyUI chưa sẵn sàng. Thử lại sau vài giây — hoặc mở Workspace offline (mode=editor).',
        code: 'COMFY_NOT_READY',
      });
    }

    const issued = await issueComfyAccessToken(supabaseAdmin, {
      userId: user.id,
      machineId,
      upstreamUrl,
      mode,
    });

    let workflowId = null;
    let revision = null;
    try {
      const workflow = await ensureActiveCpWorkflow(supabaseAdmin, user.id);
      workflowId = workflow?.id ?? null;
      revision = workflow?.revision != null ? Number(workflow.revision) : null;
    } catch (ensureErr) {
      console.warn(
        '[session/comfy-access] ensure workflow skipped',
        ensureErr instanceof Error ? ensureErr.message : ensureErr,
      );
    }

    const apiBase = resolvePublicAppOrigin(req);
    const bootstrapHash = encodeComfyCpBootstrapHash({
      token: issued.token,
      workflowId,
      apiBase,
      revision,
    });
    const workUrl = `${issued.workUrl}#${bootstrapHash}`;

    return res.status(200).json({
      workUrl,
      expiresAt: issued.expiresAt,
      mode: issued.mode,
      runtimeOnline: issued.mode === 'runtime',
      cpSync: {
        workflowId,
        revision,
        apiBase,
        syncPath: '/gpuvietnam/cp/sync',
      },
    });
  } catch (error) {
    console.error('[session/comfy-access]', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Không tạo được link ComfyUI.',
    });
  }
}

/**
 * Public origin of the Next app (for extension fallback when Worker CP route misses).
 * @param {import('next').NextApiRequest} req
 */
function resolvePublicAppOrigin(req) {
  const fromEnv = String(
    process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_PUBLIC_URL ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL ||
      '',
  )
    .trim()
    .replace(/\/$/, '');
  if (fromEnv) {
    if (fromEnv.startsWith('http://') || fromEnv.startsWith('https://')) return fromEnv;
    return `https://${fromEnv}`;
  }
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
  if (!host) return null;
  return `${proto}://${host}`;
}

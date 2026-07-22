/**
 * Runtime / proxy rebind after GPU change (B2.3).
 * Revoke old Comfy access tokens for machine and mint a new work.* URL.
 */

import {
  issueComfyAccessToken,
  normalizeUpstreamComfyUrl,
  revokeComfyAccessTokensForMachine,
} from '../comfy-proxy/comfy-access-token.js';
import { isComfyProxyEnabled } from '../comfy-proxy/comfy-proxy-config.js';
import { encodeComfyCpBootstrapHash } from './comfy-graph-document.js';
import { ensureActiveCpWorkflow } from './ensure-active-workflow.js';

/**
 * @param {{
 *   previousUpstreamUrl?: string | null;
 *   nextUpstreamUrl: string;
 *   machineId?: string | null;
 *   runtimeId?: string | null;
 * }} input
 */
export function buildRuntimeRebindPlan(input) {
  const next = normalizeUpstreamComfyUrl(input.nextUpstreamUrl);
  const prev = input.previousUpstreamUrl
    ? normalizeUpstreamComfyUrl(input.previousUpstreamUrl)
    : null;

  if (!next) {
    return {
      ok: false,
      code: 'INVALID_UPSTREAM',
      message: 'nextUpstreamUrl không hợp lệ',
      changed: false,
      nextUpstreamUrl: null,
      previousUpstreamUrl: prev,
    };
  }

  const changed = !prev || prev !== next;
  return {
    ok: true,
    code: 'ok',
    message: changed
      ? 'Cần rebind proxy/token tới Runtime mới'
      : 'Upstream không đổi — có thể giữ token hiện tại',
    changed,
    nextUpstreamUrl: next,
    previousUpstreamUrl: prev,
    machineId: input.machineId ?? null,
    runtimeId: input.runtimeId ?? null,
    proxyEnabled: isComfyProxyEnabled(),
  };
}

/**
 * Execute rebind: revoke machine tokens (if machineId) + issue new work URL.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   userId: string;
 *   machineId: string;
 *   nextUpstreamUrl: string;
 *   previousUpstreamUrl?: string | null;
 *   runtimeId?: string | null;
 *   ttlSeconds?: number;
 * }} input
 */
export async function rebindComfyProxyToRuntime(supabaseAdmin, input) {
  const userId = String(input.userId ?? '').trim();
  const machineId = String(input.machineId ?? '').trim();
  if (!userId || !machineId) {
    throw new Error('rebindComfyProxyToRuntime: userId and machineId required');
  }

  const plan = buildRuntimeRebindPlan({
    previousUpstreamUrl: input.previousUpstreamUrl,
    nextUpstreamUrl: input.nextUpstreamUrl,
    machineId,
    runtimeId: input.runtimeId,
  });

  if (!plan.ok || !plan.nextUpstreamUrl) {
    throw new Error(plan.message || 'Invalid rebind plan');
  }

  if (!plan.proxyEnabled) {
    return {
      plan,
      workUrl: plan.nextUpstreamUrl,
      token: null,
      expiresAt: null,
      revoked: false,
      mode: 'direct_upstream',
    };
  }

  await revokeComfyAccessTokensForMachine(supabaseAdmin, machineId);

  const issued = await issueComfyAccessToken(supabaseAdmin, {
    userId,
    machineId,
    upstreamUrl: plan.nextUpstreamUrl,
    ttlSeconds: input.ttlSeconds,
  });

  let workflowId = null;
  let revision = null;
  try {
    const workflow = await ensureActiveCpWorkflow(supabaseAdmin, userId);
    workflowId = workflow?.id ?? null;
    revision = workflow?.revision != null ? Number(workflow.revision) : null;
  } catch {
    /* CP tables optional until migration */
  }

  const apiBase = String(
    process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_PUBLIC_URL ||
      process.env.GPUVIETNAM_PUBLIC_API_URL ||
      '',
  )
    .trim()
    .replace(/\/$/, '');

  const bootstrapHash = encodeComfyCpBootstrapHash({
    token: issued.token,
    workflowId,
    apiBase: apiBase || null,
    revision,
  });
  const workUrl = `${issued.workUrl}#${bootstrapHash}`;

  return {
    plan,
    workUrl,
    token: issued.token,
    expiresAt: issued.expiresAt,
    revoked: true,
    mode: 'proxy_rebind',
    cpSync: { workflowId, revision, apiBase: apiBase || null, syncPath: '/gpuvietnam/cp/sync' },
  };
}

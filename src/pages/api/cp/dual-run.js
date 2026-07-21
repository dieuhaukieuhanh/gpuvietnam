import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { buildDualRunUxState, estimateDualRunCustomerCharge } from '@/lib/cp-runtime/dual-run-policy';

/**
 * B3.1 / B3.3 — Dual-run (“Render an toàn”) UX + estimate.
 * GET  /api/cp/dual-run?planKey=&enabled=&hosts=
 * POST /api/cp/dual-run { planKey, enabled, availableHostCount, winnerMinutes?, loserMinutes?, ratePerMinute? }
 */
export default async function handler(req, res) {
  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorized(res);

  try {
    if (req.method === 'GET') {
      const ux = buildDualRunUxState({
        planKey: req.query?.planKey ? String(req.query.planKey) : null,
        enabled: String(req.query?.enabled ?? '') === '1',
        availableHostCount: req.query?.hosts != null ? Number(req.query.hosts) : null,
      });
      return res.status(200).json({ dualRun: ux });
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const ux = buildDualRunUxState({
        planKey: body.planKey ?? null,
        enabled: Boolean(body.enabled),
        availableHostCount:
          body.availableHostCount != null ? Number(body.availableHostCount) : null,
      });

      let estimate = null;
      if (body.winnerMinutes != null && body.ratePerMinute != null) {
        estimate = estimateDualRunCustomerCharge({
          winnerMinutes: Number(body.winnerMinutes),
          loserMinutes: Number(body.loserMinutes ?? 0),
          singleRatePerMinute: Number(body.ratePerMinute),
        });
      }

      return res.status(200).json({
        dualRun: ux,
        estimate,
        executionPolicy: ux.enabled ? 'dual_run' : 'single',
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[api/cp/dual-run]', message);
    return res.status(500).json({ error: 'Không tải được cấu hình Render an toàn.' });
  }
}

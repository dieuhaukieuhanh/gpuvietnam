import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import {
  applyDualRunPriceMultiplier,
  buildDualRunUxState,
  estimateDualRunCustomerCharge,
} from '@/lib/cp-runtime/dual-run-policy';
import {
  evaluateDualRunCapacity,
  probeDualRunDistinctHostCount,
  resolveDualRunGpuLine,
} from '@/lib/cp-runtime/dual-run-capacity';
import { loadGpuPricingConfig } from '@/lib/gpu-pricing-config';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * B3 — Dual-run (“Render an toàn”) UX + capacity + estimate.
 * GET  /api/cp/dual-run?planKey=&gpuLine=&enabled=&hosts=&probe=
 * POST /api/cp/dual-run { planKey, gpuLine, activeGpuLine, enabled, availableHostCount, ... }
 */
export default async function handler(req, res) {
  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorized(res);

  try {
    const pricing = await loadGpuPricingConfig(getSupabaseAdmin());
    const billing = pricing?.dualRun;

    if (req.method === 'GET') {
      const planKey = req.query?.planKey ? String(req.query.planKey) : null;
      const gpuLine = resolveDualRunGpuLine({
        activeGpuLine: req.query?.activeGpuLine ? String(req.query.activeGpuLine) : null,
        gpuLine: req.query?.gpuLine ? String(req.query.gpuLine) : null,
        planKey,
      });
      const wantProbe = String(req.query?.probe ?? '') === '1';
      let availableHostCount =
        req.query?.hosts != null ? Number(req.query.hosts) : null;
      let capacityMessage = null;
      let capacity = null;

      if (wantProbe && gpuLine) {
        const probed = await probeDualRunDistinctHostCount({ gpuLine, planKey });
        if (probed) {
          availableHostCount = probed.distinctHostCount;
          capacity = evaluateDualRunCapacity({ distinctHostCount: availableHostCount });
          capacityMessage = capacity.message;
        }
      } else if (availableHostCount != null) {
        capacity = evaluateDualRunCapacity({ distinctHostCount: availableHostCount });
        capacityMessage = capacity.message;
      }

      const ux = buildDualRunUxState({
        planKey,
        enabled: String(req.query?.enabled ?? '') === '1',
        availableHostCount,
        billing,
        gpuLine,
        capacityMessage,
      });
      return res.status(200).json({ dualRun: ux, capacity });
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const planKey = body.planKey ?? null;
      const gpuLine = resolveDualRunGpuLine({
        activeGpuLine: body.activeGpuLine ?? null,
        gpuLine: body.gpuLine ?? null,
        planKey,
      });

      let availableHostCount =
        body.availableHostCount != null ? Number(body.availableHostCount) : null;
      let capacity = null;
      let capacityMessage = null;

      // When enabling: probe marketplace unless client already supplied a count.
      if (Boolean(body.enabled) && availableHostCount == null && gpuLine) {
        const probed = await probeDualRunDistinctHostCount({ gpuLine, planKey });
        if (probed) {
          availableHostCount = probed.distinctHostCount;
        } else if (
          String(process.env.GPUVIETNAM_DUAL_RUN_SKIP_CAPACITY_PROBE ?? '').trim() !== '1'
        ) {
          const uxBlocked = buildDualRunUxState({
            planKey,
            enabled: false,
            availableHostCount: 0,
            billing,
            gpuLine,
            capacityMessage:
              'Không kiểm tra được marketplace. Thử lại sau — chưa bật Render an toàn.',
          });
          return res.status(200).json({
            dualRun: uxBlocked,
            capacity: evaluateDualRunCapacity({ distinctHostCount: 0 }),
            executionPolicy: 'single',
            blocked: true,
          });
        }
      }

      if (availableHostCount != null) {
        capacity = evaluateDualRunCapacity({ distinctHostCount: availableHostCount });
        capacityMessage = capacity.message;
        if (Boolean(body.enabled) && capacity.ok === false) {
          const uxBlocked = buildDualRunUxState({
            planKey,
            enabled: false,
            availableHostCount,
            billing,
            gpuLine,
            capacityMessage,
          });
          return res.status(200).json({
            dualRun: uxBlocked,
            capacity,
            executionPolicy: 'single',
            blocked: true,
          });
        }
      }

      const ux = buildDualRunUxState({
        planKey,
        enabled: Boolean(body.enabled),
        availableHostCount,
        billing,
        gpuLine,
        capacityMessage,
      });

      let estimate = null;
      if (body.winnerMinutes != null && body.ratePerMinute != null) {
        estimate = estimateDualRunCustomerCharge(
          {
            winnerMinutes: Number(body.winnerMinutes),
            loserMinutes: Number(body.loserMinutes ?? 0),
            singleRatePerMinute: Number(body.ratePerMinute),
          },
          billing,
        );
      } else if (body.singleSessionCharge != null) {
        estimate = applyDualRunPriceMultiplier(Number(body.singleSessionCharge), billing);
      }

      return res.status(200).json({
        dualRun: ux,
        capacity,
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

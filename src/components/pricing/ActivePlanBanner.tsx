import Link from 'next/link';
import { buildDashboardActivateUrl } from '@/lib/active-plan-gate';
import { useActivePlanGate } from '@/hooks/useActivePlanGate';

export default function ActivePlanBanner() {
  const { hasActivePlan, planName, loaded } = useActivePlanGate();

  if (!loaded || !hasActivePlan || !planName) return null;

  return (
    <div className="active-plan-banner">
      <div className="active-plan-banner-inner">
        <p>
          Bạn đã có gói <strong>{planName}</strong> đang hoạt động
        </p>
        <Link href={buildDashboardActivateUrl()} className="btn btn-dashboard-go">
          🚀 Vào Dashboard
        </Link>
      </div>
    </div>
  );
}

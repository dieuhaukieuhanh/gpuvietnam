import PublicHeader from '@/components/layout/PublicHeader';
import PublicFooter from '@/components/layout/PublicFooter';
import ActivePlanBanner from '@/components/pricing/ActivePlanBanner';
import HomePricingSection from '@/components/pricing/HomePricingSection';
import { useTrialWorkstationModal } from '@/hooks/useTrialWorkstationModal';
import { routes } from '@/lib/routes';

export default function PricingPage() {
  const { openTrialModal, trialModal } = useTrialWorkstationModal();

  return (
    <>
      <PublicHeader activeHref={routes.bangGia} />

      <ActivePlanBanner />

      <div className="pricing-standalone-wrap">
        <HomePricingSection variant="standalone" onStarterTrial={openTrialModal} />
      </div>

      {trialModal}
      <PublicFooter />
    </>
  );
}

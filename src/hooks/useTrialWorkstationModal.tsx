import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import WorkstationCard from '@/components/workstations/WorkstationCard';
import { routes } from '@/lib/routes';
import { WORKSTATIONS, type Workstation } from '@/lib/workstations';

function contactCustomWorkstation() {
  alert(
    '🎯 Workstation Theo Yêu Cầu\n\n📱 Nhắn Zalo: 0961 862 141 mô tả nhu cầu của bạn.\nChúng tôi sẽ tạo môi trường riêng trong 24h — miễn phí setup.',
  );
}

export function useTrialWorkstationModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'pick' | 'auth-choice'>('pick');
  const [pendingWorkstation, setPendingWorkstation] = useState<Workstation | null>(null);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const buildTrialAuthUrl = useCallback((path: string, workstation: Workstation) => {
    const params = new URLSearchParams({
      trial: 'true',
      workstation: workstation.name,
      env: workstation.name,
      icon: workstation.icon,
      desc: workstation.desc,
    });
    return `${path}?${params.toString()}`;
  }, []);

  const openTrialModal = useCallback(() => {
    setStep('pick');
    setPendingWorkstation(null);
    setOpen(true);
  }, []);

  const closeTrialModal = useCallback(() => {
    setOpen(false);
    setStep('pick');
    setPendingWorkstation(null);
  }, []);

  const handleWorkstationSelect = useCallback(
    (workstation: Workstation) => {
      if (workstation.id === 6) {
        closeTrialModal();
        contactCustomWorkstation();
        return;
      }
      setPendingWorkstation(workstation);
      setStep('auth-choice');
    },
    [closeTrialModal],
  );

  const modal = (
    <div
      className={`modal-overlay${open ? ' active' : ''}`}
      id="workstationModal"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeTrialModal();
      }}
    >
      <div className="modal modal-workstation">
        <button type="button" className="close-btn" aria-label="Đóng" onClick={closeTrialModal}>
          ✕
        </button>
        {step === 'pick' ? (
          <>
            <div className="modal-workstation-header">
              <h3>🎁 Chọn môi trường dùng thử</h3>
              <p>Chọn nhu cầu phù hợp để dùng thử 3 giờ GPU miễn phí</p>
            </div>
            <div className="modal-workstation-grid">
              {WORKSTATIONS.filter((w) => w.id !== 6).map((workstation) => (
                <WorkstationCard
                  key={workstation.id}
                  workstation={workstation}
                  onSelect={handleWorkstationSelect}
                />
              ))}
            </div>
          </>
        ) : (
          pendingWorkstation && (
            <div style={{ padding: '8px 0 0' }}>
              <div className="modal-workstation-header">
                <h3>🎁 Dùng thử 3 giờ miễn phí</h3>
                <p>
                  Môi trường: <strong>{pendingWorkstation.name}</strong>
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 20 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    closeTrialModal();
                    router.push(buildTrialAuthUrl(routes.register, pendingWorkstation));
                  }}
                >
                  Tôi là khách hàng mới — Đăng ký
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    closeTrialModal();
                    router.push(buildTrialAuthUrl(routes.login, pendingWorkstation));
                  }}
                >
                  Tôi đã có tài khoản — Đăng nhập
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setStep('pick')}
                  style={{ marginTop: 8 }}
                >
                  ← Chọn môi trường khác
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );

  return { openTrialModal, closeTrialModal, trialModal: modal };
}

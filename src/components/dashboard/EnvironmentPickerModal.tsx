import { useEffect } from 'react';
import { WORKSTATIONS, type Workstation } from '@/lib/workstations';
import { GPU_COMFY_WORKSTATION_IDS } from '@/lib/workstation-env';

type EnvironmentPickerModalProps = {
  open: boolean;
  currentEnvName: string;
  loading?: boolean;
  machineRunning?: boolean;
  onClose: () => void;
  onSelect: (workstation: Workstation) => void;
};

function contactCustomWorkstation() {
  window.alert(
    '🎯 Workstation Theo Yêu Cầu\n\n📱 Nhắn Zalo: 0961 862 141 mô tả nhu cầu của bạn.\nChúng tôi sẽ tạo môi trường riêng trong 24h — miễn phí setup.',
  );
}

export default function EnvironmentPickerModal({
  open,
  currentEnvName,
  loading = false,
  machineRunning = false,
  onClose,
  onSelect,
}: EnvironmentPickerModalProps) {
  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose();
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, loading, onClose]);

  if (!open) return null;

  const handlePick = (workstation: Workstation) => {
    if (loading) return;
    if (workstation.id === 6) {
      contactCustomWorkstation();
      return;
    }
    if (!GPU_COMFY_WORKSTATION_IDS.includes(workstation.id)) {
      window.alert(`${workstation.name} chưa khả dụng. Hiện hỗ trợ 3 môi trường ComfyUI: Character & Art, Commerce & Product, Video AI.`);
      return;
    }
    if (workstation.name === currentEnvName) {
      onClose();
      return;
    }
    onSelect(workstation);
  };

  return (
    <div
      className="modal-overlay active"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div className="env-modal-box" role="dialog" aria-modal="true" aria-labelledby="env-picker-title">
        <div className="env-modal-header">
          <div>
            <h3 id="env-picker-title">🖥️ Chọn môi trường làm việc</h3>
            <p>
              {machineRunning
                ? 'Mỗi môi trường có bộ workflow ComfyUI riêng. Chọn môi trường — hệ thống sẽ áp dụng ngay nếu có thể.'
                : 'Mỗi môi trường có bộ workflow ComfyUI riêng — áp dụng khi bạn mở phòng làm việc.'}
            </p>
          </div>
          <button
            type="button"
            className="env-modal-close"
            aria-label="Đóng"
            disabled={loading}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="env-picker-grid">
          {WORKSTATIONS.map((workstation) => {
            const isSupported = GPU_COMFY_WORKSTATION_IDS.includes(workstation.id);
            const isCustom = workstation.id === 6;
            const isComingSoon = !isSupported && !isCustom;

            return (
            <button
              key={workstation.id}
              type="button"
              className={`env-picker-card${currentEnvName === workstation.name ? ' selected' : ''}${
                isCustom ? ' env-picker-card-custom' : ''
              }${isComingSoon ? ' env-picker-card-disabled' : ''}`}
              disabled={loading || isComingSoon}
              onClick={() => handlePick(workstation)}
            >
              <span className="env-picker-icon">{workstation.icon}</span>
              <h4>{workstation.name}</h4>
              <p>{workstation.desc}</p>
              {isComingSoon && (
                <span className="env-picker-soon">Sắp ra mắt</span>
              )}
            </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

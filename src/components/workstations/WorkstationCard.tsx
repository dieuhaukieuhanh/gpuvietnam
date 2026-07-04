import type { Workstation } from '@/lib/workstations';

type WorkstationCardProps = {
  workstation: Workstation;
  onSelect: (workstation: Workstation) => void;
};

export default function WorkstationCard({ workstation, onSelect }: WorkstationCardProps) {
  return (
    <div className="workstation-card-wrapper">
      <div
        className="workstation-card"
        role="button"
        tabIndex={0}
        onClick={() => onSelect(workstation)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(workstation);
          }
        }}
        style={
          workstation.id === 6
            ? {
                borderStyle: 'dashed',
                borderColor: 'var(--accent-purple)',
                cursor: 'pointer',
              }
            : { cursor: 'pointer' }
        }
      >
        <div className="workstation-image">
          <span>{workstation.icon}</span>
          <span className="gpu-badge">{workstation.badge}</span>
          {workstation.id !== 6 && <span className="overlay-tag">{workstation.tag}</span>}
        </div>
        <div className="workstation-info">
          <h4>{workstation.name}</h4>
          <p className="desc">{workstation.desc}</p>
          <div className="workstation-meta">
            {workstation.id === 6 ? (
              <>
                <span className="tag purple">Tùy chỉnh</span>
                <span>📱 Nhắn Zalo</span>
              </>
            ) : (
              <>
                <span>⚡ {workstation.time}</span>
                <span>🖥️ {workstation.gpu}</span>
                <span className={`tag ${workstation.color}`}>{workstation.difficulty}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

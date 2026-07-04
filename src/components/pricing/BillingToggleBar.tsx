import { BILLING_TOGGLES, type BillingMode } from '@/lib/checkout-plans';
import { styles } from '@/styles/components/billing-toggle.styles';

export type BillingToggleItem = { mode: BillingMode; label: string };

export type BillingToggleBarProps = {
  value: BillingMode;
  onChange: (mode: BillingMode) => void;
  toggles?: BillingToggleItem[];
};

export default function BillingToggleBar({ value, onChange, toggles = BILLING_TOGGLES }: BillingToggleBarProps) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="billing-toggle-bar">
        <div className="billing-hours-label-card">Chọn số giờ sử dụng</div>
        <div className="billing-hours-arrow" aria-hidden="true">
          ▶
        </div>
        <div className="billing-toggle-group" role="group" aria-label="Chọn số giờ sử dụng">
          {toggles.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              className={`billing-toggle-btn${value === mode ? ' active' : ''}`}
              id={`toggle${mode.charAt(0).toUpperCase()}${mode.slice(1)}`}
              aria-pressed={value === mode}
              onClick={() => onChange(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

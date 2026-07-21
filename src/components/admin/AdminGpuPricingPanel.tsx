import { useCallback, useEffect, useMemo, useState } from 'react';
import BillingToggleBar from '@/components/pricing/BillingToggleBar';
import {
  buildBillingToggleLabels,
  buildPlanPricingDisplayFromPlan,
  getDefaultGpuPricingConfig,
  normalizeGpuPricingConfig,
  CANONICAL_VALIDITY_DAYS,
} from '@/lib/gpu-pricing-config';
import type { GpuPricingConfig } from '@/lib/gpu-pricing-types';
import type { BillingMode } from '@/lib/checkout-plans';
import { adminFetch } from '@/lib/admin-session';
import { styles as checkoutStyles } from '@/styles/pages/checkout-1.styles';
import { adminGpuPricingStyles } from '@/styles/pages/admin-gpu-pricing.styles';

function withSyncedBillingToggles(config: GpuPricingConfig): GpuPricingConfig {
  return {
    ...config,
    billingToggles: buildBillingToggleLabels(config) as GpuPricingConfig['billingToggles'],
  };
}

function cloneConfig(config: GpuPricingConfig): GpuPricingConfig {
  return structuredClone(config);
}

function configsEqual(a: GpuPricingConfig, b: GpuPricingConfig) {
  return JSON.stringify(a) === JSON.stringify(b);
}

type TextInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Optional — trim / normalize after typing so spaces are not eaten on each keystroke. */
  onBlur?: (value: string) => void;
  multiline?: boolean;
  mono?: boolean;
};

function TextInput({ label, value, onChange, onBlur, multiline, mono }: TextInputProps) {
  const className = `gpu-edit-field${mono ? ' mono' : ''}`;
  return (
    <label className="gpu-edit-label">
      <span>{label}</span>
      {multiline ? (
        <textarea
          className={className}
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onBlur?.(e.target.value)}
        />
      ) : (
        <input
          className={className}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onBlur?.(e.target.value)}
        />
      )}
    </label>
  );
}

type NumberInputProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
};

function NumberInput({ label, value, onChange, disabled, min = 0, max, step }: NumberInputProps) {
  return (
    <label className="gpu-edit-label">
      <span>{label}</span>
      <input
        className="gpu-edit-field mono"
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        disabled={disabled}
      />
    </label>
  );
}

function formatVndInput(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '';
  if (value === 0) return '0';
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value);
}

function parseVndDigits(value: string): number {
  const digits = value.replace(/\D/g, '');
  if (!digits) return 0;
  const num = Number(digits);
  return Number.isFinite(num) ? num : 0;
}

function VndPriceInput({ label, value, onChange }: NumberInputProps) {
  const [text, setText] = useState(() => formatVndInput(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setText(formatVndInput(value));
    }
  }, [value, focused]);

  return (
    <label className="gpu-edit-label gpu-edit-price-field">
      <span>{label}</span>
      <div className="gpu-edit-vnd-wrap">
        <input
          className="gpu-edit-field mono gpu-edit-vnd-input"
          type="text"
          inputMode="numeric"
          placeholder="0"
          value={text}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            const raw = e.target.value;
            const parsed = parseVndDigits(raw);
            if (!raw.replace(/\D/g, '')) {
              setText('');
              onChange(0);
              return;
            }
            setText(formatVndInput(parsed));
            onChange(parsed);
          }}
          onBlur={() => {
            setFocused(false);
            setText(formatVndInput(value));
          }}
        />
        <span className="gpu-edit-vnd-suffix">đ</span>
      </div>
    </label>
  );
}

function getPreviewPriceAmount(
  plan: GpuPricingConfig['plans'][number],
  billing: BillingMode,
): number {
  if (billing === 'hourly') return plan.pricePerHour;
  if (billing === 'combo1') return plan.combo1.price;
  return plan.combo2.price;
}

function formatPreviewPriceAmount(amount: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(
    Number.isFinite(amount) ? amount : 0,
  );
}

export default function AdminGpuPricingPanel() {
  const [saved, setSaved] = useState<GpuPricingConfig>(
    () => getDefaultGpuPricingConfig() as GpuPricingConfig,
  );
  const [draft, setDraft] = useState<GpuPricingConfig>(
    () => getDefaultGpuPricingConfig() as GpuPricingConfig,
  );
  const [previewBilling, setPreviewBilling] = useState<BillingMode>('hourly');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const hasChanges = useMemo(() => !configsEqual(saved, draft), [saved, draft]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const res = await adminFetch('/api/admin/gpu-pricing');
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Không tải được bảng giá.');
        return;
      }

      const config = normalizeGpuPricingConfig(data.config) as GpuPricingConfig;
      setSaved(config);
      setDraft(cloneConfig(config));
    } catch {
      setError('Lỗi mạng khi tải bảng giá.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const updateSection = (field: keyof GpuPricingConfig['section'], value: string) => {
    setDraft((prev) => ({
      ...prev,
      section: { ...prev.section, [field]: value },
    }));
  };

  const updateDualRun = (patch: Partial<GpuPricingConfig['dualRun']>) => {
    setDraft((prev) => ({
      ...prev,
      dualRun: { ...prev.dualRun, ...patch },
    }));
  };

  const updatePlan = (planIndex: number, patch: Partial<GpuPricingConfig['plans'][number]>) => {
    setDraft((prev) =>
      withSyncedBillingToggles({
        ...prev,
        plans: prev.plans.map((plan, i) =>
          i === planIndex ? ({ ...plan, ...patch } as GpuPricingConfig['plans'][number]) : plan,
        ),
      }),
    );
  };

  const updatePlanListItem = (
    planIndex: number,
    field: 'bestFor' | 'trust',
    itemIndex: number,
    value: string,
  ) => {
    setDraft((prev) => ({
      ...prev,
      plans: prev.plans.map((plan, i) => {
        if (i !== planIndex) return plan;
        const list = [...plan[field]];
        list[itemIndex] = value;
        return { ...plan, [field]: list };
      }),
    }));
  };

  const addPlanListItem = (planIndex: number, field: 'bestFor' | 'trust') => {
    setDraft((prev) => ({
      ...prev,
      plans: prev.plans.map((plan, i) =>
        i === planIndex ? { ...plan, [field]: [...plan[field], 'Mục mới'] } : plan,
      ),
    }));
  };

  const removePlanListItem = (planIndex: number, field: 'bestFor' | 'trust', itemIndex: number) => {
    setDraft((prev) => ({
      ...prev,
      plans: prev.plans.map((plan, i) => {
        if (i !== planIndex) return plan;
        return { ...plan, [field]: plan[field].filter((_, idx) => idx !== itemIndex) };
      }),
    }));
  };

  const updateAudience = (
    planIndex: number,
    itemIndex: number,
    field: 'icon' | 'label',
    value: string,
  ) => {
    setDraft((prev) => ({
      ...prev,
      plans: prev.plans.map((plan, i) => {
        if (i !== planIndex) return plan;
        const list = plan.bestForAudience.map((item, idx) =>
          idx === itemIndex ? { ...item, [field]: value } : item,
        );
        return { ...plan, bestForAudience: list };
      }),
    }));
  };

  const updateFeature = (
    planIndex: number,
    itemIndex: number,
    field: 'text' | 'included',
    value: string | boolean,
  ) => {
    setDraft((prev) => ({
      ...prev,
      plans: prev.plans.map((plan, i) => {
        if (i !== planIndex) return plan;
        const list = plan.features.map((item, idx) =>
          idx === itemIndex ? { ...item, [field]: value } : item,
        );
        return { ...plan, features: list };
      }),
    }));
  };

  const handleUndo = () => {
    setDraft(cloneConfig(saved));
    setToast('Đã hoàn tác thay đổi chưa lưu');
  };

  const handleCancel = () => {
    if (hasChanges && !confirm('Hủy mọi thay đổi chưa lưu?')) return;
    setDraft(cloneConfig(saved));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = normalizeGpuPricingConfig(draft);
      const res = await adminFetch('/api/admin/gpu-pricing', {
        method: 'PUT',
        body: JSON.stringify({ config: payload }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error ?? 'Cập nhật thất bại.');
        return;
      }

      const config = normalizeGpuPricingConfig(data.config) as GpuPricingConfig;
      setSaved(config);
      setDraft(cloneConfig(config));
      setToast('Đã cập nhật bảng giá GPU');
    } catch {
      alert('Lỗi mạng khi lưu.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <p className="text-muted">Đang tải bảng giá GPU...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <p className="text-red">{error}</p>
        <button type="button" className="btn" style={{ marginTop: 12 }} onClick={loadConfig}>
          Thử lại
        </button>
      </div>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: checkoutStyles }} />
      <style dangerouslySetInnerHTML={{ __html: adminGpuPricingStyles }} />

      <div className="card gpu-edit-intro">
        <div className="stat-label">Edit giá GPU</div>
        <div className="stat-sub" style={{ marginTop: 8, lineHeight: 1.6 }}>
          Giao diện giống bảng giá công khai — sửa câu chữ, thông số và giá trực tiếp. Bấm{' '}
          <strong>Cập nhật</strong> để lưu lên hệ thống, <strong>Hoàn tác</strong> để quay về bản
          đã lưu, <strong>Hủy</strong> để bỏ thay đổi.
        </div>
      </div>

      <div className="gpu-edit-section card">
        <h3 className="gpu-edit-section-title">Tiêu đề section</h3>
        <div className="gpu-edit-grid-2">
          <TextInput
            label="Tiêu đề"
            value={draft.section.title}
            onChange={(v) => updateSection('title', v)}
          />
          <TextInput
            label="Ghi chú cuối trang"
            value={draft.section.footerPaymentNote}
            onChange={(v) => updateSection('footerPaymentNote', v)}
          />
        </div>
        <TextInput
          label="Mô tả phụ"
          value={draft.section.subtitle}
          onChange={(v) => updateSection('subtitle', v)}
          multiline
        />
      </div>

      <div className="gpu-edit-section card">
        <h3 className="gpu-edit-section-title">Hiệu lực gói giờ</h3>
        <div className="gpu-edit-grid-3">
          <NumberInput
            label="Giờ lẻ (ngày)"
            value={CANONICAL_VALIDITY_DAYS.hourly}
            onChange={() => undefined}
            disabled
          />
        </div>
        <p className="stat-sub" style={{ marginTop: 8, lineHeight: 1.6 }}>
          Thời hạn đã thống nhất toàn hệ thống: <strong>Giờ lẻ 60 ngày · Combo1 120 ngày · Combo2 180 ngày</strong>.
          Không chỉnh sửa được để tránh lệch hiển thị giữa các trang.
        </p>
        <div className="gpu-edit-grid-3" style={{ marginTop: 12 }}>
          {draft.billingToggles.map((toggle) => (
            <label key={toggle.mode} className="gpu-edit-label">
              <span>{toggle.mode}</span>
              <input className="gpu-edit-field" type="text" value={toggle.label} readOnly />
            </label>
          ))}
        </div>
      </div>

      <div className="gpu-edit-section card">
        <h3 className="gpu-edit-section-title">Render an toàn (dual-run)</h3>
        <p className="stat-sub" style={{ marginTop: 0, marginBottom: 12, lineHeight: 1.6 }}>
          Hệ số giá so với phiên 1 GPU. Ví dụ <strong>1.5</strong> = bằng 1.5 lần giá gốc,{' '}
          <strong>1.65</strong> = 1.65 lần. Trần cứng không cho vượt quá mức đã hứa với khách.
        </p>
        <div className="gpu-edit-grid-3">
          <NumberInput
            label="Hệ số giá (× giá gốc)"
            value={draft.dualRun?.customerMultiplier ?? 1.65}
            onChange={(v) => updateDualRun({ customerMultiplier: v })}
            min={1}
            max={3}
            step={0.01}
          />
          <NumberInput
            label="Trần tối đa (×)"
            value={draft.dualRun?.hardCapMultiplier ?? 1.9}
            onChange={(v) => updateDualRun({ hardCapMultiplier: v })}
            min={1}
            max={5}
            step={0.01}
          />
        </div>
        <p className="stat-sub" style={{ marginTop: 8, lineHeight: 1.6 }}>
          Hiện tại: khách thấy khoảng{' '}
          <strong>{Number(draft.dualRun?.customerMultiplier ?? 1.65).toFixed(2)}×</strong> giá phiên
          thường (tối đa{' '}
          <strong>{Number(draft.dualRun?.hardCapMultiplier ?? 1.9).toFixed(2)}×</strong>).
        </p>
      </div>

      <div className="gpu-edit-preview-wrap">
        <div className="gpu-edit-preview-header">
          <h3 className="gpu-edit-section-title">Xem trước bảng giá</h3>
          <BillingToggleBar
            value={previewBilling}
            onChange={setPreviewBilling}
            toggles={draft.billingToggles as { mode: BillingMode; label: string }[]}
          />
        </div>

        <div className="pricing-grid gpu-edit-plan-grid">
          {draft.plans.map((plan, planIndex) => {
            const pricing = buildPlanPricingDisplayFromPlan(
              plan,
              draft.billingValidity?.hourlyDays ?? 60,
            )[previewBilling];
            const showBadge = plan.featured && (plan.badge ?? 'Phổ biến nhất');

            return (
              <div
                key={plan.planKey}
                className={`plan-card gpu-edit-plan-card${plan.featured ? ' featured' : ''}`}
              >
                {showBadge ? <div className="badge">⭐ {plan.badge ?? 'Phổ biến nhất'}</div> : null}

                <div className="gpu-edit-card-fields">
                  <div className="gpu-edit-row-3">
                    <TextInput
                      label="Icon"
                      value={plan.icon}
                      onChange={(v) => updatePlan(planIndex, { icon: v })}
                    />
                    <TextInput
                      label="Tên gói"
                      value={plan.name}
                      onChange={(v) => updatePlan(planIndex, { name: v })}
                    />
                    <label className="gpu-edit-label gpu-edit-check">
                      <span>Gói nổi bật</span>
                      <input
                        type="checkbox"
                        checked={plan.featured}
                        onChange={(e) => updatePlan(planIndex, { featured: e.target.checked })}
                      />
                    </label>
                  </div>

                  <TextInput
                    label="Tagline"
                    value={plan.tagline}
                    onChange={(v) => updatePlan(planIndex, { tagline: v })}
                  />
                  <TextInput
                    label="Badge (để trống nếu không dùng)"
                    value={plan.badge ?? ''}
                    onChange={(v) => updatePlan(planIndex, { badge: v })}
                    onBlur={(v) => updatePlan(planIndex, { badge: v.trim() || null })}
                  />

                  <p className="plan-label">Đối tượng phù hợp</p>
                  {plan.bestForAudience.map((audience, audienceIndex) => (
                    <div key={audienceIndex} className="gpu-edit-row-2">
                      <TextInput
                        label={`Icon #${audienceIndex + 1}`}
                        value={audience.icon}
                        onChange={(v) => updateAudience(planIndex, audienceIndex, 'icon', v)}
                      />
                      <TextInput
                        label={`Nhãn #${audienceIndex + 1}`}
                        value={audience.label}
                        onChange={(v) => updateAudience(planIndex, audienceIndex, 'label', v)}
                      />
                    </div>
                  ))}

                  <div className="plan-price-row">
                    <div className="plan-price gpu-edit-plan-price">
                      <span className="gpu-edit-plan-price-amount">
                        {formatPreviewPriceAmount(getPreviewPriceAmount(plan, previewBilling))}
                      </span>
                      <span className="gpu-edit-plan-price-currency">
                        đ{pricing.unit}
                      </span>
                    </div>
                    <div className="plan-price-note">{pricing.note}</div>
                  </div>

                  <div className="gpu-edit-price-stack">
                    <VndPriceInput
                      label="Giá lẻ (VNĐ)"
                      value={plan.pricePerHour}
                      onChange={(v) => updatePlan(planIndex, { pricePerHour: v })}
                    />
                    <VndPriceInput
                      label="Combo1 (VNĐ)"
                      value={plan.combo1.price}
                      onChange={(v) =>
                        updatePlan(planIndex, { combo1: { ...plan.combo1, price: v } })
                      }
                    />
                    <VndPriceInput
                      label="Combo2 (VNĐ)"
                      value={plan.combo2.price}
                      onChange={(v) =>
                        updatePlan(planIndex, { combo2: { ...plan.combo2, price: v } })
                      }
                    />
                  </div>

                  <div className="gpu-edit-combo-grid">
                    <NumberInput
                      label="Combo1 giờ"
                      value={plan.combo1.hours}
                      onChange={(v) =>
                        updatePlan(planIndex, { combo1: { ...plan.combo1, hours: v } })
                      }
                    />
                    <NumberInput
                      label="Combo1 tặng"
                      value={plan.combo1.bonus}
                      onChange={(v) =>
                        updatePlan(planIndex, { combo1: { ...plan.combo1, bonus: v } })
                      }
                    />
                    <NumberInput
                      label="Combo1 ngày"
                      value={CANONICAL_VALIDITY_DAYS.combo1}
                      onChange={() => undefined}
                      disabled
                    />
                    <NumberInput
                      label="Combo2 giờ"
                      value={plan.combo2.hours}
                      onChange={(v) =>
                        updatePlan(planIndex, { combo2: { ...plan.combo2, hours: v } })
                      }
                    />
                    <NumberInput
                      label="Combo2 tặng"
                      value={plan.combo2.bonus}
                      onChange={(v) =>
                        updatePlan(planIndex, { combo2: { ...plan.combo2, bonus: v } })
                      }
                    />
                    <NumberInput
                      label="Combo2 ngày"
                      value={CANONICAL_VALIDITY_DAYS.combo2}
                      onChange={() => undefined}
                      disabled
                    />
                  </div>

                  <p className="plan-label">Phù hợp để làm</p>
                  {plan.bestFor.map((item, itemIndex) => (
                    <div key={itemIndex} className="gpu-edit-list-row">
                      <input
                        className="gpu-edit-field"
                        type="text"
                        value={item}
                        onChange={(e) =>
                          updatePlanListItem(planIndex, 'bestFor', itemIndex, e.target.value)
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => removePlanListItem(planIndex, 'bestFor', itemIndex)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn btn-sm gpu-edit-add-btn"
                    onClick={() => addPlanListItem(planIndex, 'bestFor')}
                  >
                    + Thêm mục
                  </button>

                  <TextInput
                    label="Không phù hợp (để trống nếu không hiển thị)"
                    value={plan.notFor ?? ''}
                    onChange={(v) => updatePlan(planIndex, { notFor: v })}
                    onBlur={(v) => updatePlan(planIndex, { notFor: v.trim() || null })}
                    multiline
                  />

                  <div className="gpu-edit-row-3">
                    <TextInput
                      label="GPU"
                      value={plan.gpu}
                      onChange={(v) => updatePlan(planIndex, { gpu: v })}
                    />
                    <TextInput
                      label="VRAM"
                      value={plan.vram}
                      onChange={(v) => updatePlan(planIndex, { vram: v })}
                    />
                    <TextInput
                      label="Nhãn GPU hiển thị"
                      value={plan.gpuLabel}
                      onChange={(v) => updatePlan(planIndex, { gpuLabel: v })}
                    />
                  </div>

                  <div className="plan-real-output">
                    <strong>GPU:</strong> {plan.gpuLabel}
                  </div>

                  <p className="plan-label">Tính năng</p>
                  {plan.features.map((feature, featureIndex) => (
                    <div key={featureIndex} className="gpu-edit-feature-row">
                      <input
                        className="gpu-edit-field"
                        type="text"
                        value={feature.text}
                        onChange={(e) =>
                          updateFeature(planIndex, featureIndex, 'text', e.target.value)
                        }
                      />
                      <label className="gpu-edit-check-inline">
                        <input
                          type="checkbox"
                          checked={feature.included}
                          onChange={(e) =>
                            updateFeature(planIndex, featureIndex, 'included', e.target.checked)
                          }
                        />
                        Có
                      </label>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            plans: prev.plans.map((p, i) =>
                              i === planIndex
                                ? {
                                    ...p,
                                    features: p.features.filter((_, idx) => idx !== featureIndex),
                                  }
                                : p,
                            ),
                          }))
                        }
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn btn-sm gpu-edit-add-btn"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        plans: prev.plans.map((p, i) =>
                          i === planIndex
                            ? { ...p, features: [...p.features, { text: 'Tính năng mới', included: true }] }
                            : p,
                        ),
                      }))
                    }
                  >
                    + Thêm tính năng
                  </button>

                  <p className="plan-label">Tại sao yên tâm</p>
                  {plan.trust.map((item, itemIndex) => (
                    <div key={itemIndex} className="gpu-edit-list-row">
                      <input
                        className="gpu-edit-field"
                        type="text"
                        value={item}
                        onChange={(e) =>
                          updatePlanListItem(planIndex, 'trust', itemIndex, e.target.value)
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => removePlanListItem(planIndex, 'trust', itemIndex)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn btn-sm gpu-edit-add-btn"
                    onClick={() => addPlanListItem(planIndex, 'trust')}
                  >
                    + Thêm dòng
                  </button>

                  <TextInput
                    label="Nút CTA"
                    value={plan.cta}
                    onChange={(v) => updatePlan(planIndex, { cta: v })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={`gpu-edit-actions${hasChanges ? ' has-changes' : ''}`}>
        <div className="gpu-edit-actions-inner">
          <span className="gpu-edit-actions-hint">
            {hasChanges ? '● Có thay đổi chưa lưu' : 'Không có thay đổi'}
          </span>
          <div className="gpu-edit-actions-buttons">
            <button
              type="button"
              className="btn btn-success"
              disabled={!hasChanges || saving}
              onClick={handleSave}
            >
              {saving ? 'Đang cập nhật...' : 'Cập nhật'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!hasChanges || saving}
              onClick={handleUndo}
            >
              Hoàn tác
            </button>
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={handleCancel}>
              Hủy
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div className="admin-pricing-toast" role="status" aria-live="polite">
          ✓ {toast}
        </div>
      )}
    </>
  );
}

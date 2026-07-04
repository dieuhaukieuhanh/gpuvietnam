export const adminGpuPricingStyles = `
  .gpu-edit-intro { margin-bottom: 16px; }
  .gpu-edit-section { margin-bottom: 16px; }
  .gpu-edit-section-title {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 14px;
    color: #F0F0F5;
  }
  .gpu-edit-grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 12px;
  }
  .gpu-edit-grid-3 {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .gpu-edit-row-2 {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 8px;
    margin-bottom: 8px;
  }
  .gpu-edit-row-3 {
    display: grid;
    grid-template-columns: 80px 1fr auto;
    gap: 8px;
    align-items: end;
    margin-bottom: 8px;
  }
  .gpu-edit-label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 10px;
  }
  .gpu-edit-label > span {
    font-size: 10px;
    font-weight: 600;
    color: #44445A;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .gpu-edit-field {
    width: 100%;
    background: #16161F;
    border: 1px solid #1E1E2E;
    border-radius: 6px;
    padding: 8px 10px;
    color: #F0F0F5;
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
  }
  .gpu-edit-field.mono {
    font-family: 'JetBrains Mono', monospace;
  }
  .gpu-edit-field:focus {
    outline: none;
    border-color: #4F8EF7;
  }
  .gpu-edit-check {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    margin-bottom: 0;
  }
  .gpu-edit-check input[type='checkbox'] {
    width: 16px;
    height: 16px;
    accent-color: #4F8EF7;
  }
  .gpu-edit-check-inline {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #8888A0;
    white-space: nowrap;
  }
  .gpu-edit-preview-wrap {
    margin-bottom: 88px;
  }
  .gpu-edit-preview-header {
    margin-bottom: 16px;
  }
  .gpu-edit-preview-header .billing-toggle-bar {
    max-width: none;
    flex-wrap: wrap;
  }
  .gpu-edit-preview-header .billing-toggle-group {
    overflow: visible;
    flex-wrap: wrap;
  }
  .gpu-edit-preview-header .billing-toggle-btn {
    white-space: normal;
    text-align: center;
    line-height: 1.35;
    min-height: 44px;
  }
  .gpu-edit-preview-header .billing-hours-label-card {
    white-space: normal;
    text-align: center;
  }
  .gpu-edit-plan-price {
    flex-wrap: wrap;
    overflow: visible;
    font-size: clamp(22px, 2.4vw, 34px);
    line-height: 1.15;
    gap: 2px 4px;
  }
  .gpu-edit-plan-price-amount {
    font-variant-numeric: tabular-nums;
    word-break: break-word;
  }
  .gpu-edit-plan-price-currency {
    font-size: 0.42em;
    font-weight: 600;
    color: var(--text-muted, #8888A0);
    flex-shrink: 0;
  }
  .gpu-edit-plan-card .plan-price-row {
    overflow: visible;
  }
  .gpu-edit-preview-header .billing-toggle-bar {
    margin-top: 12px;
  }
  .gpu-edit-plan-grid {
    align-items: stretch;
  }
  .gpu-edit-plan-card {
    text-align: left;
    min-height: auto;
  }
  .gpu-edit-plan-card .plan-card,
  .gpu-edit-plan-card.plan-card {
    height: 100%;
  }
  .gpu-edit-card-fields {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .gpu-edit-price-stack,
  .gpu-edit-combo-grid {
    margin: 10px 0;
    padding: 10px;
    background: rgba(79, 142, 247, 0.06);
    border: 1px solid rgba(79, 142, 247, 0.15);
    border-radius: 8px;
  }
  .gpu-edit-price-stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .gpu-edit-price-stack .gpu-edit-price-field {
    margin-bottom: 0;
  }
  .gpu-edit-vnd-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .gpu-edit-vnd-input {
    flex: 1;
    min-width: 0;
    font-size: 15px;
    padding: 10px 12px;
  }
  .gpu-edit-vnd-suffix {
    flex-shrink: 0;
    font-size: 13px;
    font-weight: 600;
    color: #8888A0;
  }
  .gpu-edit-combo-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .gpu-edit-list-row,
  .gpu-edit-feature-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 6px;
  }
  .gpu-edit-list-row .gpu-edit-field,
  .gpu-edit-feature-row .gpu-edit-field {
    margin-bottom: 0;
  }
  .gpu-edit-add-btn {
    margin-bottom: 12px;
  }
  .gpu-edit-actions {
    position: fixed;
    left: 220px;
    right: 0;
    bottom: 0;
    z-index: 30;
    background: rgba(10, 10, 15, 0.92);
    border-top: 1px solid #1E1E2E;
    backdrop-filter: blur(8px);
  }
  .gpu-edit-actions.has-changes {
    border-top-color: rgba(79, 142, 247, 0.4);
  }
  .gpu-edit-actions-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 28px;
    flex-wrap: wrap;
  }
  .gpu-edit-actions-hint {
    font-size: 12px;
    color: #8888A0;
  }
  .gpu-edit-actions.has-changes .gpu-edit-actions-hint {
    color: #4F8EF7;
  }
  .gpu-edit-actions-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .btn-ghost {
    background: transparent;
    border: 1px solid #1E1E2E;
    color: #8888A0;
  }
  .btn-ghost:hover:not(:disabled) {
    color: #F0F0F5;
    border-color: #44445A;
  }
  @media (max-width: 768px) {
    .gpu-edit-grid-2,
    .gpu-edit-grid-3,
    .gpu-edit-combo-grid {
      grid-template-columns: 1fr;
    }
    .gpu-edit-row-3 {
      grid-template-columns: 1fr;
    }
    .gpu-edit-actions {
      left: 0;
    }
    .gpu-edit-actions-inner {
      padding: 12px 16px;
    }
  }
`;

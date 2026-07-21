/** Styles riêng tab Khách hàng — bổ sung admin-panel.styles */
export const styles = `
  .admin-customers-panel {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
  }
  .content:has(.admin-customers-panel) {
    overflow-x: hidden;
  }
  .admin-customers-panel .grid-4,
  .admin-customers-panel .grid-3 {
    margin-bottom: 16px;
  }
  .admin-customers-panel .grid-4 .card,
  .admin-customers-panel .grid-3 .card {
    margin-bottom: 0;
    min-width: 0;
    overflow: hidden;
  }
  .admin-customers-panel .grid-4 .stat-value,
  .admin-customers-panel .grid-3 .stat-value {
    word-break: break-word;
  }
  .admin-customers-panel .filter-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 16px;
    align-items: center;
    padding: 0;
    width: 100%;
    max-width: 100%;
  }
  .admin-customers-panel .filter-group {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
  }
  .admin-customers-panel .filter-group.filter-search {
    flex: 1 1 180px;
    min-width: 0;
  }
  .admin-customers-panel .filter-group label {
    font-size: 12px;
    color: #8888A0;
    font-weight: 500;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .admin-customers-panel .filter-group select,
  .admin-customers-panel .filter-group input {
    background: #16161F;
    border: 1px solid #1E1E2E;
    border-radius: 6px;
    padding: 4px 10px;
    color: #F0F0F5;
    font-size: 12px;
    outline: none;
    height: 30px;
    max-width: 100%;
  }
  .admin-customers-panel .filter-group select {
    min-width: 0;
    flex: 1;
  }
  .admin-customers-panel .filter-group select:focus,
  .admin-customers-panel .filter-group input:focus {
    border-color: #4F8EF7;
  }
  .admin-customers-panel .filter-group input[type="text"] {
    width: 100%;
    min-width: 0;
  }
  .admin-customers-panel .filter-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #1E1E2E;
  }
  .admin-customers-panel .progress {
    width: 60px;
    height: 4px;
    border-radius: 4px;
    background: #1E1E2E;
    overflow: hidden;
    display: inline-block;
    vertical-align: middle;
    margin-right: 6px;
  }
  .admin-customers-panel .progress-bar {
    height: 100%;
    border-radius: 4px;
    background: #4F8EF7;
  }
  .admin-customers-panel .progress-bar.amber { background: #F59E0B; }
  .admin-customers-panel .progress-bar.red { background: #EF4444; }
  .admin-customers-panel .progress-bar.green { background: #22C55E; }
  .admin-customers-panel .risk-low { color: #22C55E; }
  .admin-customers-panel .risk-medium { color: #F59E0B; }
  .admin-customers-panel .risk-high { color: #EF4444; }
  .admin-customers-panel th.sortable {
    cursor: pointer;
    user-select: none;
  }
  .admin-customers-panel th.sortable:hover {
    color: #8888A0;
  }
  .admin-customers-panel th.sorted-asc::after {
    content: ' ▲';
    color: #4F8EF7;
  }
  .admin-customers-panel th.sorted-desc::after {
    content: ' ▼';
    color: #4F8EF7;
  }
  .admin-customers-panel .customers-toolbar {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
  }
  .admin-customers-panel .live-sync-note {
    font-size: 11px;
    color: #44445A;
    margin-right: auto;
  }
  .admin-customers-panel .live-sync-note .live-dot {
    color: #22C55E;
    animation: customer-live-pulse 1.5s infinite;
  }
  @keyframes customer-live-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35;
    }
  }
  .admin-customers-panel .realtime-status {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .admin-customers-panel .realtime-status-main {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    line-height: 1.35;
  }
  .admin-customers-panel .realtime-status-online {
    color: #22C55E;
  }
  .admin-customers-panel .realtime-status-has-plan {
    color: #F59E0B;
  }
  .admin-customers-panel .realtime-status-expired {
    color: #8888A0;
  }
  .admin-customers-panel .live-badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.4px;
    color: #22C55E;
    background: #0F2E1A;
    animation: customer-live-pulse 1.5s infinite;
  }
  .admin-customers-panel .realtime-template {
    font-size: 11px;
    color: #8888A0;
    word-break: break-word;
  }
  .admin-customers-panel .customer-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: linear-gradient(135deg, #4F8EF7, #8B5CF6);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .admin-customers-panel .customers-table-empty td {
    text-align: center;
    padding: 30px 12px;
    color: #8888A0;
  }
  .admin-customers-panel .customers-footer {
    margin-top: 8px;
    padding-top: 16px;
    border-top: 1px solid #1E1E2E;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    color: #44445A;
    font-size: 12px;
  }
  .admin-customers-panel .card-no-pad {
    max-width: 100%;
  }
  .admin-customers-panel .table-wrap {
    overflow-x: auto;
    max-width: 100%;
    -webkit-overflow-scrolling: touch;
  }
  .admin-customers-panel table {
    table-layout: fixed;
    width: 100%;
    min-width: 0;
  }
  .admin-customers-panel th,
  .admin-customers-panel td {
    white-space: normal;
    word-break: break-word;
    overflow-wrap: anywhere;
    hyphens: auto;
    vertical-align: top;
    padding: 8px 10px;
    font-size: 12px;
    line-height: 1.4;
  }
  .admin-customers-panel th {
    font-size: 10px;
    vertical-align: middle;
  }
  .admin-customers-panel th.sortable {
    white-space: normal;
  }
  .admin-customers-panel .cell-compact {
    white-space: nowrap;
    word-break: normal;
    overflow-wrap: normal;
  }
  .admin-customers-panel .cell-customer {
    min-width: 0;
  }
  .admin-customers-panel .customer-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-width: 0;
  }
  .admin-customers-panel .customer-meta {
    min-width: 0;
    flex: 1;
  }
  .admin-customers-panel .customer-name {
    font-weight: 500;
    word-break: break-word;
  }
  .admin-customers-panel .customer-email {
    font-size: 11px;
    color: #8888A0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .admin-customers-panel .cell-hours {
    white-space: nowrap;
    word-break: normal;
    overflow-wrap: normal;
  }
  .admin-customers-panel .cell-hours .progress {
    flex-shrink: 0;
  }
  .admin-customers-panel .hours-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .admin-customers-panel .badge {
    max-width: 100%;
    white-space: normal;
    text-align: center;
    line-height: 1.3;
  }
  .admin-customers-panel .customers-compact-table {
    overflow-x: hidden;
  }
  .admin-customers-panel .customers-main-table col.col-main-customer { width: 34%; }
  .admin-customers-panel .customers-main-table col.col-main-plan { width: 11%; }
  .admin-customers-panel .customers-main-table col.col-main-hours { width: 14%; }
  .admin-customers-panel .customers-main-table col.col-main-online { width: 22%; }
  .admin-customers-panel .customers-main-table col.col-main-anomaly { width: 12%; }
  .admin-customers-panel .customers-main-table col.col-main-expand { width: 7%; }
  .admin-customers-panel .customer-name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .admin-customers-panel .progress-sm {
    width: 48px;
    margin-right: 0;
  }
  .admin-customers-panel .hours-value {
    font-size: 12px;
  }
  .admin-customers-panel .online-compact {
    font-size: 12px;
    line-height: 1.35;
    white-space: nowrap;
  }
  .admin-customers-panel .online-compact-yes {
    color: #22C55E;
  }
  .admin-customers-panel .online-compact-no {
    color: #8888A0;
  }
  .admin-customers-panel .provider-badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 7px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    vertical-align: middle;
    line-height: 1.4;
  }
  .admin-customers-panel .provider-badge-clore {
    color: #c4b5fd;
    background: rgba(139, 92, 246, 0.18);
    border: 1px solid rgba(139, 92, 246, 0.35);
  }
  .admin-customers-panel .provider-badge-vast {
    color: #7dd3fc;
    background: rgba(14, 165, 233, 0.16);
    border: 1px solid rgba(14, 165, 233, 0.35);
  }
  .admin-customers-panel .customer-expand-machine-status .provider-badge {
    margin-left: 8px;
  }
  .admin-customers-panel .anomaly-compact {
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }
  .admin-customers-panel .cell-expand,
  .admin-customers-panel .cell-expand-header {
    text-align: center;
    vertical-align: middle;
    width: 40px;
  }
  .admin-customers-panel .expand-toggle {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid #1E1E2E;
    background: #16161F;
    color: #8888A0;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.3s ease, background 0.15s, color 0.15s, border-color 0.15s;
  }
  .admin-customers-panel .expand-toggle:hover {
    background: #1E1E2E;
    color: #F0F0F5;
    border-color: #4F8EF7;
  }
  .admin-customers-panel .expand-toggle.is-open {
    transform: rotate(90deg);
    color: #4F8EF7;
    border-color: #4F8EF7;
  }
  .admin-customers-panel .customer-row-main {
    cursor: pointer;
    transition: background 0.15s;
  }
  .admin-customers-panel .customer-row-main:hover td {
    background: rgba(79, 142, 247, 0.06);
  }
  .admin-customers-panel .customer-row-main.is-expanded td {
    background: rgba(79, 142, 247, 0.04);
  }
  .admin-customers-panel .customer-row-expand td {
    padding: 0;
    border-bottom: none;
  }
  .admin-customers-panel .customer-row-expand.is-open td {
    border-bottom: 1px solid rgba(30, 30, 46, 0.4);
  }
  .admin-customers-panel .customer-expand-panel {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.3s ease;
  }
  .admin-customers-panel .customer-expand-panel.open {
    max-height: 680px;
  }
  .admin-customers-panel .customer-expand-inner {
    padding: 14px 16px 16px 20px;
    background: #0D0D14;
    border-left: 3px solid #4F8EF7;
    margin: 0 0 4px;
  }
  .admin-customers-panel .customer-expand-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px 24px;
  }
  .admin-customers-panel .customer-expand-col {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .admin-customers-panel .customer-detail-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .admin-customers-panel .customer-detail-label {
    font-size: 10px;
    font-weight: 600;
    color: #44445A;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .admin-customers-panel .customer-detail-value {
    font-size: 12px;
    color: #F0F0F5;
    word-break: break-word;
  }
  .admin-customers-panel .customer-expand-alerts {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid #1E1E2E;
  }
  .admin-customers-panel .customer-expand-alert-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .admin-customers-panel .customer-expand-alert-item {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 8px;
  }
  .admin-customers-panel .customer-expand-alert-detail {
    font-size: 11px;
    opacity: 0.85;
    font-weight: 500;
  }
  .admin-customers-panel .customer-expand-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid #1E1E2E;
  }
  .admin-customers-panel .customer-expand-machine {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid #1E1E2E;
  }
  .admin-customers-panel .customer-expand-machine-status {
    font-size: 12px;
    color: #A0A0B8;
    margin-bottom: 4px;
  }
  .admin-customers-panel .customer-expand-machine-logs {
    margin: 0;
    padding-left: 18px;
    font-size: 11px;
    color: #8888A0;
    line-height: 1.6;
  }
  .admin-customers-panel .col-main-actions {
    width: 88px;
  }
  .admin-customers-panel col.col-customer { width: 12%; }
  .admin-customers-panel col.col-plan { width: 5%; }
  .admin-customers-panel col.col-realtime { width: 11%; }
  .admin-customers-panel col.col-hours { width: 7%; }
  .admin-customers-panel col.col-last { width: 8%; }
  .admin-customers-panel col.col-workflow { width: 6%; }
  .admin-customers-panel col.col-model { width: 6%; }
  .admin-customers-panel col.col-journey { width: 8%; }
  .admin-customers-panel col.col-revenue { width: 7%; }
  .admin-customers-panel col.col-avg { width: 5%; }
  .admin-customers-panel col.col-risk { width: 6%; }
  .admin-customers-panel col.col-sessions { width: 4%; }
  .admin-customers-panel col.col-anomaly { width: 11%; }
  .admin-customers-panel col.col-history { width: 13%; }
  .admin-customers-panel .customers-anomaly-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 14px;
    padding: 16px 20px;
    margin-bottom: 16px;
    border-radius: 12px;
    border: 1px solid #3D2A0A;
    background: linear-gradient(135deg, rgba(46, 32, 10, 0.85), rgba(46, 15, 15, 0.35));
  }
  .admin-customers-panel .customers-anomaly-banner-icon {
    font-size: 22px;
    line-height: 1;
    color: #F59E0B;
    flex-shrink: 0;
  }
  .admin-customers-panel .customers-anomaly-banner-body {
    flex: 1;
    min-width: 0;
  }
  .admin-customers-panel .customers-anomaly-banner-title {
    font-weight: 600;
    font-size: 14px;
    margin-bottom: 8px;
  }
  .admin-customers-panel .customers-anomaly-banner-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .admin-customers-panel .anomaly-chip-wrap {
    position: relative;
    display: inline-flex;
  }
  .admin-customers-panel .anomaly-chip-wrap:hover .anomaly-chip-tooltip,
  .admin-customers-panel .anomaly-chip-wrap:focus-within .anomaly-chip-tooltip {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
  }
  .admin-customers-panel .anomaly-chip-tooltip {
    position: absolute;
    left: 0;
    top: calc(100% + 8px);
    z-index: 30;
    min-width: 180px;
    max-width: 280px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid #1E1E2E;
    background: #16161F;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    opacity: 0;
    visibility: hidden;
    transform: translateY(-4px);
    transition: opacity 0.15s, transform 0.15s, visibility 0.15s;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .admin-customers-panel .anomaly-chip-tooltip-title {
    font-size: 11px;
    font-weight: 700;
    color: #F0F0F5;
    margin-bottom: 4px;
  }
  .admin-customers-panel .anomaly-chip-tooltip-row {
    font-size: 11px;
    color: #8888A0;
    line-height: 1.4;
    word-break: break-word;
  }
  .admin-customers-panel .anomaly-chip {
    border: none;
    cursor: pointer;
    border-radius: 20px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 600;
    transition: 0.15s;
  }
  .admin-customers-panel .anomaly-chip:hover {
    filter: brightness(1.1);
  }
  .admin-customers-panel .anomaly-badges {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .admin-customers-panel .anomaly-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 20px;
    font-size: 10px;
    font-weight: 600;
    line-height: 1.35;
    max-width: 100%;
    word-break: break-word;
  }
  .admin-customers-panel .anomaly-badge-high,
  .admin-customers-panel .anomaly-chip.anomaly-badge-high {
    background: #2E0F0F;
    color: #EF4444;
  }
  .admin-customers-panel .anomaly-badge-medium,
  .admin-customers-panel .anomaly-chip.anomaly-badge-medium {
    background: #2E200A;
    color: #F59E0B;
  }
  .admin-customers-panel .anomaly-badge-low,
  .admin-customers-panel .anomaly-chip.anomaly-badge-low {
    background: #16161F;
    color: #8888A0;
  }
  .admin-customers-panel .anomaly-more {
    font-size: 10px;
    color: #8888A0;
  }
  @media (max-width: 768px) {
    .admin-customers-panel .filter-bar {
      flex-direction: column;
      align-items: stretch;
    }
    .admin-customers-panel .filter-group {
      width: 100%;
    }
    .admin-customers-panel .filter-group select {
      flex: 1;
      width: 100%;
    }
    .admin-customers-panel .col-hide-mobile {
      display: none;
    }
    .admin-customers-panel .customers-main-table col.col-main-customer { width: 42%; }
    .admin-customers-panel .customers-main-table col.col-main-plan { width: 18%; }
    .admin-customers-panel .customers-main-table col.col-main-online { width: 28%; }
    .admin-customers-panel .customers-main-table col.col-main-expand { width: 12%; }
    .admin-customers-panel .customer-expand-grid {
      grid-template-columns: 1fr;
    }
    .admin-customers-panel .customer-expand-panel.open {
      max-height: 900px;
    }
  }

  .admin-customers-panel .customer-row-actions {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .admin-customers-panel .customer-remote-support-btn {
    min-width: 32px;
    padding: 4px 8px;
    line-height: 1;
  }

  .admin-support-modal {
    max-width: 480px;
  }
  .admin-support-sub {
    font-size: 12px;
    color: #9898A8;
    margin-bottom: 16px;
  }
  .admin-support-stream-placeholder,
  .admin-support-waiting,
  .admin-support-actions {
    padding: 14px;
    border-radius: 10px;
    background: #12121A;
    border: 1px solid #1E1E2E;
    margin-bottom: 12px;
  }
  .admin-support-stream-title {
    font-size: 14px;
    font-weight: 700;
    color: #10B981;
    margin-bottom: 8px;
  }
  .admin-support-stream-note {
    font-size: 12px;
    color: #9898A8;
    margin-bottom: 12px;
    line-height: 1.5;
  }
  .admin-support-timer {
    font-size: 13px;
    margin-bottom: 12px;
    color: #E5E7EB;
  }
  .admin-support-waiting p,
  .admin-support-actions p {
    font-size: 13px;
    color: #C4C4D0;
    margin-bottom: 12px;
  }
  .admin-support-message {
    font-size: 12px;
    color: #60A5FA;
    margin-top: 8px;
  }
  .admin-support-warning {
    font-size: 11px;
    color: #F59E0B;
    margin-top: 8px;
  }
`;

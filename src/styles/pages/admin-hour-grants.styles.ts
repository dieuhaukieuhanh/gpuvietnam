export const styles = `
    .hg-panel { display: flex; flex-direction: column; gap: 16px; }

    .hg-subtabs {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 4px;
    }
    .hg-subtab {
      padding: 8px 16px;
      border-radius: 8px;
      border: 1px solid #1E1E2E;
      background: #16161F;
      color: #8888A0;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }
    .hg-subtab:hover { border-color: #4F8EF7; color: #F0F0F5; }
    .hg-subtab.active {
      background: #4F8EF7;
      border-color: #4F8EF7;
      color: #fff;
    }

    .hg-form-card {
      background: #111118;
      border: 1px solid #1E1E2E;
      border-radius: 12px;
      padding: 20px;
    }
    .hg-form-card h3 {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .hg-field { margin-bottom: 14px; }
    .hg-field label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: #8888A0;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin-bottom: 6px;
    }
    .hg-input, .hg-select, .hg-textarea {
      width: 100%;
      background: #16161F;
      border: 1px solid #1E1E2E;
      border-radius: 8px;
      padding: 9px 12px;
      color: #F0F0F5;
      font-size: 13px;
      outline: none;
    }
    .hg-input:focus, .hg-select:focus, .hg-textarea:focus { border-color: #4F8EF7; }
    .hg-textarea { min-height: 72px; resize: vertical; }

    .hg-search-wrap { position: relative; }
    .hg-search-results {
      position: absolute;
      top: calc(100% + 4px);
      left: 0; right: 0;
      background: #16161F;
      border: 1px solid #1E1E2E;
      border-radius: 8px;
      max-height: 220px;
      overflow-y: auto;
      z-index: 30;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    .hg-search-item {
      display: block;
      width: 100%;
      text-align: left;
      padding: 10px 12px;
      border: none;
      background: transparent;
      color: #F0F0F5;
      cursor: pointer;
      font-size: 13px;
      border-bottom: 1px solid #1E1E2E;
    }
    .hg-search-item:last-child { border-bottom: none; }
    .hg-search-item:hover { background: #1E1E2E; }
    .hg-search-item small { display: block; color: #8888A0; font-size: 11px; margin-top: 2px; }

    .hg-selected-customer {
      background: #16161F;
      border: 1px solid #1E1E2E;
      border-radius: 8px;
      padding: 12px 14px;
      margin-bottom: 14px;
    }
    .hg-selected-customer strong { display: block; margin-bottom: 4px; }
    .hg-selected-customer span { font-size: 12px; color: #8888A0; display: block; }

    .hg-checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
      font-size: 12px;
      color: #8888A0;
    }
    .hg-checkbox-row input { accent-color: #4F8EF7; }

    .hg-preview {
      background: rgba(34, 197, 94, 0.15);
      border: 1px solid rgba(34, 197, 94, 0.35);
      border-radius: 10px;
      padding: 14px 16px;
      color: #fff;
      font-size: 13px;
      line-height: 1.6;
      margin: 16px 0;
    }
    .hg-preview strong { color: #86EFAC; }

    .hg-grant-list { display: flex; flex-direction: column; gap: 10px; margin: 14px 0; }
    .hg-grant-item {
      display: block;
      width: 100%;
      text-align: left;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid #1E1E2E;
      background: #16161F;
      color: #F0F0F5;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .hg-grant-item:hover { border-color: #4F8EF7; }
    .hg-grant-item.selected { border-color: #4F8EF7; background: rgba(79,142,247,0.08); }
    .hg-grant-item-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 6px;
    }
    .hg-grant-item-meta { font-size: 12px; color: #8888A0; line-height: 1.5; }

    .hg-radio-group { display: flex; flex-direction: column; gap: 8px; }
    .hg-radio-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      cursor: pointer;
    }
    .hg-radio-row input { accent-color: #4F8EF7; }

    .hg-gpu-plan-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .hg-gpu-plan-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid #1E1E2E;
      border-radius: 8px;
      background: #16161F;
      font-size: 13px;
      cursor: pointer;
      line-height: 1.45;
    }
    .hg-gpu-plan-row:has(input:checked) {
      border-color: #4F8EF7;
      background: rgba(79, 142, 247, 0.08);
    }
    .hg-gpu-plan-row input {
      margin-top: 3px;
      accent-color: #4F8EF7;
      flex-shrink: 0;
    }

    .hg-history-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 14px;
    }
    .hg-filter-btn {
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid #1E1E2E;
      background: #16161F;
      color: #8888A0;
      font-size: 12px;
      cursor: pointer;
    }
    .hg-filter-btn.active {
      background: rgba(79,142,247,0.15);
      border-color: #4F8EF7;
      color: #4F8EF7;
    }

    .hg-table-wrap { overflow-x: auto; border: 1px solid #1E1E2E; border-radius: 10px; }
    .hg-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .hg-table th {
      text-align: left;
      padding: 10px 12px;
      background: #16161F;
      color: #8888A0;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      font-size: 10px;
      border-bottom: 1px solid #1E1E2E;
    }
    .hg-table td {
      padding: 10px 12px;
      border-bottom: 1px solid #1E1E2E;
      vertical-align: top;
    }
    .hg-table tr:nth-child(even) td { background: rgba(22,22,31,0.5); }
    .hg-table tr:last-child td { border-bottom: none; }

    .hg-action-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }
    .hg-action-grant { background: rgba(34,197,94,0.15); color: #22C55E; }
    .hg-action-add { background: rgba(79,142,247,0.15); color: #4F8EF7; }
    .hg-action-reduce { background: rgba(245,158,11,0.15); color: #F59E0B; }
    .hg-action-revoke { background: rgba(239,68,68,0.15); color: #EF4444; }
    .hg-action-extend { background: rgba(139,92,246,0.15); color: #8B5CF6; }

    .hg-pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 14px;
      font-size: 12px;
      color: #8888A0;
    }
    .hg-pagination-btns { display: flex; gap: 8px; }

    .hg-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #22C55E;
      color: #fff;
      padding: 12px 18px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 500;
      z-index: 100;
      box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    }
    .hg-toast.error { background: #EF4444; }

    .hg-empty {
      text-align: center;
      padding: 32px 16px;
      color: #8888A0;
      font-size: 13px;
    }
`;

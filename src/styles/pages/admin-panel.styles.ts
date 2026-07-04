export const styles = `/* ─── Reset & Base ─── */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0A0A0F;
      color: #F0F0F5;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      display: flex;
      min-height: 100vh;
    }
    .mono { font-family: 'JetBrains Mono', 'Courier New', monospace; }
    .text-muted { color: #8888A0; }
    .text-dim { color: #44445A; }
    .text-green { color: #22C55E; }
    .text-amber { color: #F59E0B; }
    .text-red { color: #EF4444; }
    .text-blue { color: #4F8EF7; }
    .text-purple { color: #8B5CF6; }
    .fw-600 { font-weight: 600; }
    .fw-700 { font-weight: 700; }

    /* ─── Sidebar ─── */
    .sidebar {
      position: fixed;
      top: 0; left: 0; bottom: 0;
      width: 220px;
      background: #111118;
      border-right: 1px solid #1E1E2E;
      display: flex;
      flex-direction: column;
      z-index: 20;
    }
    .sidebar-brand {
      padding: 20px 20px 16px;
      border-bottom: 1px solid #1E1E2E;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .sidebar-brand .logo {
      width: 32px; height: 32px;
      border-radius: 8px;
      background: linear-gradient(135deg, #4F8EF7, #8B5CF6);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      font-family: monospace;
    }
    .sidebar-brand h1 {
      font-weight: 700;
      font-size: 14px;
      font-family: 'Space Grotesk', sans-serif;
    }
    .sidebar-brand h1 span { color: #4F8EF7; }
    .sidebar-brand small {
      font-size: 10px;
      color: #44445A;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .sidebar-nav {
      flex: 1;
      padding: 12px 10px;
      overflow-y: auto;
    }
    .sidebar-nav button {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 10px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      text-align: left;
      border: none;
      background: transparent;
      color: #8888A0;
      transition: 0.15s;
      margin-bottom: 2px;
    }
    .sidebar-nav button:hover { background: #16161F; color: #F0F0F5; }
    .sidebar-nav button.active {
      background: #1A2E52;
      color: #4F8EF7;
    }
    .sidebar-nav button .badge {
      margin-left: auto;
      background: #F59E0B;
      color: #000;
      font-size: 10px;
      font-weight: 700;
      padding: 0 6px;
      border-radius: 20px;
    }
    .sidebar-footer {
      padding: 12px 14px;
      border-top: 1px solid #1E1E2E;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .sidebar-footer .avatar {
      width: 32px; height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, #F59E0B, #EF4444);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .sidebar-footer .info { flex: 1; min-width: 0; }
    .sidebar-footer .info p { font-size: 13px; font-weight: 600; }
    .sidebar-footer .info small { font-size: 11px; color: #44445A; }
    .sidebar-footer button { background: none; border: none; color: #44445A; cursor: pointer; }

    /* ─── Main ─── */
    .main {
      margin-left: 220px;
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      min-width: 0;
      background: #0A0A0F;
    }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 10;
      height: 56px;
      background: rgba(10, 10, 15, 0.85);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid #1E1E2E;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 28px;
    }
    .topbar h2 { font-weight: 600; font-size: 16px; font-family: 'Space Grotesk', sans-serif; min-width: 0; }
    .topbar-left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex: 1;
    }
    .admin-menu-toggle {
      display: none;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      flex-shrink: 0;
      border-radius: 8px;
      border: 1px solid #1E1E2E;
      background: #16161F;
      color: #F0F0F5;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
    }
    .admin-menu-toggle:hover { background: #1E1E2E; }
    .admin-sidebar-backdrop {
      display: none;
    }
    .topbar .right { display: flex; align-items: center; gap: 12px; }
    .topbar .clock { font-family: monospace; font-size: 12px; color: #8888A0; }
    .topbar .live-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      background: #0F2E1A;
      color: #22C55E;
    }
    .topbar .live-badge .dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #22C55E;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse { 0%,100%{ opacity: 1; } 50%{ opacity: 0.4; } }

    .content {
      padding: 28px;
      flex: 1;
      min-width: 0;
      overflow-x: auto;
    }

    /* ─── Cards ─── */
    .card {
      background: #111118;
      border: 1px solid #1E1E2E;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .card-no-pad {
      background: #111118;
      border: 1px solid #1E1E2E;
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 20px;
    }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

    .stat-label { font-size: 11px; font-weight: 600; color: #8888A0; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .stat-value { font-size: 24px; font-weight: 500; }
    .stat-sub { font-size: 11px; color: #44445A; margin-top: 4px; word-break: break-word; }

    /* ─── Badge ─── */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge-green { background: #0F2E1A; color: #22C55E; }
    .badge-amber { background: #2E200A; color: #F59E0B; }
    .badge-red { background: #2E0F0F; color: #EF4444; }
    .badge-blue { background: #1A2E52; color: #4F8EF7; }
    .badge-purple { background: #2D1F52; color: #8B5CF6; }
    .badge-gray { background: #16161F; color: #8888A0; }

    /* ─── Table ─── */
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th {
      text-align: left;
      padding: 10px 12px;
      font-size: 10px;
      font-weight: 600;
      color: #44445A;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      border-bottom: 1px solid #1E1E2E;
      white-space: nowrap;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(30, 30, 46, 0.4);
      vertical-align: middle;
      white-space: nowrap;
    }
    tr:nth-child(even) td { background: rgba(255,255,255,0.015); }

    /* ─── Form controls ─── */
    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; font-size: 12px; font-weight: 600; color: #8888A0; margin-bottom: 4px; }
    .form-control {
      width: 100%;
      background: #16161F;
      border: 1px solid #1E1E2E;
      border-radius: 8px;
      padding: 8px 12px;
      color: #F0F0F5;
      font-size: 13px;
      outline: none;
    }
    .form-control:focus { border-color: #4F8EF7; }
    .form-control[type="number"] { width: 120px; }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid #1E1E2E;
      background: #16161F;
      color: #F0F0F5;
      transition: 0.15s;
      white-space: nowrap;
    }
    .btn:hover { background: #1E1E2E; }
    .btn-primary { background: #4F8EF7; border-color: #4F8EF7; color: #fff; }
    .btn-primary:hover { background: #3A7BE0; }
    .btn-success { background: #22C55E; border-color: #22C55E; color: #fff; }
    .btn-success:hover { background: #16A34A; }
    .btn-danger { background: #EF4444; border-color: #EF4444; color: #fff; }
    .btn-danger:hover { background: #DC2626; }
    .btn-sm { padding: 4px 10px; font-size: 11px; }

    .mini-tabs {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid #1E1E2E;
      margin-bottom: 16px;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }
    .mini-tabs::-webkit-scrollbar { display: none; }
    .mini-tab {
      padding: 6px 14px;
      border: none;
      background: transparent;
      color: #8888A0;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: 0.2s;
      flex-shrink: 0;
    }
    .mini-tab:hover { color: #F0F0F5; }
    .mini-tab.active { color: #4F8EF7; border-bottom-color: #4F8EF7; }

    .section-divider {
      border-top: 1px solid #1E1E2E;
      margin: 24px 0 16px;
      padding-top: 16px;
    }
    .section-divider h3 {
      font-size: 14px;
      font-weight: 600;
      color: #8888A0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }

    /* ─── Admin auth screen ─── */
    .admin-auth-screen {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: #0A0A0F;
    }
    .admin-auth-card {
      width: 100%;
      max-width: 400px;
      background: #111118;
      border: 1px solid #1E1E2E;
      border-radius: 12px;
      padding: 28px;
    }
    .admin-auth-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
    }
    .admin-auth-brand .logo {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: linear-gradient(135deg, #4F8EF7, #8B5CF6);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 12px;
      font-weight: 700;
    }
    .admin-auth-brand h1 {
      font-size: 16px;
      font-weight: 700;
    }
    .admin-auth-brand h1 span { color: #4F8EF7; }
    .admin-auth-brand small { color: #8888A0; font-size: 11px; }

    .card-header-row {
      padding: 12px 20px;
      border-bottom: 1px solid #1E1E2E;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .empty-state {
      text-align: center;
      padding: 32px;
      color: #8888A0;
    }

    /* ─── Payment approval cards ─── */
    .payments-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
    }
    .payment-card {
      background: #16161F;
      border: 1px solid #1E1E2E;
      border-radius: 10px;
      padding: 16px;
    }
    .payment-card-head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px 16px;
      margin-bottom: 12px;
    }
    .payment-card-title {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .payment-card-meta {
      font-size: 11px;
      color: #8888A0;
      white-space: nowrap;
    }
    .payment-card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 10px 16px;
      margin-bottom: 12px;
    }
    .payment-field label {
      display: block;
      font-size: 10px;
      font-weight: 600;
      color: #44445A;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin-bottom: 2px;
    }
    .payment-field p {
      font-size: 13px;
      word-break: break-word;
    }
    .payment-field-full {
      grid-column: 1 / -1;
    }
    .payment-note {
      background: #111118;
      border: 1px solid #1E1E2E;
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 12px;
      color: #8888A0;
      word-break: break-word;
      line-height: 1.5;
    }
    .payment-card-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding-top: 12px;
      border-top: 1px solid #1E1E2E;
    }

    .recent-toggle {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      text-align: left;
    }
    .recent-list {
      margin-top: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .recent-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px 16px;
      padding: 10px 12px;
      background: #16161F;
      border: 1px solid #1E1E2E;
      border-radius: 8px;
      font-size: 12px;
    }
    .recent-row-main {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    /* ─── Storage pricing admin ─── */
    .pricing-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .pricing-section {
      margin-bottom: 0;
    }
    .pricing-table td {
      white-space: nowrap;
      vertical-align: middle;
    }
    .pricing-row-alt td {
      background: rgba(255, 255, 255, 0.02);
    }
    .pricing-price-input {
      width: 120px;
      text-align: right;
      background: #16161F;
      border: 1px solid #1E1E2E;
      border-radius: 6px;
      padding: 6px 10px;
      color: #F0F0F5;
      font-size: 13px;
      font-family: 'JetBrains Mono', monospace;
    }
    .pricing-price-input:focus {
      outline: none;
      border-color: #4F8EF7;
    }
    .pricing-status-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid #1E1E2E;
      background: #16161F;
      color: #8888A0;
      cursor: pointer;
      transition: 0.15s;
    }
    .pricing-status-badge.active {
      background: #0F2E1A;
      color: #22C55E;
      border-color: rgba(34, 197, 94, 0.3);
    }
    .pricing-status-badge.inactive {
      background: #16161F;
      color: #6B6B7B;
    }
    .pricing-status-badge:hover:not(:disabled) {
      filter: brightness(1.1);
    }
    .admin-pricing-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 100;
      background: #0F2E1A;
      border: 1px solid rgba(34, 197, 94, 0.4);
      color: #22C55E;
      padding: 12px 18px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      max-width: min(420px, calc(100vw - 48px));
    }

    /* ─── Infrastructure admin ─── */
    .infra-provider-section {
      margin-bottom: 16px;
    }
    .infra-table td {
      white-space: nowrap;
      vertical-align: middle;
    }
    .infra-table th {
      font-size: 10px;
      letter-spacing: 0.4px;
    }
    .infra-provider-tag {
      margin-left: 6px;
      font-size: 10px;
      color: #8888A0;
    }
    .infra-row-unavailable td {
      opacity: 0.85;
    }
    .infra-alert-banner {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 10px;
      background: #2E0F0F;
      border: 1px solid rgba(239, 68, 68, 0.25);
      color: #EF4444;
      margin-bottom: 16px;
    }
    .infra-status-badge {
      gap: 5px;
      padding: 2px 8px;
    }
    .infra-status-badge .badge-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }
    .infra-badge-stable {
      background: #0F2E1A;
      color: #22C55E;
    }
    .infra-badge-stable .badge-dot { background: #22C55E; }
    .infra-badge-low {
      background: #2E200A;
      color: #F59E0B;
    }
    .infra-badge-low .badge-dot { background: #F59E0B; }
    .infra-badge-scarce,
    .infra-badge-unavailable {
      background: #2E0F0F;
      color: #EF4444;
    }
    .infra-badge-scarce .badge-dot,
    .infra-badge-unavailable .badge-dot { background: #EF4444; }
    .infra-rules-list {
      list-style: none;
      padding: 0;
      margin: 8px 0 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 13px;
      line-height: 1.55;
      color: #8888A0;
    }
    .infra-footer {
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
    .infra-refresh-header {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: flex-end;
      gap: 12px 16px;
      margin-bottom: 16px;
    }
    .infra-refresh-actions {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }
    .infra-refresh-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .infra-spinner {
      width: 12px;
      height: 12px;
      border: 2px solid rgba(255, 255, 255, 0.2);
      border-top-color: #4F8EF7;
      border-radius: 50%;
      animation: infra-spin 0.7s linear infinite;
      flex-shrink: 0;
    }
    @keyframes infra-spin {
      to { transform: rotate(360deg); }
    }
    .infra-last-updated {
      font-size: 12px;
      color: #8888A0;
      white-space: nowrap;
    }
    .infra-filter-card {
      margin-bottom: 16px;
    }
    .infra-filter-title {
      font-size: 11px;
      font-weight: 600;
      color: #8888A0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }
    .infra-filter-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
    }
    .infra-filter-select {
      min-width: 150px;
      background: #16161F;
      border: 1px solid #1E1E2E;
      border-radius: 8px;
      padding: 7px 10px;
      color: #F0F0F5;
      font-size: 12px;
      outline: none;
    }
    .infra-filter-select:focus {
      border-color: #4F8EF7;
    }
    .infra-filter-footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #1E1E2E;
    }
    .infra-filter-count {
      font-size: 12px;
      color: #8888A0;
    }
    .infra-table-empty td {
      text-align: center;
      color: #8888A0;
      padding: 24px 12px;
    }

    .live-badge-text-short { display: none; }

    /* ─── Responsive ─── */
    @media (max-width: 1024px) {
      .content { padding: 20px 16px; }
      .topbar { padding: 0 16px; }
    }

    @media (max-width: 768px) {
      .admin-menu-toggle { display: inline-flex; }

      .admin-sidebar-backdrop {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 19;
        background: rgba(0, 0, 0, 0.55);
      }
      .admin-shell.admin-sidebar-open .admin-sidebar-backdrop {
        display: block;
      }

      .sidebar {
        width: min(280px, 88vw);
        transform: translateX(-100%);
        transition: transform 0.25s ease;
        box-shadow: none;
      }
      .admin-shell.admin-sidebar-open .sidebar {
        transform: translateX(0);
        box-shadow: 8px 0 32px rgba(0, 0, 0, 0.45);
      }
      .sidebar-brand h1,
      .sidebar-brand small,
      .sidebar-nav button span:nth-child(2),
      .sidebar-footer .info {
        display: block;
      }
      .sidebar-nav button {
        justify-content: flex-start;
        padding: 9px 10px;
      }

      .main { margin-left: 0; width: 100%; }

      .topbar {
        height: auto;
        min-height: 56px;
        padding: 8px 12px;
        flex-wrap: wrap;
        gap: 8px;
      }
      .topbar h2 {
        font-size: 14px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .topbar .right {
        margin-left: auto;
        flex-shrink: 0;
        gap: 8px;
      }
      .topbar .clock { display: none; }
      .live-badge-text-full { display: none; }
      .live-badge-text-short { display: inline; }

      .content { padding: 14px 12px; overflow-x: hidden; }

      .grid-4, .grid-3, .grid-2 { grid-template-columns: 1fr; }
      .pricing-grid { grid-template-columns: 1fr; }

      .card { padding: 16px; }
      .card-header-row {
        flex-wrap: wrap;
        gap: 8px;
        padding: 12px 14px;
      }

      .payment-card-grid {
        grid-template-columns: 1fr;
      }
      .payment-card-head {
        flex-direction: column;
        align-items: stretch;
      }
      .payment-card-meta {
        white-space: normal;
      }
      .payment-card-actions .btn {
        flex: 1 1 calc(50% - 4px);
        justify-content: center;
        min-width: 120px;
      }

      .payments-list { padding: 12px; }

      .recent-row {
        flex-direction: column;
        align-items: flex-start;
      }

      .admin-pricing-toast {
        left: 12px;
        right: 12px;
        bottom: 12px;
        max-width: none;
      }

      .infra-filter-select {
        min-width: 0;
        flex: 1 1 140px;
        width: 100%;
      }
    }

    @media (max-width: 480px) {
      .payment-card-actions {
        flex-direction: column;
      }
      .payment-card-actions .btn {
        width: 100%;
        flex: none;
      }
      .mini-tab {
        padding: 8px 12px;
        font-size: 11px;
      }
    }`;

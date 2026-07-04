export const styles = `/* ─── Reset & base ─── */
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      background: #0A0A0F;
      color: #F0F0F5;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      padding: 24px;
      line-height: 1.5;
    }
    .container { max-width: 1440px; margin: 0 auto; }

    /* ─── Typography ─── */
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
    .uppercase { text-transform: uppercase; letter-spacing: 0.5px; }

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
    }

    /* ─── Grid ─── */
    .grid-4 { display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

    /* ─── Stats ─── */
    .stat-label { font-size: 11px; font-weight: 600; color: #8888A0; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .stat-value { font-size: 24px; font-weight: 500; }
    .stat-sub { font-size: 11px; color: #44445A; margin-top: 4px; }

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
    .badge-dot {
      width: 6px; height: 6px; border-radius: 50%; display: inline-block;
    }
    .badge-green .badge-dot { background: #22C55E; }
    .badge-amber .badge-dot { background: #F59E0B; }
    .badge-red .badge-dot { background: #EF4444; }
    .badge-blue .badge-dot { background: #4F8EF7; }
    .badge-purple .badge-dot { background: #8B5CF6; }

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
      cursor: pointer;
      user-select: none;
    }
    th:hover { color: #8888A0; }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(30,30,46,0.4);
      vertical-align: middle;
      white-space: nowrap;
    }
    tr:nth-child(even) td { background: rgba(255,255,255,0.015); }

    /* ─── Filters ─── */
    .filter-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 16px;
      align-items: center;
      padding: 12px 0;
    }
    .filter-group {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .filter-group label {
      font-size: 12px;
      color: #8888A0;
      font-weight: 500;
    }
    .filter-group select, .filter-group input {
      background: #16161F;
      border: 1px solid #1E1E2E;
      border-radius: 6px;
      padding: 4px 10px;
      color: #F0F0F5;
      font-size: 12px;
      outline: none;
      height: 30px;
    }
    .filter-group select:focus, .filter-group input:focus {
      border-color: #4F8EF7;
    }
    .filter-group input[type="text"] { width: 140px; }

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
    }
    .btn:hover { background: #1E1E2E; }
    .btn-primary { background: #4F8EF7; border-color: #4F8EF7; color: #fff; }
    .btn-primary:hover { background: #3A7BE0; }
    .btn-success { background: #22C55E; border-color: #22C55E; color: #fff; }
    .btn-success:hover { background: #16A34A; }

    /* ─── Progress bar ─── */
    .progress {
      width: 60px;
      height: 4px;
      border-radius: 4px;
      background: #1E1E2E;
      overflow: hidden;
      display: inline-block;
      vertical-align: middle;
      margin-right: 6px;
    }
    .progress-bar {
      height: 100%;
      border-radius: 4px;
      background: #4F8EF7;
    }
    .progress-bar.amber { background: #F59E0B; }
    .progress-bar.red { background: #EF4444; }
    .progress-bar.green { background: #22C55E; }

    /* ─── Risk indicator ─── */
    .risk-low { color: #22C55E; }
    .risk-medium { color: #F59E0B; }
    .risk-high { color: #EF4444; }

    /* ─── Responsive ─── */
    @media (max-width: 768px) {
      .grid-4, .grid-3, .grid-2 { grid-template-columns: 1fr; }
      .filter-bar { flex-direction: column; align-items: stretch; }
    }`;

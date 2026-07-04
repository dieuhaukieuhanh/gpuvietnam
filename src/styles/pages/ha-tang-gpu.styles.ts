export const styles = `/* Reset & base */
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      background: #0A0A0F;
      color: #F0F0F5;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      padding: 24px;
      line-height: 1.5;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: #0A0A0F;
    }

    /* Cards */
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

    /* Grid */
    .grid-4 {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    /* Typography */
    .stat-label {
      font-size: 12px;
      font-weight: 600;
      color: #8888A0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .stat-value {
      font-family: 'JetBrains Mono', 'Courier New', monospace;
      font-size: 24px;
      font-weight: 500;
    }
    .stat-sub {
      font-size: 11px;
      color: #44445A;
      margin-top: 6px;
    }

    .color-blue { color: #4F8EF7; }
    .color-green { color: #22C55E; }
    .color-amber { color: #F59E0B; }
    .color-red { color: #EF4444; }
    .color-purple { color: #8B5CF6; }
    .color-sub { color: #8888A0; }
    .color-dim { color: #44445A; }

    /* Table */
    .table-wrap { overflow-x: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      text-align: left;
      padding: 10px 16px;
      font-size: 11px;
      font-weight: 600;
      color: #44445A;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid #1E1E2E;
      white-space: nowrap;
    }
    td {
      padding: 11px 16px;
      border-bottom: 1px solid rgba(30, 30, 46, 0.4);
      vertical-align: middle;
      white-space: nowrap;
    }
    tr:nth-child(even) td { background: rgba(255,255,255,0.01); }

    /* Badge */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge-healthy { background: #0F2E1A; color: #22C55E; }
    .badge-warning { background: #2E200A; color: #F59E0B; }
    .badge-critical { background: #2E0F0F; color: #EF4444; }
    .badge-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      display: inline-block;
    }
    .badge-healthy .badge-dot { background: #22C55E; }
    .badge-warning .badge-dot { background: #F59E0B; }
    .badge-critical .badge-dot { background: #EF4444; }

    /* Alert */
    .alert {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 10px;
      background: #2E0F0F;
      border: 1px solid rgba(239, 68, 68, 0.25);
      color: #EF4444;
    }
    .alert svg { flex-shrink: 0; }

    /* Button */
    .btn-refresh {
      padding: 4px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      background: #16161F;
      color: #F0F0F5;
      border: 1px solid #1E1E2E;
    }
    .btn-refresh:hover { background: #1E1E2E; }

    /* List */
    .suggestion-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .suggestion-list li {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 4px 0;
      color: #8888A0;
      font-size: 13px;
    }
    .suggestion-list li .check { color: #22C55E; }
    .suggestion-list li .warn { color: #F59E0B; }
    .suggestion-list li .info { color: #4F8EF7; }

    /* Spacing */
    .mt-2 { margin-top: 8px; }
    .mb-1 { margin-bottom: 4px; }
    .flex-between { display: flex; justify-content: space-between; align-items: center; }
    .flex-center { display: flex; align-items: center; gap: 6px; }

    .mono { font-family: 'JetBrains Mono', monospace; }
    .fw-600 { font-weight: 600; }
    .text-uppercase { text-transform: uppercase; letter-spacing: 0.5px; }`;

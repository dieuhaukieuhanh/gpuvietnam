export const styles = `/* ─── Reset & Base ─── */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0A0A0F;
      color: #F0F0F5;
      font-family: 'Inter', -apple-system, sans-serif;
      font-size: 13px;
      padding: 24px;
      line-height: 1.5;
    }
    .container { max-width: 1400px; margin: 0 auto; }

    /* ─── Typography ─── */
    .mono { font-family: 'JetBrains Mono', monospace; }
    .text-muted { color: #8888A0; }
    .text-dim { color: #44445A; }
    .text-green { color: #22C55E; }
    .text-amber { color: #F59E0B; }
    .text-red { color: #EF4444; }
    .text-blue { color: #4F8EF7; }
    .text-purple { color: #8B5CF6; }
    .fw-600 { font-weight: 600; }

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
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

    /* ─── Stat ─── */
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
    .badge-gray { background: #16161F; color: #8888A0; }

    /* ─── Tabs ─── */
    .tabs {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid #1E1E2E;
      padding-bottom: 0;
      margin-bottom: 20px;
    }
    .tab-btn {
      padding: 8px 18px;
      border: none;
      background: transparent;
      color: #8888A0;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: 0.2s;
      border-radius: 6px 6px 0 0;
    }
    .tab-btn:hover { color: #F0F0F5; background: #16161F; }
    .tab-btn.active {
      color: #4F8EF7;
      border-bottom-color: #4F8EF7;
      background: #1A2E52;
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

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

    /* ─── Progress / Bar ─── */
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
    .progress-bar { height: 100%; border-radius: 4px; background: #4F8EF7; }
    .progress-bar.green { background: #22C55E; }
    .progress-bar.amber { background: #F59E0B; }
    .progress-bar.red { background: #EF4444; }

    /* ─── Segment Matrix ─── */
    .matrix {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .matrix-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .matrix-label {
      width: 80px;
      font-size: 12px;
      color: #8888A0;
      flex-shrink: 0;
    }
    .matrix-bar {
      flex: 1;
      height: 18px;
      border-radius: 4px;
      background: #16161F;
      display: flex;
      overflow: hidden;
    }
    .matrix-seg {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 600;
      color: #fff;
      transition: 0.3s;
    }

    /* ─── Responsive ─── */
    @media (max-width: 768px) {
      .grid-4, .grid-3, .grid-2 { grid-template-columns: 1fr; }
      .tabs { flex-wrap: wrap; }
    }`;

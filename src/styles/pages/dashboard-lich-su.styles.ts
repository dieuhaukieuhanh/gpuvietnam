export const styles = `:root {
            --bg-primary: #0A0A0F;
            --bg-secondary: #111118;
            --bg-card: #16161F;
            --bg-card-hover: #1E1E2A;
            --bg-sidebar: #0D0D14;
            --border: #1E1E2E;
            --text-primary: #F1F1F5;
            --text-secondary: #9898A8;
            --text-muted: #6B6B7B;
            --accent-blue: #4F8EF7;
            --accent-purple: #8B5CF6;
            --accent-green: #10B981;
            --accent-red: #EF4444;
            --accent-orange: #F59E0B;
            --gradient-hero: linear-gradient(135deg, #4F8EF7 0%, #8B5CF6 50%, #A855F7 100%);
            --radius-sm: 8px;
            --radius-md: 12px;
            --radius-lg: 16px;
            --radius-xl: 20px;
            --radius-2xl: 24px;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Inter', sans-serif;
            background-color: var(--bg-primary);
            color: var(--text-primary);
            display: flex;
            min-height: 100vh;
        }

        /* ── Sidebar ───────────────────────────── */
        .sidebar {
            width: 240px;
            min-height: 100vh;
            background: var(--bg-sidebar);
            border-right: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            padding: 20px 0;
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            z-index: 100;
        }

        .sidebar-logo {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 0 20px 20px;
            border-bottom: 1px solid var(--border);
            margin-bottom: 8px;
            text-decoration: none;
            color: var(--text-primary);
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 700;
            font-size: 18px;
        }
        .sidebar-logo .logo-icon {
            width: 30px;
            height: 30px;
            background: var(--gradient-hero);
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 15px;
        }

        .sidebar-user {
            padding: 12px 20px;
            font-size: 13px;
            color: var(--text-secondary);
            border-bottom: 1px solid var(--border);
            margin-bottom: 8px;
        }
        .sidebar-user strong {
            color: var(--text-primary);
        }

        .sidebar-nav {
            flex: 1;
            display: flex;
            flex-direction: column;
            padding: 0 12px;
        }

        .sidebar-section {
            margin-bottom: 4px;
        }

        .sidebar-divider {
            border-top: 1px solid var(--border);
            margin: 8px 12px;
        }

        .sidebar-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: all 0.2s;
            font-size: 13.5px;
            color: var(--text-secondary);
            text-decoration: none;
            margin-bottom: 2px;
        }
        .sidebar-item:hover {
            background: var(--bg-card-hover);
            color: var(--text-primary);
        }
        .sidebar-item.active {
            background: rgba(79, 142, 247, 0.1);
            color: var(--accent-blue);
            font-weight: 600;
        }
        .sidebar-item .icon {
            font-size: 16px;
            width: 20px;
            text-align: center;
            flex-shrink: 0;
        }
        .sidebar-item.logout {
            color: var(--accent-red);
            margin-top: auto;
        }
        .sidebar-item.logout:hover {
            background: rgba(239, 68, 68, 0.1);
        }

        /* ── Main Content ──────────────────────── */
        .main-content {
            flex: 1;
            margin-left: 240px;
            padding: 28px 32px;
            min-height: 100vh;
        }

        .page-title {
            font-size: 26px;
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 700;
            margin-bottom: 6px;
        }
        .page-subtitle {
            font-size: 13.5px;
            color: var(--text-muted);
            margin-bottom: 28px;
        }

        /* ── Cards ─────────────────────────────── */
        .card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: 20px;
            margin-bottom: 16px;
        }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            font-size: 13px;
            color: var(--text-muted);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .card-header .view-all {
            font-size: 12px;
            color: var(--accent-blue);
            cursor: pointer;
            text-decoration: none;
            font-weight: 500;
            text-transform: none;
        }
        .card-header .view-all:hover {
            text-decoration: underline;
        }

        /* ── Session History ───────────────────── */
        .session-item {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 18px 20px;
            margin-bottom: 12px;
            transition: all 0.2s;
        }
        .session-item:hover {
            border-color: rgba(79, 142, 247, 0.3);
        }

        .session-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        .session-number {
            font-weight: 700;
            font-size: 14px;
            color: var(--accent-blue);
        }
        .session-date {
            font-size: 13px;
            color: var(--text-secondary);
        }
        .session-status {
            font-size: 11px;
            padding: 3px 10px;
            border-radius: 12px;
            font-weight: 600;
        }
        .session-status.completed {
            background: rgba(16, 185, 129, 0.1);
            color: var(--accent-green);
        }
        .session-status.interrupted {
            background: rgba(245, 158, 11, 0.1);
            color: var(--accent-orange);
        }
        .session-status.running {
            background: rgba(79, 142, 247, 0.1);
            color: var(--accent-blue);
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
        }

        .session-details {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
        }
        @media (max-width: 900px) {
            .session-details {
                grid-template-columns: 1fr;
            }
        }

        .session-detail {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12.5px;
            color: var(--text-secondary);
        }
        .session-detail .label {
            color: var(--text-muted);
            flex-shrink: 0;
            min-width: 100px;
        }
        .session-detail .value {
            color: var(--text-primary);
            font-weight: 500;
        }
        .session-detail .highlight {
            color: var(--accent-blue);
            font-weight: 600;
        }

        .session-divider {
            border-top: 1px solid var(--border);
            margin: 12px 0;
        }

        .view-all-link {
            text-align: center;
            padding: 12px;
            color: var(--accent-blue);
            font-size: 13px;
            cursor: pointer;
            text-decoration: none;
            display: block;
        }
        .view-all-link:hover {
            text-decoration: underline;
        }

        /* ── Responsive ────────────────────────── */
        @media (max-width: 768px) {
            .sidebar {
                width: 60px;
                padding: 16px 0;
            }
            .sidebar-logo {
                justify-content: center;
                padding: 0 8px 16px;
            }
            .sidebar-logo span:last-child {
                display: none;
            }
            .sidebar-user {
                display: none;
            }
            .sidebar-item {
                justify-content: center;
                padding: 10px;
            }
            .sidebar-item span:not(.icon) {
                display: none;
            }
            .sidebar-divider {
                margin: 4px 8px;
            }
            .main-content {
                margin-left: 60px;
                padding: 20px 16px;
            }
            .session-details {
                grid-template-columns: 1fr;
            }
        }`;

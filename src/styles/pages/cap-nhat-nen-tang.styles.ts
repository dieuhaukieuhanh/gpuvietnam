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

        /* ── Header ────────────────────────────── */
        .header {
            position: fixed;
            top: 0;
            left: 220px;
            right: 0;
            height: 56px;
            background: rgba(10, 10, 15, 0.9);
            backdrop-filter: blur(16px);
            border-bottom: 1px solid var(--border);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 24px;
            z-index: 50;
            gap: 16px;
        }
        .header-left {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 13px;
            color: var(--text-secondary);
        }
        .header-left strong { color: var(--text-primary); font-weight: 600; }
        .header-right { display: flex; align-items: center; gap: 16px; }
        @media (max-width: 768px) {
            .header { left: 50px; padding: 0 14px; }
        }

        .btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 8px 16px;
            border-radius: var(--radius-sm);
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 600;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.3s;
            border: none;
            white-space: nowrap;
        }
        .btn-primary { background: var(--gradient-hero); color: white; box-shadow: 0 4px 14px rgba(79, 142, 247, 0.25); }
        .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(79, 142, 247, 0.35); }
        .btn-accent {
            background: var(--accent-blue);
            color: white;
            font-weight: 700;
            padding: 10px 18px;
            border-radius: 50px;
            transition: all 0.3s;
        }
        .btn-accent:hover { background: #3A7DE8; }

        /* ── Sidebar ───────────────────────────── */
        .sidebar {
            width: 220px;
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
            padding: 0 16px 16px;
            border-bottom: 1px solid var(--border);
            margin-bottom: 8px;
            text-decoration: none;
            color: var(--text-primary);
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 700;
            font-size: 17px;
        }
        .sidebar-logo .logo-icon {
            width: 28px;
            height: 28px;
            background: var(--gradient-hero);
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
        }
        .sidebar-nav { flex: 1; display: flex; flex-direction: column; padding: 0 8px; }
        .sidebar-divider { border-top: 1px solid var(--border); margin: 6px 10px; }
        .sidebar-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 9px 10px;
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: all 0.2s;
            font-size: 13px;
            color: var(--text-secondary);
            text-decoration: none;
            margin-bottom: 1px;
        }
        .sidebar-item:hover { background: var(--bg-card-hover); color: var(--text-primary); }
        .sidebar-item .icon { font-size: 15px; width: 18px; text-align: center; flex-shrink: 0; }
        .sidebar-item.logout { color: var(--accent-red); margin-top: auto; }
        .sidebar-item.logout:hover { background: rgba(239, 68, 68, 0.1); }

        /* ── Main Content ──────────────────────── */
        .main-content {
            flex: 1;
            margin-left: 220px;
            margin-top: 56px;
            padding: 28px 32px;
            min-height: 100vh;
            max-width: 900px;
        }
        @media (max-width: 768px) {
            .main-content { margin-left: 50px; padding: 16px; }
            .sidebar { width: 50px; padding: 14px 0; }
            .sidebar-logo { justify-content: center; padding: 0 4px 14px; }
            .sidebar-logo span:last-child { display: none; }
            .sidebar-item { justify-content: center; padding: 8px; }
            .sidebar-item span:not(.icon) { display: none; }
            .sidebar-divider { margin: 4px 6px; }
        }

        .page-title {
            font-size: 26px;
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 700;
            margin-bottom: 4px;
        }
        .page-subtitle {
            font-size: 13.5px;
            color: var(--text-muted);
            margin-bottom: 32px;
        }

        /* ── Timeline ──────────────────────────── */
        .timeline {
            position: relative;
            padding-left: 40px;
        }
        .timeline::before {
            content: '';
            position: absolute;
            left: 16px;
            top: 8px;
            bottom: 0;
            width: 2px;
            background: var(--border);
        }

        .timeline-month {
            position: relative;
            margin-bottom: 40px;
        }
        .timeline-month:last-child { margin-bottom: 0; }

        .timeline-marker {
            position: absolute;
            left: -40px;
            top: 4px;
            width: 34px;
            height: 34px;
            border-radius: 50%;
            background: var(--bg-card);
            border: 2px solid var(--accent-blue);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            font-weight: 700;
            color: var(--accent-blue);
            z-index: 1;
        }

        .timeline-date {
            font-size: 15px;
            font-weight: 700;
            font-family: 'Space Grotesk', sans-serif;
            color: var(--accent-blue);
            margin-bottom: 16px;
        }

        /* ── Update Items ──────────────────────── */
        .update-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .update-item {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 16px 20px;
            display: flex;
            gap: 14px;
            align-items: flex-start;
            transition: all 0.2s;
        }
        .update-item:hover { border-color: rgba(79, 142, 247, 0.3); }

        .update-icon {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            flex-shrink: 0;
            margin-top: 2px;
        }
        .update-icon.feature { background: rgba(16, 185, 129, 0.1); color: var(--accent-green); }
        .update-icon.improve { background: rgba(79, 142, 247, 0.1); color: var(--accent-blue); }
        .update-icon.model { background: rgba(139, 92, 246, 0.1); color: var(--accent-purple); }
        .update-icon.fix { background: rgba(245, 158, 11, 0.1); color: var(--accent-orange); }

        .update-content { flex: 1; }
        .update-tag {
            display: inline-block;
            padding: 2px 10px;
            border-radius: 12px;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
        }
        .update-tag.feature { background: rgba(16, 185, 129, 0.1); color: var(--accent-green); }
        .update-tag.improve { background: rgba(79, 142, 247, 0.1); color: var(--accent-blue); }
        .update-tag.model { background: rgba(139, 92, 246, 0.1); color: var(--accent-purple); }
        .update-tag.fix { background: rgba(245, 158, 11, 0.1); color: var(--accent-orange); }

        .update-title {
            font-size: 14px;
            font-weight: 600;
            color: var(--text-primary);
            margin-bottom: 4px;
        }
        .update-desc {
            font-size: 12px;
            color: var(--text-muted);
            line-height: 1.6;
        }

        /* ── Subscribe Box ─────────────────────── */
        .subscribe-box {
            margin-top: 40px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: 24px;
            text-align: center;
        }
        .subscribe-box h3 {
            font-size: 18px;
            font-family: 'Space Grotesk', sans-serif;
            margin-bottom: 8px;
        }
        .subscribe-box p {
            font-size: 13px;
            color: var(--text-muted);
            margin-bottom: 16px;
        }
        .subscribe-form {
            display: flex;
            gap: 8px;
            max-width: 400px;
            margin: 0 auto;
        }
        .subscribe-input {
            flex: 1;
            padding: 10px 14px;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            color: var(--text-primary);
            font-size: 13px;
            font-family: 'Inter', sans-serif;
        }
        .subscribe-input:focus { outline: none; border-color: var(--accent-blue); }
        .subscribe-input::placeholder { color: var(--text-muted); }

        /* ── Footer ────────────────────────────── */
        .footer {
            margin-top: 40px;
            text-align: center;
            font-size: 11px;
            color: var(--text-muted);
        }
        .footer a { color: var(--text-secondary); text-decoration: none; }
        .footer a:hover { color: var(--text-primary); }`;

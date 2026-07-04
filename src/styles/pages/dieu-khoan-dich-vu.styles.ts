export const styles = `:root {
            --bg-primary: #0A0A0F;
            --bg-secondary: #111118;
            --bg-card: #16161F;
            --bg-card-hover: #1E1E2A;
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
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Inter', sans-serif;
            background-color: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.7;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }

        /* ── Header ────────────────────────────── */
        .header {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 100;
            background: rgba(10, 10, 15, 0.88);
            backdrop-filter: blur(20px);
            border-bottom: 1px solid var(--border);
            padding: 14px 0;
        }
        .header .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .logo {
            display: flex;
            align-items: center;
            gap: 10px;
            text-decoration: none;
            color: var(--text-primary);
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 700;
            font-size: 21px;
        }
        .logo-icon {
            width: 34px;
            height: 34px;
            background: var(--gradient-hero);
            border-radius: var(--radius-sm);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 17px;
        }
        .nav {
            display: flex;
            align-items: center;
            gap: 28px;
        }
        .nav a {
            color: var(--text-secondary);
            text-decoration: none;
            font-size: 13.5px;
            font-weight: 500;
            transition: color 0.2s;
        }
        .nav a:hover { color: var(--text-primary); }

        .btn {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            padding: 11px 22px;
            border-radius: var(--radius-md);
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 600;
            font-size: 13.5px;
            text-decoration: none;
            cursor: pointer;
            transition: all 0.3s;
            border: none;
            white-space: nowrap;
        }
        .btn-primary {
            background: var(--gradient-hero);
            color: white;
            box-shadow: 0 4px 18px rgba(79, 142, 247, 0.28);
        }
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 28px rgba(79, 142, 247, 0.38);
        }
        @media (max-width: 768px) {
            .nav a { font-size: 12px; }
            .nav { gap: 16px; }
        }

        /* ── Main Content ──────────────────────── */
        .main-content {
            flex: 1;
            padding-top: 120px;
            padding-bottom: 60px;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 0 24px;
        }
        @media (max-width: 768px) {
            .container { padding: 0 16px; }
        }

        .page-title {
            font-size: 36px;
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 700;
            margin-bottom: 8px;
            line-height: 1.2;
        }
        .page-subtitle {
            font-size: 13px;
            color: var(--text-muted);
            margin-bottom: 40px;
            font-style: italic;
        }

        /* ── Content Sections ──────────────────── */
        .section {
            margin-bottom: 36px;
        }
        .section h2 {
            font-size: 20px;
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 700;
            margin-bottom: 16px;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .section h2 .num {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: rgba(79, 142, 247, 0.1);
            color: var(--accent-blue);
            font-size: 14px;
            font-weight: 700;
            flex-shrink: 0;
        }
        .section h3 {
            font-size: 16px;
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 600;
            margin-bottom: 10px;
            color: var(--text-primary);
            margin-top: 20px;
        }
        .section p {
            font-size: 14px;
            color: var(--text-secondary);
            line-height: 1.8;
            margin-bottom: 14px;
        }
        .section ul {
            list-style: none;
            padding: 0;
        }
        .section ul li {
            font-size: 14px;
            color: var(--text-secondary);
            line-height: 1.8;
            padding: 6px 0;
            padding-left: 20px;
            position: relative;
        }
        .section ul li::before {
            content: '•';
            position: absolute;
            left: 4px;
            color: var(--accent-blue);
            font-weight: 700;
        }

        /* ── Table ─────────────────────────────── */
        .info-table {
            width: 100%;
            border-collapse: collapse;
            margin: 16px 0;
            font-size: 13px;
        }
        .info-table th {
            text-align: left;
            padding: 10px 14px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border);
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-muted);
        }
        .info-table td {
            padding: 10px 14px;
            border-bottom: 1px solid var(--border);
            color: var(--text-secondary);
            vertical-align: top;
            line-height: 1.7;
        }
        .info-table tr:last-child td { border-bottom: none; }
        .info-table td:first-child {
            font-weight: 600;
            color: var(--text-primary);
            white-space: nowrap;
        }

        /* ── Warning Box ───────────────────────── */
        .warning-box {
            background: rgba(245, 158, 11, 0.05);
            border: 1px solid rgba(245, 158, 11, 0.2);
            border-radius: var(--radius-lg);
            padding: 20px 24px;
            margin: 20px 0;
        }
        .warning-box h3 {
            color: var(--accent-orange);
            font-size: 15px;
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 700;
            margin-bottom: 8px;
            margin-top: 0;
        }
        .warning-box ul {
            margin-top: 8px;
        }
        .warning-box ul li {
            font-size: 13px;
            color: var(--text-secondary);
            line-height: 1.8;
        }
        .warning-box ul li strong {
            color: var(--accent-orange);
        }

        /* ── Danger Box ────────────────────────── */
        .danger-box {
            background: rgba(239, 68, 68, 0.05);
            border: 1px solid rgba(239, 68, 68, 0.2);
            border-radius: var(--radius-lg);
            padding: 20px 24px;
            margin: 16px 0;
        }
        .danger-box h3 {
            color: var(--accent-red);
            font-size: 15px;
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 700;
            margin-bottom: 8px;
            margin-top: 0;
        }
        .danger-box ul {
            margin-top: 8px;
        }
        .danger-box ul li {
            font-size: 13px;
            color: var(--text-secondary);
            line-height: 1.8;
        }
        .danger-box ul li strong {
            color: var(--accent-red);
        }

        /* ── Prohibited List ───────────────────── */
        .prohibited-list {
            display: grid;
            grid-template-columns: 1fr;
            gap: 12px;
            margin: 16px 0;
        }
        .prohibited-item {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 16px 20px;
            display: flex;
            gap: 14px;
            align-items: flex-start;
            transition: all 0.2s;
        }
        .prohibited-item:hover { border-color: rgba(239, 68, 68, 0.3); }
        .prohibited-icon {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: rgba(239, 68, 68, 0.1);
            color: var(--accent-red);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            flex-shrink: 0;
        }
        .prohibited-content { flex: 1; }
        .prohibited-content h4 {
            font-size: 14px;
            font-weight: 600;
            color: var(--text-primary);
            margin-bottom: 4px;
        }
        .prohibited-content p {
            font-size: 12px;
            color: var(--text-muted);
            margin-bottom: 0;
            line-height: 1.6;
        }

        /* ── Contact Box ───────────────────────── */
        .contact-box {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: 28px 32px;
            margin-top: 40px;
            text-align: center;
        }
        .contact-box h3 {
            font-size: 20px;
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 700;
            margin-bottom: 8px;
        }
        .contact-box p {
            font-size: 14px;
            color: var(--text-secondary);
            margin-bottom: 16px;
        }
        .contact-info {
            display: flex;
            gap: 32px;
            justify-content: center;
            flex-wrap: wrap;
            font-size: 14px;
            color: var(--text-primary);
            font-weight: 500;
        }
        .contact-info span {
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }

        /* ── Closing Tagline ───────────────────── */
        .closing-tagline {
            text-align: center;
            margin-top: 40px;
            padding: 24px;
            font-size: 15px;
            font-weight: 600;
            color: var(--accent-purple);
            font-family: 'Space Grotesk', sans-serif;
            border-top: 1px solid var(--border);
        }

        /* ── Footer ────────────────────────────── */
        .footer {
            border-top: 1px solid var(--border);
            padding: 36px 0;
            text-align: center;
        }
        .footer .container {
            max-width: 1200px;
        }
        .footer .footer-links {
            display: flex;
            gap: 22px;
            justify-content: center;
            flex-wrap: wrap;
            margin-bottom: 14px;
        }
        .footer .footer-links a {
            color: var(--text-muted);
            text-decoration: none;
            font-size: 12.5px;
        }
        .footer .footer-links a:hover { color: var(--text-primary); }
        .footer .copyright {
            font-size: 11.5px;
            color: var(--text-muted);
        }`;

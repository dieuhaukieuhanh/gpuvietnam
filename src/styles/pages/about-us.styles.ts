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
            line-height: 1.7;
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
        .nav a.active { color: var(--accent-blue); font-weight: 600; }

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

        /* ── Page Content ──────────────────────── */
        .page-content {
            padding-top: 120px;
            padding-bottom: 80px;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            padding: 0 24px;
        }
        @media (max-width: 768px) {
            .container { padding: 0 16px; }
            .nav a { font-size: 12px; }
            .nav { gap: 16px; }
        }

        .page-title {
            font-size: 42px;
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 700;
            margin-bottom: 16px;
            line-height: 1.2;
        }
        .page-title .highlight {
            background: var(--gradient-hero);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        /* ── Intro Section ─────────────────────── */
        .intro-section {
            margin-bottom: 48px;
        }
        .intro-section .lead {
            font-size: 18px;
            color: var(--text-secondary);
            line-height: 1.8;
            margin-bottom: 24px;
        }
        .intro-section .belief {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: 28px 32px;
            margin-bottom: 32px;
            border-left: 3px solid var(--accent-purple);
        }
        .intro-section .belief p {
            font-size: 17px;
            color: var(--text-primary);
            font-weight: 500;
            line-height: 1.8;
        }

        /* ── Story Section ─────────────────────── */
        .story-section {
            margin-bottom: 48px;
        }
        .story-section h2 {
            font-size: 24px;
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 700;
            margin-bottom: 20px;
            color: var(--text-primary);
        }
        .story-section p {
            font-size: 15px;
            color: var(--text-secondary);
            line-height: 1.9;
            margin-bottom: 20px;
        }

        /* ── Values Grid ───────────────────────── */
        .values-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            margin: 40px 0 48px;
        }
        @media (max-width: 768px) {
            .values-grid { grid-template-columns: 1fr; }
        }
        .value-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 24px;
            text-align: center;
            transition: all 0.3s;
        }
        .value-card:hover {
            border-color: var(--accent-blue);
            transform: translateY(-3px);
        }
        .value-icon {
            font-size: 36px;
            margin-bottom: 14px;
        }
        .value-card h3 {
            font-size: 16px;
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 600;
            margin-bottom: 8px;
        }
        .value-card p {
            font-size: 13px;
            color: var(--text-muted);
            line-height: 1.6;
        }

        /* ─── Closing Section ──────────────────── */
        .closing-section {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: 32px;
            text-align: center;
            margin-top: 40px;
        }
        .closing-section h2 {
            font-size: 28px;
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 700;
            margin-bottom: 12px;
        }
        .closing-section .tagline {
            font-size: 20px;
            color: var(--accent-purple);
            font-weight: 600;
            font-family: 'Space Grotesk', sans-serif;
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

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
            --shadow-pro: 0 0 40px rgba(79, 142, 247, 0.13);
            --radius-sm: 8px;
            --radius-md: 12px;
            --radius-lg: 16px;
            --radius-xl: 20px;
            --radius-2xl: 24px;
            --radius-3xl: 28px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', sans-serif;
            background-color: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.6;
            overflow-x: hidden;
        }
        h1, h2, h3, h4, h5, h6 {
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 600;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
        .header {
            position: fixed; top: 0; left: 0; right: 0; z-index: 1000;
            background: rgba(10, 10, 15, 0.88); backdrop-filter: blur(20px);
            border-bottom: 1px solid var(--border); padding: 14px 0;
        }
        .header .container { display: flex; align-items: center; justify-content: space-between; }
        .logo {
            display: flex; align-items: center; gap: 10px; text-decoration: none;
            color: var(--text-primary); font-family: 'Space Grotesk', sans-serif;
            font-weight: 700; font-size: 21px;
        }
        .logo-icon {
            width: 34px; height: 34px; background: var(--gradient-hero);
            border-radius: var(--radius-sm); display: flex;
            align-items: center; justify-content: center; font-size: 17px;
        }
        .nav { display: flex; align-items: center; gap: 28px; }
        .nav a { color: var(--text-secondary); text-decoration: none; font-size: 13.5px; font-weight: 500; transition: color 0.2s; }
        .nav a:hover { color: var(--text-primary); }
        .btn {
            display: inline-flex; align-items: center; gap: 7px;
            padding: 11px 22px; border-radius: var(--radius-md);
            font-family: 'Space Grotesk', sans-serif; font-weight: 600;
            font-size: 13.5px; text-decoration: none; cursor: pointer;
            transition: all 0.3s; border: none; white-space: nowrap;
        }
        .btn-primary { background: var(--gradient-hero); color: white; box-shadow: 0 4px 18px rgba(79, 142, 247, 0.28); }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(79, 142, 247, 0.38); }
        .btn-secondary { background: transparent; color: var(--text-primary); border: 1.5px solid var(--border); }
        .btn-secondary:hover { border-color: var(--accent-blue); background: rgba(79, 142, 247, 0.05); }
        .btn-outline { background: transparent; color: var(--accent-blue); border: 1.5px solid var(--accent-blue); }
        .btn-outline:hover { background: rgba(79, 142, 247, 0.1); }
        .btn-outline-purple { background: transparent; color: var(--accent-purple); border: 1.5px solid var(--accent-purple); }
        .btn-outline-purple:hover { background: rgba(139, 92, 246, 0.1); }
        .btn-sm { padding: 7px 15px; font-size: 12px; border-radius: var(--radius-sm); }
        .btn-lg { padding: 15px 30px; font-size: 15.5px; border-radius: var(--radius-lg); }
        .btn-full { width: 100%; justify-content: center; }
        .hero {
            min-height: clamp(520px, 76svh, 720px);
            padding: 92px 0 64px;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            position: relative;
            overflow: hidden;
        }
        .hero::before {
            content: ''; position: absolute; top: -50%; left: 50%;
            transform: translateX(-50%); width: 750px; height: 750px;
            background: radial-gradient(circle, rgba(79, 142, 247, 0.07) 0%, transparent 70%);
            pointer-events: none;
        }
        .hero h1 {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: clamp(16px, 2.8vw, 24px);
            margin-bottom: clamp(26px, 4vw, 34px);
            max-width: 850px;
            margin-left: auto;
            margin-right: auto;
        }
        .hero-headline-lead {
            display: block;
            font-family: 'Be Vietnam Pro', 'Inter', sans-serif;
            font-size: clamp(30px, 4.4vw, 44px);
            font-weight: 600;
            letter-spacing: -0.015em;
            line-height: 1.32;
            color: var(--text-primary);
        }
        .hero-headline-brand {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex-wrap: nowrap;
            white-space: nowrap;
            font-size: clamp(34px, 5.4vw, 56px);
            line-height: 1.08;
        }
        .hero h1 .gradient-text {
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 700;
            letter-spacing: -0.025em;
            background: var(--gradient-hero); -webkit-background-clip: text;
            -webkit-text-fill-color: transparent; background-clip: text;
        }
        .hero-headline-brand .h1-dot-sep {
            margin: 0 clamp(10px, 2vw, 16px);
            flex-shrink: 0;
        }
        .h1-dot-sep {
            display: inline-block;
            width: clamp(8px, 1.2vw, 11px);
            height: clamp(8px, 1.2vw, 11px);
            background: var(--accent-green);
            border-radius: 50%;
            vertical-align: middle;
            animation: pulse 2s infinite;
            box-shadow: 0 0 10px rgba(16, 185, 129, 0.7);
        }
        .hero .subtitle-strong {
            font-size: 14px;
            color: var(--text-muted);
            max-width: 650px;
            margin: clamp(22px, 3.5vw, 28px) auto 0;
            line-height: 1.55;
        }
        .hero-buttons {
            display: flex;
            gap: 14px;
            justify-content: center;
            flex-wrap: wrap;
            margin-top: clamp(8px, 2vw, 14px);
        }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        .hero-eyebrow-wrap { text-align: center; margin-bottom: clamp(20px, 3vw, 28px); padding: 0 16px; }
        .hero-eyebrow {
            display: inline-flex; align-items: center; justify-content: center;
            font-size: clamp(11px, 2.6vw, 13px); font-weight: 600; color: var(--accent-blue);
            letter-spacing: 0.02em; box-sizing: border-box; white-space: nowrap;
            padding: 8px 16px; border-radius: 50px;
            background: rgba(79, 142, 247, 0.1); border: 1px solid rgba(79, 142, 247, 0.35);
            text-shadow: 0 0 18px rgba(79, 142, 247, 0.45);
        }
        @media (max-width: 768px) {
            .hero {
                min-height: clamp(460px, 80svh, 580px);
                padding: 80px 0 52px;
            }
            .hero-eyebrow {
                white-space: normal;
                max-width: min(320px, 100%);
                line-height: 1.45;
                animation: none;
            }
            .hero-headline-lead {
                font-size: clamp(26px, 6.8vw, 34px);
                line-height: 1.38;
            }
            .hero-headline-brand {
                font-size: clamp(28px, 8.2vw, 40px);
            }
            .hero-buttons {
                gap: 12px;
            }
            .hero-buttons .btn-lg {
                min-height: 52px;
                font-size: 16px;
                padding: 14px 22px;
            }
            .cta-section .btn-lg {
                min-height: 52px;
                font-size: 16px;
                width: 100%;
                max-width: 360px;
            }
            .section-title {
                font-size: clamp(24px, 6vw, 34px);
                padding: 0 8px;
            }
            .section-subtitle {
                font-size: 14px;
                padding: 0 8px;
                margin-bottom: 36px;
                line-height: 1.55;
            }
            .section {
                padding: 56px 0;
            }
            .btn-lg {
                white-space: normal;
                text-align: center;
                max-width: 100%;
            }
            .plan-card .badge {
                white-space: normal;
            }
        }
        @media (max-width: 480px) {
            .container { padding: 0 16px; }
            .hero-buttons .btn-lg {
                width: 100%;
                justify-content: center;
            }
        }
        .section { padding: 80px 0; }
        .section-dark { background: var(--bg-secondary); }
        .section-title { text-align: center; font-size: 34px; margin-bottom: 14px; }
        .section-subtitle { text-align: center; color: var(--text-secondary); font-size: 15.5px; margin-bottom: 44px; }
        .filter-bar {
            display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;
            margin-bottom: 36px;
        }
        .filter-btn {
            padding: 10px 20px; border-radius: 50px; font-size: 13.5px; font-weight: 500;
            cursor: pointer; border: 1.5px solid var(--border); background: var(--bg-card);
            color: var(--text-secondary); transition: all 0.3s;
            display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
        }
        .filter-btn:hover { border-color: var(--accent-blue); color: var(--text-primary); background: var(--bg-card-hover); }
        .filter-btn.active { border-color: var(--accent-blue); background: rgba(79, 142, 247, 0.1); color: var(--accent-blue); font-weight: 600; }
        .workstation-grid {
            display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px;
            transition: all 0.4s ease;
            align-items: stretch;
        }
        @media (max-width: 900px) { .workstation-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 600px) { .workstation-grid { grid-template-columns: 1fr; } }
        .workstation-card {
            background: var(--bg-card); border: 1px solid var(--border);
            border-radius: var(--radius-lg); overflow: hidden; cursor: pointer;
            transition: all 0.4s ease;
            display: flex; flex-direction: column; height: 100%; width: 100%;
        }
        .workstation-card-wrapper { transition: all 0.4s ease; display: flex; height: 100%; }
        .workstation-card-wrapper.hidden { display: none; }
        .workstation-card:hover { border-color: var(--accent-blue); transform: translateY(-3px); box-shadow: 0 8px 28px rgba(0,0,0,0.3); }
        .workstation-image {
            width: 100%; height: 190px; background: var(--bg-secondary);
            display: flex; align-items: center; justify-content: center;
            font-size: 44px; position: relative; overflow: hidden;
        }
        .workstation-image .gpu-badge {
            position: absolute; top: 10px; right: 10px;
            background: rgba(0,0,0,0.75); color: var(--accent-blue);
            padding: 4px 10px; border-radius: 18px; font-size: 10.5px;
            font-weight: 600; border: 1px solid rgba(79, 142, 247, 0.4);
        }
        .workstation-image .overlay-tag {
            position: absolute; top: 10px; left: 10px;
            background: rgba(0,0,0,0.7); color: white;
            padding: 3px 9px; border-radius: 18px; font-size: 10.5px; font-weight: 500;
        }
        .workstation-info { padding: 14px; flex: 1; display: flex; flex-direction: column; }
        .workstation-info h4 { font-size: 14.5px; margin-bottom: 5px; }
        .workstation-info .desc { font-size: 11.5px; color: var(--text-muted); margin-bottom: 9px; flex: 1; }
        .workstation-meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 10.5px; color: var(--text-secondary); margin-top: auto; }
        .workstation-meta span { display: inline-flex; align-items: center; gap: 3px; }
        .tag { display: inline-block; padding: 2px 9px; border-radius: 18px; font-size: 10px; font-weight: 600; }
        .tag.blue { background: rgba(79, 142, 247, 0.15); color: var(--accent-blue); }
        .tag.green { background: rgba(16, 185, 129, 0.15); color: var(--accent-green); }
        .tag.purple { background: rgba(139, 92, 246, 0.15); color: var(--accent-purple); }
        .no-results {
            text-align: center; padding: 40px; color: var(--text-muted);
            grid-column: 1 / -1;
        }
        .no-results p { font-size: 16px; margin-bottom: 8px; }
        .no-results .sub { font-size: 14px; }
        .infra-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 20px; }
        @media (max-width: 700px) { .infra-grid { grid-template-columns: 1fr; } }
        .infra-card {
            background: var(--bg-card); border: 1px solid var(--border);
            border-radius: var(--radius-lg); padding: 28px; text-align: center;
            transition: all 0.3s;
        }
        .infra-card:hover { border-color: var(--accent-blue); transform: translateY(-3px); }
        .infra-card .infra-icon { font-size: 40px; margin-bottom: 14px; }
        .infra-card h4 { font-size: 17px; margin-bottom: 6px; }
        .infra-card .gpu-list { font-size: 14px; color: var(--accent-blue); font-weight: 600; margin-bottom: 4px; }
        .infra-card p { font-size: 12.5px; color: var(--text-muted); }
        .infra-note { text-align: center; margin-top: 24px; font-size: 14px; color: var(--text-secondary); font-style: italic; }
        .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 36px; margin-top: 36px; }
        @media (max-width: 700px) { .steps { grid-template-columns: 1fr; } }
        .step { text-align: center; }
        .step-number {
            width: 52px; height: 52px; border-radius: 50%; background: var(--gradient-hero);
            display: flex; align-items: center; justify-content: center;
            font-size: 20px; font-weight: 700; margin: 0 auto 18px; color: white;
        }
        .step h4 { font-size: 17px; margin-bottom: 7px; }
        .step p { color: var(--text-muted); font-size: 13.5px; }
        .pricing-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 20px;
            max-width: 1100px;
            margin: 0 auto;
            align-items: stretch;
        }
        @media (max-width: 1000px) {
            .pricing-grid { grid-template-columns: 1fr; max-width: 480px; }
        }
        .plan-card {
            background: var(--bg-card); border: 1px solid var(--border);
            border-radius: var(--radius-3xl); padding: 30px;
            display: grid;
            grid-template-rows: subgrid;
            grid-row: span 8;
            row-gap: 0;
            position: relative; transition: all 0.3s;
        }
        @media (max-width: 1000px) {
            .plan-card {
                display: flex;
                flex-direction: column;
                grid-row: auto;
                grid-template-rows: none;
            }
        }
        .plan-card:hover { border-color: rgba(79, 142, 247, 0.5); }
        .plan-card.featured { border-color: var(--accent-blue); box-shadow: var(--shadow-pro); background: #111118; }
        .plan-card .badge {
            position: absolute; top: -13px; left: 50%; transform: translateX(-50%);
            background: var(--accent-blue); color: white; padding: 4px 16px;
            border-radius: 20px; font-size: 11.5px; font-weight: 600; white-space: nowrap;
        }
        .plan-card .plan-card-head,
        .plan-card .plan-audience-block,
        .plan-card .plan-bestfor-block,
        .plan-card .plan-features-block,
        .plan-card .plan-card-footer {
            display: flex;
            flex-direction: column;
            min-height: 0;
        }
        .plan-card .plan-title-row {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 6px;
        }
        .plan-card .plan-icon { font-size: 26px; margin-bottom: 0; line-height: 1; }
        .plan-card .plan-name { font-size: 26px; font-weight: 700; margin-bottom: 0; }
        .plan-card .plan-tagline { font-size: 13px; color: var(--text-secondary); margin-bottom: 0; line-height: 1.5; }
        .plan-card .plan-audience-block { margin-bottom: 0; padding-top: 24px; padding-bottom: 20px; }
        .plan-card .plan-audience-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .plan-card .plan-audience-item {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            font-size: 13px;
            color: var(--text-primary);
            line-height: 1.4;
        }
        .plan-card .plan-price-row {
            padding-top: 4px;
            padding-bottom: 22px;
            margin-bottom: 0;
            border-bottom: 1px solid var(--border);
            align-self: start;
            width: 100%;
        }
        .plan-card .plan-bestfor-block {
            padding-top: 22px;
        }
        .plan-card .plan-bestfor-block .plan-list,
        .plan-card .plan-features-block .plan-list {
            margin-bottom: 0;
        }
        .plan-card .plan-real-output {
            background: #0A0A0F;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 12px 14px;
            font-size: 11.5px;
            color: var(--text-secondary);
            margin: 20px 0;
            line-height: 1.5;
            align-self: start;
            width: 100%;
            box-sizing: border-box;
        }
        .plan-card .plan-features-block {
            padding-bottom: 0;
        }
        .plan-card .plan-trust {
            background: #0D0D14;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 14px;
            margin: 20px 0 0;
            align-self: start;
            width: 100%;
            box-sizing: border-box;
        }
        .plan-card .plan-card-footer {
            padding-top: 20px;
            flex: 1;
        }
        .plan-card .plan-price { font-size: 38px; font-weight: 700; display: flex; align-items: baseline; gap: 4px; }
        .plan-card .plan-price span { font-size: 14px; font-weight: 400; color: var(--text-muted); }
        .plan-card .plan-price-note { font-size: 11.5px; color: var(--text-muted); margin-top: 4px; }
        .plan-card .plan-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted); margin-bottom: 10px; }
        .plan-card .plan-list { list-style: none; margin-bottom: 20px; }
        .plan-card .plan-list li { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; margin-bottom: 9px; color: var(--text-primary); }
        .plan-card .plan-list li.excluded { color: #444460; }
        .plan-card .plan-list li .check-icon { color: var(--accent-green); flex-shrink: 0; margin-top: 2px; }
        .plan-card .plan-list li .x-icon { color: #333350; flex-shrink: 0; margin-top: 2px; }
        .plan-card .plan-real-output strong { color: var(--accent-blue); }
        .plan-card .plan-trust li { font-size: 11.5px; color: var(--text-muted); margin-bottom: 7px; padding-left: 12px; border-left: 2px solid rgba(79, 142, 247, 0.4); line-height: 1.5; list-style: none; }
        .plan-card .plan-trust li:last-child { margin-bottom: 0; }
        .plan-card .plan-upgrade { margin-bottom: 20px; }
        .plan-card .plan-cta { margin-top: auto; }
        .toggle-wrapper { display: flex; justify-content: center; margin-bottom: 40px; }
        .toggle-group {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            background: #111118;
            padding: 4px;
            border-radius: 18px;
            border: 1px solid var(--border);
            flex-wrap: wrap;
            justify-content: center;
        }
        .toggle-label {
            display: inline-flex;
            align-items: center;
            padding: 10px 16px;
            border-radius: 14px;
            font-size: 13.5px;
            font-weight: 700;
            background: rgba(139, 92, 246, 0.18);
            color: var(--accent-purple);
            white-space: nowrap;
        }
        .toggle-btn { padding: 10px 22px; border-radius: 14px; font-size: 13.5px; font-weight: 500; cursor: pointer; border: none; background: transparent; color: var(--text-muted); transition: all 0.25s; }
        .toggle-btn.active { background: var(--accent-blue); color: white; }
        .cta-section { text-align: center; padding: 80px 0; background: var(--bg-secondary); border-radius: var(--radius-xl); margin: 40px 24px; }
        .cta-section h3 { font-size: 30px; margin-bottom: 14px; }
        .cta-section p { color: var(--text-secondary); margin-bottom: 22px; }
        .cta-section-workspace {
            text-align: center;
            padding: 56px 24px;
            margin: 40px 24px;
            border-radius: var(--radius-xl);
            background: linear-gradient(180deg, rgba(79, 142, 247, 0.1) 0%, rgba(22, 22, 31, 0.85) 100%);
            border: 1px solid rgba(79, 142, 247, 0.18);
        }
        .cta-section-workspace-icon {
            font-size: 52px;
            line-height: 1;
            margin-bottom: 18px;
        }
        .cta-section-workspace h3 {
            font-size: 26px;
            font-weight: 700;
            margin-bottom: 10px;
            color: var(--text-primary);
        }
        .cta-section-workspace p {
            color: var(--text-secondary);
            font-size: 15px;
            line-height: 1.6;
            max-width: 460px;
            margin: 0 auto 24px;
        }
        .btn-dashboard-go {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 14px 28px;
            border-radius: var(--radius-md);
            border: none;
            background: #1d4ed8;
            color: #fff;
            font-family: inherit;
            font-size: 16px;
            font-weight: 600;
            text-decoration: none;
            cursor: pointer;
            transition: background 0.2s, transform 0.15s;
            box-shadow: 0 4px 14px rgba(29, 78, 216, 0.35);
        }
        .btn-dashboard-go:hover {
            background: #1e40af;
            transform: translateY(-1px);
        }
        .footer { border-top: 1px solid var(--border); padding: 36px 0; text-align: center; }
        .footer .footer-links { display: flex; gap: 22px; justify-content: center; flex-wrap: wrap; margin-bottom: 14px; }
        .footer .footer-links a { color: var(--text-muted); text-decoration: none; font-size: 12.5px; }
        .footer .footer-links a:hover { color: var(--text-primary); }
        .footer .copyright { font-size: 11.5px; color: var(--text-muted); }
        .modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.72); z-index: 2000; align-items: center; justify-content: center; }
        .modal-overlay.active { display: flex; }
        .modal { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-2xl); padding: 36px; max-width: 500px; width: 90%; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.5); position: relative; }
        .modal .close-btn { position: absolute; top: 14px; right: 14px; background: none; border: none; color: var(--text-muted); font-size: 18px; cursor: pointer; }
        .modal h3 { font-size: 22px; margin-bottom: 10px; }
        .modal .workstation-name { color: var(--accent-blue); font-weight: 600; }
        .modal .options { display: flex; gap: 14px; margin: 22px 0; }
        @media (max-width: 500px) { .modal .options { flex-direction: column; } }
        .modal .option { flex: 1; background: var(--bg-secondary); border: 2px solid var(--border); border-radius: var(--radius-lg); padding: 18px; cursor: pointer; transition: all 0.3s; text-align: center; position: relative; }
        .modal .option:hover { border-color: var(--accent-blue); }
        .modal .option.recommended { border-color: var(--accent-blue); }
        .modal .option.recommended::after { content: '⭐ GỢI Ý TỐT NHẤT'; position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: var(--accent-blue); color: white; padding: 2px 10px; border-radius: 10px; font-size: 10px; font-weight: 700; white-space: nowrap; }
        .modal .option h4 { font-size: 13px; margin-bottom: 3px; }
        .modal .option .price-sm { font-size: 19px; font-weight: 700; color: var(--accent-blue); }
        .modal .option .spec { font-size: 10.5px; color: var(--text-muted); margin-top: 3px; }
        .modal .trial-link { display: block; margin-top: 14px; color: var(--accent-green); text-decoration: none; font-weight: 600; font-size: 13.5px; }
        .modal-workstation {
            max-width: 960px;
            width: 92%;
            max-height: 88vh;
            overflow-y: auto;
            text-align: left;
            padding: 28px 32px 32px;
        }
        .modal-workstation .close-btn {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 10px;
            width: 36px;
            height: 36px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        .modal-workstation .close-btn:hover { color: var(--text-primary); border-color: var(--accent-blue); }
        .modal-workstation-header { padding-right: 44px; margin-bottom: 4px; }
        .modal-workstation-header h3 { font-size: 24px; margin-bottom: 6px; text-align: left; }
        .modal-workstation-header p { font-size: 14px; color: var(--text-secondary); text-align: left; }
        .modal-workstation-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
            margin-top: 20px;
            align-items: stretch;
        }
        @media (max-width: 900px) { .modal-workstation-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 560px) { .modal-workstation-grid { grid-template-columns: 1fr; } }
        .faq-grid { max-width: 700px; margin: 0 auto; }
        .faq-item { border-bottom: 1px solid var(--border); padding: 18px 0; }
        .faq-item h4 { font-size: 15px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
        .faq-item p { font-size: 13px; color: var(--text-muted); margin-top: 8px; display: none; }
        .faq-item.open p { display: block; }`;

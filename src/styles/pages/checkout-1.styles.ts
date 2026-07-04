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
        .btn {
            display: inline-flex; align-items: center; gap: 7px;
            padding: 11px 22px; border-radius: var(--radius-md);
            font-family: 'Space Grotesk', sans-serif; font-weight: 600;
            font-size: 13.5px; text-decoration: none; cursor: pointer;
            transition: all 0.3s; border: none; white-space: nowrap;
        }
        .btn-secondary { background: transparent; color: var(--text-primary); border: 1.5px solid var(--border); }
        .btn-secondary:hover { border-color: var(--accent-blue); background: rgba(79, 142, 247, 0.05); }
        .btn-primary { background: var(--gradient-hero); color: white; box-shadow: 0 4px 18px rgba(79, 142, 247, 0.28); }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(79, 142, 247, 0.38); }
        .btn-outline-purple { background: transparent; color: var(--accent-purple); border: 1.5px solid var(--accent-purple); }
        .btn-outline-purple:hover { background: rgba(139, 92, 246, 0.1); }
        .btn-full { width: 100%; justify-content: center; }
        .btn-disabled {
            opacity: 0.5;
            cursor: not-allowed !important;
            pointer-events: none;
        }
        .btn-sm { padding: 8px 16px; font-size: 11px; border-radius: 6px; }

        .main-content {
            padding-top: 120px;
            padding-bottom: 80px;
        }
        .section-title { text-align: center; font-size: 34px; margin-bottom: 14px; }
        .section-subtitle { text-align: center; color: var(--text-secondary); font-size: 15.5px; margin-bottom: 44px; }

        .env-card {
            background: var(--bg-card);
            border: 1px solid var(--accent-blue);
            border-radius: var(--radius-2xl);
            padding: 24px 32px;
            max-width: 600px;
            margin: 0 auto 48px;
            display: flex;
            align-items: center;
            gap: 20px;
            box-shadow: 0 0 30px rgba(79, 142, 247, 0.1);
        }
        .env-icon { font-size: 48px; flex-shrink: 0; }
        .env-info h3 { font-size: 20px; margin-bottom: 4px; }
        .env-info p { font-size: 13px; color: var(--text-muted); }
        .env-change { margin-left: auto; font-size: 12px; color: var(--accent-blue); cursor: pointer; text-decoration: none; flex-shrink: 0; background: none; border: none; font-family: inherit; padding: 0; }
        .env-change:hover { text-decoration: underline; }

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

        .pricing-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; max-width: 1100px; margin: 0 auto 60px; align-items: stretch; }
        @media (max-width: 1000px) { .pricing-grid { grid-template-columns: 1fr; max-width: 480px; } }
        .plan-card {
            background: var(--bg-card); border: 1px solid var(--border);
            border-radius: var(--radius-3xl); padding: 30px; display: flex;
            flex-direction: column; position: relative; transition: all 0.4s;
        }
        .plan-card:hover { border-color: rgba(79, 142, 247, 0.5); }
        .plan-card.featured { border-color: var(--accent-blue); box-shadow: var(--shadow-pro); background: #111118; }
        .plan-card.dimmed {
            opacity: 0.55;
            transform: scale(0.98);
            filter: grayscale(20%);
        }
        .plan-card.highlighted {
            border-color: var(--accent-green) !important;
            box-shadow: 0 0 30px rgba(16, 185, 129, 0.25) !important;
            transform: scale(1.02);
        }
        .plan-card .badge {
            position: absolute; top: -13px; left: 50%; transform: translateX(-50%);
            background: var(--accent-blue); color: white; padding: 4px 16px;
            border-radius: 20px; font-size: 11.5px; font-weight: 600; white-space: nowrap;
        }
        .plan-card .plan-icon { font-size: 26px; margin-bottom: 18px; }
        .plan-card .plan-name { font-size: 26px; font-weight: 700; margin-bottom: 6px; }
        .plan-card .plan-tagline { font-size: 13px; color: var(--text-secondary); margin-bottom: 24px; line-height: 1.5; }
        .plan-card .plan-price-row { padding-bottom: 22px; margin-bottom: 22px; border-bottom: 1px solid var(--border); }
        .plan-card .plan-price { font-size: 38px; font-weight: 700; display: flex; align-items: baseline; gap: 4px; }
        .plan-card .plan-price span { font-size: 14px; font-weight: 400; color: var(--text-muted); }
        .plan-card .plan-price-note { font-size: 11.5px; color: var(--text-muted); margin-top: 4px; }
        .plan-card .plan-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted); margin-bottom: 10px; }
        .plan-card .plan-list { list-style: none; margin-bottom: 20px; }
        .plan-card .plan-list li { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; margin-bottom: 9px; color: var(--text-primary); }
        .plan-card .plan-list li.excluded { color: #444460; }
        .plan-card .plan-list li .check-icon { color: var(--accent-green); flex-shrink: 0; margin-top: 2px; }
        .plan-card .plan-list li .x-icon { color: #333350; flex-shrink: 0; margin-top: 2px; }
        .plan-card .plan-real-output { background: #0A0A0F; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px 14px; font-size: 11.5px; color: var(--text-secondary); margin-bottom: 20px; line-height: 1.5; }
        .plan-card .plan-real-output strong { color: var(--accent-blue); }
        .plan-card .plan-trust { background: #0D0D14; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 14px; margin-bottom: 24px; }
        .plan-card .plan-trust li { font-size: 11.5px; color: var(--text-muted); margin-bottom: 7px; padding-left: 12px; border-left: 2px solid rgba(79, 142, 247, 0.4); line-height: 1.5; list-style: none; }
        .plan-card .plan-trust li:last-child { margin-bottom: 0; }
        .plan-card .plan-cta { margin-top: auto; }

        .payment-section {
            max-width: 600px;
            margin: 0 auto;
            background: var(--bg-card);
            border: 1px solid var(--accent-green);
            border-radius: var(--radius-2xl);
            padding: 36px;
            text-align: center;
            transition: all 0.5s;
        }
        .payment-section h3 { font-size: 24px; margin-bottom: 8px; }
        .payment-section .subtitle { font-size: 14px; color: var(--text-secondary); margin-bottom: 28px; }
        .qr-placeholder {
            width: 200px; height: 200px;
            margin: 0 auto 24px;
            background: var(--bg-secondary);
            border: 2px dashed var(--border);
            border-radius: var(--radius-lg);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-muted);
            font-size: 13px;
            text-align: center;
            line-height: 1.5;
        }
        .transfer-info {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 16px;
            text-align: left;
            font-size: 13px;
            color: var(--text-secondary);
            line-height: 2;
        }
        .transfer-info strong { color: var(--text-primary); }
        .transfer-info .highlight {
            background: rgba(79, 142, 247, 0.1);
            padding: 2px 8px;
            border-radius: 4px;
            color: var(--accent-blue);
            font-weight: 600;
        }
        .copy-btn {
            margin-top: 12px;
            padding: 8px 16px;
            background: var(--accent-blue);
            color: white;
            border: none;
            border-radius: var(--radius-sm);
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            transition: all 0.3s;
        }
        .copy-btn:hover { opacity: 0.9; }

        /* ── Checkbox ──────────────────────────── */
        .checkbox-label {
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
            padding: 12px;
            background: var(--bg-secondary);
            border-radius: var(--radius-md);
            border: 1px solid var(--border);
            margin-top: 20px;
            text-align: left;
            transition: border-color 0.2s;
        }
        .checkbox-label:hover {
            border-color: var(--accent-blue);
        }
        .checkbox-label input[type="checkbox"] {
            width: 18px;
            height: 18px;
            accent-color: var(--accent-blue);
            cursor: pointer;
            flex-shrink: 0;
        }
        .checkbox-label span {
            font-size: 13px;
            color: var(--text-secondary);
        }

        /* ── Modal Overlay ─────────────────────── */
        .modal-overlay {
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7);
            z-index: 200;
            align-items: center;
            justify-content: center;
        }
        .modal-overlay.active { display: flex; }
        .modal-box {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-2xl);
            padding: 28px;
            max-width: 420px;
            width: 90%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            text-align: center;
        }
        .modal-box h3 {
            font-size: 18px;
            margin-bottom: 12px;
            font-family: 'Space Grotesk', sans-serif;
        }
        .modal-box .info-box {
            background: var(--bg-secondary);
            padding: 14px;
            border-radius: var(--radius-md);
            margin-bottom: 16px;
            text-align: left;
            font-size: 13px;
            line-height: 1.8;
        }
        .modal-box .info-box div { margin-bottom: 2px; }
        .modal-box .btn-group {
            display: flex;
            gap: 10px;
            justify-content: center;
        }

        /* ── Env Picker Modal ──────────────────── */
        .env-modal-box {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-2xl);
            padding: 28px 32px 32px;
            max-width: 900px;
            width: 92%;
            max-height: 85vh;
            overflow-y: auto;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        }
        .env-modal-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 8px;
        }
        .env-modal-header h3 {
            font-size: 22px;
            font-family: 'Space Grotesk', sans-serif;
            margin-bottom: 4px;
        }
        .env-modal-header p {
            font-size: 14px;
            color: var(--text-secondary);
        }
        .env-modal-close {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 10px;
            color: var(--text-muted);
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
            padding: 8px 11px;
            flex-shrink: 0;
        }
        .env-modal-close:hover { color: var(--text-primary); border-color: var(--accent-blue); }
        .env-picker-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
            margin-top: 24px;
            align-items: stretch;
        }
        @media (max-width: 768px) { .env-picker-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 480px) { .env-picker-grid { grid-template-columns: 1fr; } }
        .env-picker-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: 18px;
            cursor: pointer;
            text-align: left;
            transition: all 0.25s;
            display: flex;
            flex-direction: column;
            gap: 10px;
            font-family: inherit;
            color: inherit;
            width: 100%;
            height: 100%;
        }
        .env-picker-card:hover {
            border-color: var(--accent-blue);
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(0,0,0,0.25);
        }
        .env-picker-card.selected {
            border-color: var(--accent-green);
            box-shadow: 0 0 0 1px var(--accent-green), 0 8px 24px rgba(16, 185, 129, 0.15);
        }
        .env-picker-icon {
            font-size: 36px;
            line-height: 1;
        }
        .env-picker-card h4 {
            font-size: 14.5px;
            font-family: 'Space Grotesk', sans-serif;
            line-height: 1.35;
        }
        .env-picker-card p {
            font-size: 12px;
            color: var(--text-muted);
            line-height: 1.5;
            flex: 1;
        }

        .footer { border-top: 1px solid var(--border); padding: 36px 0; text-align: center; margin-top: 60px; }
        .footer .copyright { font-size: 11.5px; color: var(--text-muted); }

        .selection-indicator {
            text-align: center;
            margin-bottom: 16px;
            font-size: 14px;
            color: var(--accent-green);
            font-weight: 600;
            display: none;
        }
        .selection-indicator.show { display: block; }

        .checkout-auth-section { max-width: 640px; margin: 48px auto 0; }
        .checkout-auth-title { text-align: center; font-size: 20px; margin-bottom: 8px; }
        .checkout-auth-subtitle { text-align: center; color: var(--text-secondary); font-size: 14px; margin-bottom: 20px; }
        .checkout-auth-hint { text-align: center; color: var(--text-muted); margin-top: 40px; font-size: 14px; }
        .auth-panel { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-2xl); padding: 24px; }
        .auth-panel-tabs { display: flex; gap: 8px; margin-bottom: 18px; }
        .auth-panel-tabs button { flex: 1; padding: 10px; border-radius: var(--radius-md); border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-muted); cursor: pointer; font-family: inherit; font-weight: 600; }
        .auth-panel-tabs button.active { border-color: var(--accent-blue); color: var(--accent-blue); background: rgba(79,142,247,0.1); }
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 8px; }
        .form-group input { width: 100%; padding: 12px 14px; border-radius: var(--radius-md); border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary); font-size: 14px; font-family: inherit; }
        .form-group input:focus { outline: none; border-color: var(--accent-blue); }
        .form-note { font-size: 12px; color: var(--text-muted); margin-top: 12px; line-height: 1.6; }
        .error-msg { color: #f87171; font-size: 13px; margin-bottom: 14px; padding: 10px 12px; background: rgba(248,113,113,0.08); border-radius: var(--radius-md); border: 1px solid rgba(248,113,113,0.25); }
        .user-badge { text-align: center; margin-bottom: 20px; padding: 12px 16px; background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.25); border-radius: var(--radius-md); color: var(--accent-green); font-size: 14px; }
        .payment-section { max-width: 640px; margin: 0 auto; background: var(--bg-card); border: 1px solid var(--accent-green); border-radius: var(--radius-2xl); padding: 28px 24px; text-align: center; }
        .payment-section .subtitle { font-size: 13px; color: var(--text-secondary); margin-bottom: 20px; }
        .qr-placeholder { width: 200px; height: 200px; margin: 0 auto 20px; background: var(--bg-secondary); border: 2px dashed var(--border); border-radius: var(--radius-lg); display: flex; align-items: center; justify-content: center; font-size: 13px; color: var(--text-muted); }
        .transfer-info { background: var(--bg-secondary); padding: 14px; border-radius: var(--radius-md); margin-bottom: 14px; font-size: 13px; text-align: left; }
        .transfer-info .highlight { color: var(--accent-green); font-weight: 600; word-break: break-word; }
        .copy-btn { background: var(--bg-secondary); border: 1px solid var(--border); color: var(--text-primary); padding: 10px 18px; border-radius: var(--radius-md); cursor: pointer; font-size: 13px; margin-bottom: 18px; }
        .checkbox-label { display: flex; align-items: flex-start; gap: 10px; text-align: left; cursor: pointer; }
        .checkbox-label span { font-size: 13px; color: var(--text-secondary); }
        .btn-disabled { opacity: 0.5; cursor: not-allowed !important; pointer-events: none; }
        .btn-lg { padding: 14px 28px; font-size: 15px; width: 100%; justify-content: center; }
        .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 200; align-items: center; justify-content: center; }
        .modal-overlay.active { display: flex; }
        .modal-box { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-2xl); padding: 28px; max-width: 420px; width: 90%; text-align: center; }
        .modal-box .info-box { background: var(--bg-secondary); padding: 14px; border-radius: var(--radius-md); margin-bottom: 16px; text-align: left; font-size: 13px; line-height: 1.8; }
        .modal-box .btn-group { display: flex; gap: 10px; justify-content: center; }`;

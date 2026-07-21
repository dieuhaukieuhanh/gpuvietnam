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
        .container { max-width: 800px; margin: 0 auto; padding: 0 24px; }
        
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
        .section-title { text-align: center; font-size: 28px; margin-bottom: 8px; }
        .section-subtitle { text-align: center; color: var(--text-secondary); font-size: 14px; margin-bottom: 32px; }

        /* Gói đã chọn */
        .selected-plan-card {
            background: var(--bg-card);
            border: 2px solid var(--accent-green);
            border-radius: var(--radius-2xl);
            padding: 28px;
            margin-bottom: 32px;
            text-align: center;
            box-shadow: 0 0 30px rgba(16, 185, 129, 0.15);
        }
        .selected-plan-card .plan-title-row {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 4px;
        }
        .selected-plan-card .plan-icon { font-size: 36px; margin-bottom: 0; line-height: 1; }
        .selected-plan-card .plan-name { font-size: 28px; font-weight: 700; margin-bottom: 0; }
        .selected-plan-card .plan-price { font-size: 36px; font-weight: 700; color: var(--accent-green); }
        .selected-plan-card .plan-price span { font-size: 14px; font-weight: 400; color: var(--text-muted); }
        .selected-plan-card .plan-note { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
        .selected-plan-card .change-plan { display: inline-block; margin-top: 12px; font-size: 12px; color: var(--accent-blue); cursor: pointer; text-decoration: none; }
        .selected-plan-card .change-plan:hover { text-decoration: underline; }

        /* Chọn môi trường */
        .env-selection-title { text-align: center; font-size: 20px; margin-bottom: 20px; }
        .env-grid {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 32px;
        }
        .env-option {
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 16px 20px;
            border: 1.5px solid var(--border);
            border-radius: var(--radius-lg);
            cursor: pointer;
            transition: all 0.3s;
            background: var(--bg-card);
            width: 100%;
            text-align: left;
            font-family: inherit;
            color: inherit;
        }
        .env-option.env-option-custom { border-style: dashed; border-color: rgba(139, 92, 246, 0.45); }
        .env-option:hover { border-color: var(--accent-blue); background: var(--bg-card-hover); }
        .env-option.selected { border-color: var(--accent-green); background: rgba(16, 185, 129, 0.05); }
        .env-option .env-radio {
            width: 20px; height: 20px;
            border-radius: 50%;
            border: 2px solid var(--border);
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            transition: all 0.3s;
        }
        .env-option.selected .env-radio {
            border-color: var(--accent-green);
            background: var(--accent-green);
        }
        .env-option.selected .env-radio::after {
            content: '✓';
            color: white;
            font-size: 12px;
            font-weight: 700;
        }
        .env-option .env-emoji { font-size: 28px; flex-shrink: 0; }
        .env-option .env-info h4 { font-size: 14px; margin-bottom: 2px; }
        .env-option .env-info p { font-size: 11px; color: var(--text-muted); }
        .env-selection-hint {
            text-align: center;
            font-size: 13px;
            color: var(--text-muted);
            margin: -12px 0 16px;
        }
        .env-selected-note {
            text-align: center;
            font-size: 14px;
            color: var(--accent-green);
            margin-bottom: 20px;
        }
        .steps {
            display: flex;
            justify-content: center;
            gap: 8px;
            flex-wrap: wrap;
            margin-bottom: 28px;
            font-size: 12px;
        }
        .step-item {
            padding: 6px 14px;
            border-radius: 20px;
            border: 1px solid var(--border);
            color: var(--text-muted);
            background: var(--bg-secondary);
        }
        .step-item.done { border-color: var(--accent-green); color: var(--accent-green); }
        .step-item.active {
            border-color: var(--accent-blue);
            color: var(--accent-blue);
            background: rgba(79, 142, 247, 0.1);
            font-weight: 600;
        }
        .register-cta-section {
            max-width: 520px;
            margin: 0 auto;
            text-align: center;
        }
        .register-cta-note {
            margin-top: 14px;
            font-size: 12px;
            color: var(--text-muted);
            line-height: 1.6;
        }
        .btn-lg { padding: 14px 28px; font-size: 15px; }

        /* Payment Section */
        .payment-section {
            max-width: 600px;
            margin: 0 auto;
            background: var(--bg-card);
            border: 1px solid var(--accent-green);
            border-radius: var(--radius-2xl);
            padding: 36px;
            text-align: center;
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

        .footer { border-top: 1px solid var(--border); padding: 36px 0; text-align: center; margin-top: 60px; }
        .footer .copyright { font-size: 11.5px; color: var(--text-muted); }`;

export const styles = `:root {
            --bg-primary: #0A0A0F;
            --bg-secondary: #111118;
            --bg-card: #16161F;
            --border: #1E1E2E;
            --text-primary: #F1F1F5;
            --text-secondary: #9898A8;
            --text-muted: #6B6B7B;
            --accent-blue: #4F8EF7;
            --accent-purple: #8B5CF6;
            --accent-green: #10B981;
            --gradient-hero: linear-gradient(135deg, #4F8EF7 0%, #8B5CF6 50%, #A855F7 100%);
            --radius-md: 12px;
            --radius-lg: 16px;
            --radius-2xl: 24px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', sans-serif;
            background-color: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.6;
        }
        h1, h2, h3, h4 { font-family: 'Space Grotesk', sans-serif; font-weight: 600; }
        .container { max-width: 640px; margin: 0 auto; padding: 0 24px; }
        .header {
            position: fixed; top: 0; left: 0; right: 0; z-index: 1000;
            background: rgba(10, 10, 15, 0.88); backdrop-filter: blur(20px);
            border-bottom: 1px solid var(--border); padding: 14px 0;
        }
        .header .container { display: flex; align-items: center; justify-content: space-between; max-width: 1100px; }
        .logo {
            display: flex; align-items: center; gap: 10px; text-decoration: none;
            color: var(--text-primary); font-family: 'Space Grotesk', sans-serif;
            font-weight: 700; font-size: 21px;
        }
        .logo-icon {
            width: 34px; height: 34px; background: var(--gradient-hero);
            border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 17px;
        }
        .btn {
            display: inline-flex; align-items: center; justify-content: center; gap: 7px;
            padding: 11px 22px; border-radius: var(--radius-md);
            font-family: 'Space Grotesk', sans-serif; font-weight: 600;
            font-size: 13.5px; text-decoration: none; cursor: pointer;
            transition: all 0.3s; border: none;
        }
        .btn-primary { background: var(--gradient-hero); color: white; box-shadow: 0 4px 18px rgba(79, 142, 247, 0.28); width: 100%; }
        .btn-primary:hover { transform: translateY(-1px); }
        .btn-primary:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }
        .btn-secondary { background: transparent; color: var(--text-primary); border: 1.5px solid var(--border); }
        .btn-secondary:hover { border-color: var(--accent-blue); }
        .btn-sm { padding: 8px 16px; font-size: 11px; border-radius: 6px; width: auto; }
        .main-content { padding-top: 120px; padding-bottom: 80px; }
        .section-title { text-align: center; font-size: 28px; margin-bottom: 8px; }
        .section-subtitle { text-align: center; color: var(--text-secondary); font-size: 14px; margin-bottom: 28px; }
        .steps {
            display: flex; justify-content: center; gap: 8px; flex-wrap: wrap;
            margin-bottom: 32px; font-size: 12px;
        }
        .step-item {
            padding: 6px 14px; border-radius: 20px; border: 1px solid var(--border);
            color: var(--text-muted); background: var(--bg-secondary);
        }
        .step-item.done { border-color: var(--accent-green); color: var(--accent-green); }
        .step-item.active { border-color: var(--accent-blue); color: var(--accent-blue); background: rgba(79,142,247,0.1); font-weight: 600; }
        .order-summary {
            background: var(--bg-card); border: 1px solid var(--border);
            border-radius: var(--radius-2xl); padding: 20px 24px; margin-bottom: 24px;
        }
        .order-summary h4 { font-size: 14px; color: var(--text-secondary); margin-bottom: 12px; }
        .order-row { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; margin-bottom: 8px; }
        .order-row span:last-child { color: var(--text-secondary); text-align: right; }
        .form-card {
            background: var(--bg-card); border: 1px solid var(--border);
            border-radius: var(--radius-2xl); padding: 28px 24px;
        }
        .form-group { margin-bottom: 18px; }
        .form-group label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 8px; }
        .form-group input {
            width: 100%; padding: 12px 14px; border-radius: var(--radius-md);
            border: 1px solid var(--border); background: var(--bg-secondary);
            color: var(--text-primary); font-size: 14px; font-family: inherit;
        }
        .form-group input:focus { outline: none; border-color: var(--accent-blue); }
        .form-note {
            font-size: 12px; color: var(--text-muted); margin-top: 14px; line-height: 1.6;
            padding: 12px 14px; background: rgba(139, 92, 246, 0.08);
            border-radius: var(--radius-md); border: 1px solid rgba(139, 92, 246, 0.2);
        }
        .error-msg {
            color: #f87171; font-size: 13px; margin-bottom: 14px;
            padding: 10px 12px; background: rgba(248,113,113,0.08);
            border-radius: var(--radius-md); border: 1px solid rgba(248,113,113,0.25);
        }
        .success-msg {
            color: var(--accent-green); font-size: 13px; line-height: 1.7;
            padding: 12px 14px; background: rgba(16, 185, 129, 0.08);
            border-radius: var(--radius-md); border: 1px solid rgba(16, 185, 129, 0.25);
        }
        .payment-section {
            background: var(--bg-card); border: 1px solid var(--border);
            border-radius: var(--radius-2xl); padding: 28px 24px; text-align: center;
        }
        .payment-section h3 { font-size: 20px; margin-bottom: 6px; }
        .payment-section .subtitle { font-size: 13px; color: var(--text-secondary); margin-bottom: 20px; }
        .qr-placeholder {
            width: 200px; height: 200px; margin: 0 auto 20px;
            background: var(--bg-secondary); border: 2px dashed var(--border);
            border-radius: var(--radius-lg); display: flex; align-items: center;
            justify-content: center; font-size: 13px; color: var(--text-muted); line-height: 1.5;
        }
        .transfer-info {
            background: var(--bg-secondary); padding: 14px; border-radius: var(--radius-md);
            margin-bottom: 14px; font-size: 13px; text-align: left;
        }
        .transfer-info .highlight { color: var(--accent-green); font-weight: 600; word-break: break-word; }
        .copy-btn {
            background: var(--bg-secondary); border: 1px solid var(--border);
            color: var(--text-primary); padding: 10px 18px; border-radius: var(--radius-md);
            cursor: pointer; font-size: 13px; margin-bottom: 18px;
        }
        .copy-btn:hover { border-color: var(--accent-blue); }
        .checkbox-label {
            display: flex; align-items: flex-start; gap: 10px; text-align: left;
            cursor: pointer; margin-bottom: 4px;
        }
        .checkbox-label span { font-size: 13px; color: var(--text-secondary); }
        .btn-disabled { opacity: 0.5; cursor: not-allowed !important; pointer-events: none; }
        .modal-overlay {
            display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7);
            z-index: 200; align-items: center; justify-content: center;
        }
        .modal-overlay.active { display: flex; }
        .modal-box {
            background: var(--bg-card); border: 1px solid var(--border);
            border-radius: var(--radius-2xl); padding: 28px; max-width: 420px; width: 90%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5); text-align: center;
        }
        .modal-box h3 { font-size: 18px; margin-bottom: 12px; }
        .modal-box .info-box {
            background: var(--bg-secondary); padding: 14px; border-radius: var(--radius-md);
            margin-bottom: 16px; text-align: left; font-size: 13px; line-height: 1.8;
        }
        .modal-box .btn-group { display: flex; gap: 10px; justify-content: center; }
        .footer { border-top: 1px solid var(--border); padding: 36px 0; text-align: center; margin-top: 60px; }
        .footer .copyright { font-size: 11.5px; color: var(--text-muted); }
        .auth-panel {
            background: var(--bg-card); border: 1px solid var(--border);
            border-radius: var(--radius-2xl); padding: 24px;
        }
        .auth-panel-tabs { display: flex; gap: 8px; margin-bottom: 18px; }
        .auth-panel-tabs button {
            flex: 1; padding: 10px; border-radius: var(--radius-md);
            border: 1px solid var(--border); background: var(--bg-secondary);
            color: var(--text-muted); cursor: pointer; font-family: inherit; font-weight: 600;
        }
        .auth-panel-tabs button.active {
            border-color: var(--accent-blue); color: var(--accent-blue);
            background: rgba(79,142,247,0.1);
        }
        .auth-switch { font-size: 13px; color: var(--text-secondary); text-align: center; }
        .auth-switch a { color: var(--accent-blue); text-decoration: none; }
        .otp-inputs {
            display: flex; gap: 10px; justify-content: center; margin: 24px 0 8px;
        }
        .otp-box {
            width: 48px; height: 56px; text-align: center; font-size: 22px; font-weight: 700;
            border-radius: var(--radius-md); border: 1px solid var(--border);
            background: var(--bg-secondary); color: var(--text-primary); font-family: inherit;
        }
        .otp-box:focus { outline: none; border-color: var(--accent-blue); }
        .dev-otp-banner {
            background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35);
            border-radius: var(--radius-md); padding: 14px 16px; margin-bottom: 20px; text-align: center;
        }
        .dev-otp-banner strong { display: block; font-size: 13px; margin-bottom: 8px; color: #fbbf24; }
        .dev-otp-banner p { font-size: 13px; color: var(--text-secondary); margin: 4px 0; }
        .dev-otp-code {
            font-family: 'Space Grotesk', monospace; font-size: 28px; font-weight: 700;
            letter-spacing: 6px; color: var(--accent-green);
        }
        .dev-otp-hint { font-size: 12px !important; color: var(--text-muted) !important; }`;

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
        .header-right {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        @media (max-width: 768px) {
            .header { left: 50px; padding: 0 14px; }
        }

        .header-notif {
            position: relative;
            font-size: 18px;
            cursor: pointer;
            color: #4A4A5A;
            transition: color 0.2s;
            background: none;
            border: none;
            padding: 4px;
        }
        .header-notif:hover { color: #6B6B7B; }
        .header-notif .badge {
            position: absolute;
            top: 0;
            right: 0;
            width: 8px;
            height: 8px;
            background: var(--accent-red);
            border-radius: 50%;
        }

        .wallet-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 14px;
            border-radius: 50px;
            background: rgba(16, 185, 129, 0.08);
            border: 1px solid rgba(16, 185, 129, 0.2);
            cursor: pointer;
            transition: all 0.3s;
            font-size: 13px;
            font-weight: 600;
            color: var(--accent-green);
        }
        .wallet-btn:hover {
            background: rgba(16, 185, 129, 0.15);
            border-color: rgba(16, 185, 129, 0.4);
        }
        .wallet-btn .wallet-amount { color: var(--accent-green); }

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
        .btn-secondary { background: transparent; color: var(--text-secondary); border: 1px solid var(--border); }
        .btn-secondary:hover { border-color: var(--accent-blue); color: var(--text-primary); }
        .btn-danger { background: rgba(239, 68, 68, 0.08); color: var(--accent-red); border: 1px solid rgba(239, 68, 68, 0.2); }
        .btn-danger:hover { background: rgba(239, 68, 68, 0.15); }
        .btn-sm { padding: 5px 10px; font-size: 10px; border-radius: 6px; }

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
        .sidebar-item.active { background: rgba(79, 142, 247, 0.1); color: var(--accent-blue); font-weight: 600; }
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
            max-width: 800px;
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
            margin-bottom: 6px;
        }
        .page-subtitle {
            font-size: 13.5px;
            color: var(--text-muted);
            margin-bottom: 24px;
        }

        /* ── Card ──────────────────────────────── */
        .card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: 24px;
            margin-bottom: 20px;
        }
        .card-header {
            font-size: 13px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-muted);
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
        }

        /* ── Form ──────────────────────────────── */
        .form-group {
            margin-bottom: 16px;
        }
        .form-label {
            display: block;
            font-size: 12px;
            font-weight: 500;
            color: var(--text-secondary);
            margin-bottom: 6px;
        }
        .form-input {
            width: 100%;
            padding: 10px 14px;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            color: var(--text-primary);
            font-size: 13px;
            font-family: 'Inter', sans-serif;
            transition: border-color 0.2s;
        }
        .form-input:focus {
            outline: none;
            border-color: var(--accent-blue);
        }
        .form-input::placeholder {
            color: var(--text-muted);
        }
        .form-hint {
            font-size: 11px;
            color: var(--text-muted);
            margin-top: 4px;
        }

        /* ── Toggle Switch ─────────────────────── */
        .toggle-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 0;
            border-bottom: 1px solid var(--border);
        }
        .toggle-row:last-child { border-bottom: none; }
        .toggle-label {
            font-size: 13px;
            color: var(--text-primary);
        }
        .toggle-desc {
            font-size: 11px;
            color: var(--text-muted);
            margin-top: 2px;
        }
        .toggle-switch {
            position: relative;
            width: 44px;
            height: 24px;
            flex-shrink: 0;
        }
        .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        .toggle-slider {
            position: absolute;
            cursor: pointer;
            top: 0; left: 0; right: 0; bottom: 0;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 24px;
            transition: all 0.3s;
        }
        .toggle-slider::before {
            content: "";
            position: absolute;
            height: 18px;
            width: 18px;
            left: 2px;
            bottom: 2px;
            background: var(--text-muted);
            border-radius: 50%;
            transition: all 0.3s;
        }
        .toggle-switch input:checked + .toggle-slider {
            background: rgba(79, 142, 247, 0.2);
            border-color: var(--accent-blue);
        }
        .toggle-switch input:checked + .toggle-slider::before {
            transform: translateX(20px);
            background: var(--accent-blue);
        }

        /* ── Radio Group ───────────────────────── */
        .radio-group {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }
        .radio-option {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 16px;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: all 0.2s;
            font-size: 13px;
        }
        .radio-option:hover { border-color: var(--accent-blue); }
        .radio-option input[type="radio"] { accent-color: var(--accent-blue); }

        /* ── Wallet Card ───────────────────────── */
        .wallet-card {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px;
            background: rgba(16, 185, 129, 0.05);
            border: 1px solid rgba(16, 185, 129, 0.15);
            border-radius: var(--radius-md);
            margin-bottom: 16px;
        }
        .wallet-info .wallet-balance {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 24px;
            font-weight: 700;
            color: var(--accent-green);
        }
        .wallet-info .wallet-hint {
            font-size: 12px;
            color: var(--text-muted);
            margin-top: 2px;
        }

        /* ── Modal ─────────────────────────────── */
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
        .modal {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-2xl);
            padding: 28px;
            max-width: 480px;
            width: 90%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            position: relative;
        }
        .modal h3 { font-size: 18px; margin-bottom: 6px; font-family: 'Space Grotesk', sans-serif; }
        .modal .modal-subtitle { font-size: 12px; color: var(--text-muted); margin-bottom: 16px; }
        .modal .close-btn {
            position: absolute;
            top: 12px; right: 12px;
            background: none; border: none;
            color: var(--text-muted); font-size: 16px; cursor: pointer;
        }
        .modal .option-group {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 14px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .modal .option-group:hover { border-color: var(--accent-blue); }
        .modal .option-group.selected { border-color: var(--accent-blue); background: rgba(79, 142, 247, 0.05); }
        .modal .option-group .option-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .modal .option-group .option-amount { font-weight: 700; font-size: 15px; }
        .modal .option-group .option-bonus { font-size: 12px; color: var(--accent-green); font-weight: 600; }
        .wallet-deposit-modal {
            width: min(420px, calc(100vw - 32px));
            max-height: none;
            overflow: visible;
            display: flex;
            flex-direction: column;
        }
        .wallet-deposit-modal.is-deposit-transfer {
            width: min(640px, calc(100vw - 32px));
            padding: 22px 24px 20px;
        }
        .wallet-deposit-modal.is-deposit-transfer .wallet-deposit-modal-transfer-title {
            margin-bottom: 12px;
        }
        .wallet-deposit-modal .modal-subtitle {
            margin-bottom: 12px;
        }
        .wallet-deposit-modal .wallet-deposit-form,
        .wallet-deposit-modal .wallet-deposit-pending {
            overflow: visible;
            max-height: none;
        }
        .wallet-topup-hints {
            margin: 12px 0 16px;
        }
        .wallet-topup-hints p {
            font-size: 12px;
            color: var(--text-muted);
            line-height: 1.5;
            margin: 0 0 6px;
        }
        .wallet-topup-hints p:last-child {
            margin-bottom: 0;
        }
        .modal .option-group .option-total { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
        .modal .info-row {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 8px 0;
            font-size: 11px;
            color: var(--text-muted);
        }
        .modal .info-row .info-icon { flex-shrink: 0; margin-top: 1px; }
        .modal .warning {
            background: rgba(245, 158, 11, 0.08);
            border: 1px solid rgba(245, 158, 11, 0.2);
            border-radius: var(--radius-sm);
            padding: 8px;
            font-size: 11px;
            color: var(--accent-orange);
            margin-top: 10px;
        }
        .btn-group { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }

        /* ── Settings page layout ───────────────── */
        .settings-main { max-width: 960px; }
        .settings-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }
        .settings-card { margin-bottom: 0; }
        .settings-card-warn {
            background: rgba(239, 68, 68, 0.04);
            border-color: rgba(239, 68, 68, 0.2);
        }
        .settings-loading {
            padding: 24px;
            color: var(--text-muted);
            text-align: center;
        }
        .settings-phone-row {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        .settings-phone-row .form-input { flex: 1; }
        .settings-events-label {
            font-size: 11px;
            color: var(--text-muted);
            margin: 8px 0 4px;
        }
        .settings-action-stack {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }
        .settings-danger-text {
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 8px;
            line-height: 1.5;
        }
        .settings-danger-alert {
            font-size: 12px;
            color: var(--accent-red);
            font-weight: 600;
            margin-bottom: 12px;
        }
        .settings-link {
            font-size: 12px;
            color: var(--accent-blue);
            text-decoration: none;
        }
        .settings-link:hover { text-decoration: underline; }
        .settings-back-link {
            display: inline-block;
            font-size: 13px;
            color: var(--accent-blue);
            text-decoration: none;
            margin-bottom: 12px;
        }
        .wallet-history { margin-top: 12px; }
        .wallet-history-head {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 12px;
            font-weight: 600;
            color: var(--text-muted);
            margin-bottom: 8px;
        }
        .wallet-history-list {
            list-style: none;
            margin: 0;
            padding: 0;
        }
        .wallet-history-list li {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 4px 12px;
            padding: 8px 0;
            border-bottom: 1px solid var(--border);
            font-size: 12px;
        }
        .wallet-history-list li:last-child { border-bottom: none; }
        .wallet-history-full li {
            grid-template-columns: 1fr auto;
            padding: 12px 0;
        }
        .text-green { color: var(--accent-green); }
        .text-muted { color: var(--text-muted); }
        .settings-toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 300;
            background: rgba(16, 185, 129, 0.12);
            border: 1px solid rgba(16, 185, 129, 0.35);
            color: var(--accent-green);
            padding: 12px 18px;
            border-radius: 10px;
            font-size: 13px;
            font-weight: 600;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        }
        .settings-auto-renew-threshold {
            font-size: 13px;
            color: var(--text-secondary);
            margin: 8px 0 12px;
        }
        .settings-auto-renew-threshold select {
            margin: 0 4px;
            padding: 4px 8px;
            border-radius: 6px;
            border: 1px solid var(--border);
            background: var(--bg-secondary);
            color: var(--text-primary);
            font-size: 13px;
        }
        .auto-renew-bonus-line {
            font-size: 13px;
            color: var(--text-secondary);
            margin: 10px 0 0;
            line-height: 1.5;
        }
        .auto-renew-bonus-line.hint {
            color: var(--text-muted);
            font-size: 12px;
        }
        .settings-auto-renew-status {
            font-size: 12px;
            color: var(--text-muted);
            margin-bottom: 8px;
        }
        .settings-badge {
            margin-left: auto;
            padding: 3px 10px;
            border-radius: 20px;
            font-size: 10px;
            font-weight: 700;
            text-transform: none;
            letter-spacing: 0;
        }
        .settings-badge-ready {
            background: rgba(16, 185, 129, 0.12);
            color: var(--accent-green);
            border: 1px solid rgba(16, 185, 129, 0.3);
        }
        .settings-badge-warn {
            background: rgba(245, 158, 11, 0.12);
            color: var(--accent-orange);
            border: 1px solid rgba(245, 158, 11, 0.3);
        }

        /* ── Auto renew (Combo) ─────────────────── */
        .auto-renew-card .card-header {
            text-transform: none;
            font-size: 14px;
            letter-spacing: 0;
            color: var(--text-primary);
        }
        .auto-renew-options {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .auto-renew-radio {
            display: flex;
            align-items: flex-start;
            gap: 14px;
            padding: 14px 16px;
            background: var(--bg-secondary);
            border: 1.5px solid var(--border);
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: border-color 0.2s, background 0.2s;
        }
        .auto-renew-radio:hover {
            border-color: rgba(79, 142, 247, 0.4);
        }
        .auto-renew-radio.is-selected {
            border-color: var(--accent-blue);
            background: rgba(79, 142, 247, 0.06);
        }
        .auto-renew-radio input[type="radio"] {
            width: 20px;
            height: 20px;
            margin-top: 2px;
            flex-shrink: 0;
            accent-color: var(--accent-blue);
            cursor: pointer;
        }
        .auto-renew-radio-body {
            flex: 1;
            min-width: 0;
        }
        .auto-renew-radio-title {
            font-size: 13.5px;
            font-weight: 500;
            color: var(--text-primary);
            line-height: 1.5;
        }
        .auto-renew-wallet-inline {
            font-weight: 700;
            white-space: nowrap;
        }
        .auto-renew-wallet-inline.ok {
            color: var(--accent-green);
        }
        .auto-renew-wallet-inline.low {
            color: var(--accent-red);
        }
        .auto-renew-transfer-hint {
            margin: 8px 0 0;
            font-size: 12.5px;
            color: var(--text-secondary);
            line-height: 1.5;
        }
        .auto-renew-divider {
            border-top: 1px solid var(--border);
            margin: 16px 0 14px;
        }
        .auto-renew-note {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 12px 14px;
            font-size: 12px;
            color: var(--text-muted);
            line-height: 1.65;
        }
        .auto-renew-note strong {
            color: var(--text-secondary);
            font-weight: 600;
        }
        .auto-renew-note ul {
            margin: 8px 0 0;
            padding-left: 18px;
        }
        .auto-renew-note li + li {
            margin-top: 4px;
        }

        .form-input:read-only {
            opacity: 0.75;
            cursor: not-allowed;
        }
        .form-select {
            width: 100%;
            padding: 10px 14px;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            color: var(--text-primary);
            font-size: 13px;
            font-family: 'Inter', sans-serif;
        }
        .form-select:focus {
            outline: none;
            border-color: var(--accent-blue);
        }
        @media (max-width: 768px) {
            .settings-grid { grid-template-columns: 1fr; }
            .settings-phone-row { flex-direction: column; align-items: stretch; }
        }

        /* Light theme (localStorage) */
        html[data-theme="light"] body {
            --bg-primary: #F5F5F8;
            --bg-secondary: #FFFFFF;
            --bg-card: #FFFFFF;
            --bg-card-hover: #F0F0F5;
            --bg-sidebar: #FFFFFF;
            --border: #E5E5EB;
            --text-primary: #1A1A2E;
            --text-secondary: #5A5A6E;
            --text-muted: #8A8A9A;
        }`;

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

        html {
            overflow-x: hidden;
            max-width: 100%;
        }

        body {
            font-family: 'Inter', sans-serif;
            background-color: var(--bg-primary);
            color: var(--text-primary);
            display: flex;
            min-height: 100vh;
            overflow-x: hidden;
            max-width: 100%;
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
        .header-greeting-short { display: none; }
        .header-right {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        /* ── Notification bell (header) ─────────── */
        .notification-bell-wrap {
            position: relative;
        }
        .notification-bell-trigger {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 38px;
            height: 38px;
            border-radius: var(--radius-md);
            border: 1px solid var(--border);
            background: var(--bg-card);
            cursor: pointer;
            transition: border-color 0.15s, background 0.15s;
        }
        .notification-bell-trigger:hover,
        .notification-bell-trigger.open {
            border-color: var(--accent-blue);
            background: rgba(79, 142, 247, 0.08);
        }
        .notification-bell-icon {
            font-size: 18px;
            line-height: 1;
        }
        .notification-bell-badge {
            position: absolute;
            top: -4px;
            right: -4px;
            min-width: 18px;
            height: 18px;
            padding: 0 5px;
            border-radius: 999px;
            background: #EF4444;
            color: #fff;
            font-size: 10px;
            font-weight: 700;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 0 2px var(--bg-primary);
        }
        .notification-dropdown-panel {
            position: absolute;
            top: calc(100% + 8px);
            right: 0;
            width: min(360px, calc(100vw - 24px));
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 12px;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
            z-index: 120;
            overflow: hidden;
            animation: notification-dropdown-in 0.2s ease;
        }
        @keyframes notification-dropdown-in {
            from { opacity: 0; transform: translateY(-6px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .notification-dropdown-head {
            padding: 14px 16px 10px;
            border-bottom: 1px solid var(--border);
        }
        .notification-dropdown-head-title {
            font-size: 14px;
            font-weight: 700;
        }
        .notification-dropdown-body {
            max-height: 360px;
            overflow-y: auto;
        }
        .notification-dropdown-section {
            padding: 10px 12px;
        }
        .notification-dropdown-section-title {
            font-size: 12px;
            font-weight: 700;
            margin-bottom: 8px;
            color: var(--text-primary);
        }
        .notification-dropdown-section-title.muted {
            color: var(--text-muted);
            font-weight: 600;
        }
        .notification-dropdown-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .notification-dropdown-item {
            display: block;
            width: 100%;
            text-align: left;
            padding: 12px 14px;
            border-radius: 10px;
            border: 1px solid var(--border);
            background: var(--bg-secondary);
            color: var(--text-primary);
            cursor: pointer;
            text-decoration: none;
            transition: border-color 0.15s, background 0.15s;
        }
        .notification-dropdown-item:hover {
            border-color: rgba(79, 142, 247, 0.45);
        }
        .notification-dropdown-item.read {
            opacity: 0.72;
        }
        .notification-dropdown-item-title {
            font-size: 13px;
            font-weight: 600;
            line-height: 1.45;
            margin-bottom: 4px;
        }
        .notification-dropdown-item-message {
            font-size: 12px;
            color: var(--text-secondary);
            line-height: 1.45;
            margin-bottom: 6px;
        }
        .notification-message-multiline {
            white-space: pre-line;
        }
        .notification-dropdown-item.support-notification {
            cursor: default;
        }
        .notification-dropdown-item.support-notification:hover {
            border-color: var(--border);
        }
        .notification-support-actions {
            display: flex;
            gap: 8px;
            margin-top: 10px;
        }
        .notification-support-actions .btn {
            flex: 1;
            justify-content: center;
        }
        .notification-dropdown-item-time {
            font-size: 11px;
            color: var(--text-muted);
        }
        .notification-dropdown-footer {
            padding: 10px 12px 12px;
            border-top: 1px solid var(--border);
        }
        .notification-dropdown-mark-all {
            width: 100%;
            padding: 8px 12px;
            border-radius: 8px;
            border: 1px solid var(--border);
            background: transparent;
            color: var(--accent-blue);
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
        }
        .notification-dropdown-mark-all:hover:not(:disabled) {
            background: rgba(79, 142, 247, 0.08);
        }
        .notification-dropdown-mark-all:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .notification-dropdown-empty {
            padding: 28px 16px;
            text-align: center;
            color: var(--text-muted);
            font-size: 13px;
        }

        /* ── Wallet dropdown (header) ──────────── */
        .wallet-dropdown-wrap {
            position: relative;
        }
        .wallet-dropdown-trigger {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            border-radius: var(--radius-md);
            border: 1px solid var(--border);
            background: var(--bg-card);
            font-family: inherit;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: border-color 0.2s, background 0.2s;
        }
        .wallet-dropdown-trigger:hover {
            border-color: rgba(79, 142, 247, 0.45);
            background: var(--bg-card-hover);
        }
        .wallet-dropdown-trigger.tone-high .wallet-dropdown-trigger-amount {
            color: var(--accent-green);
        }
        .wallet-dropdown-trigger.tone-low .wallet-dropdown-trigger-amount {
            color: var(--accent-orange);
        }
        .wallet-dropdown-trigger.tone-zero .wallet-dropdown-trigger-amount {
            color: var(--accent-red);
        }
        .wallet-dropdown-trigger-chevron {
            font-size: 10px;
            color: var(--text-muted);
        }
        .wallet-modal-overlay {
            display: flex;
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.72);
            z-index: 250;
            align-items: center;
            justify-content: center;
            padding: 16px;
            animation: wallet-modal-fade-in 0.2s ease;
        }
        @keyframes wallet-modal-fade-in {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        .wallet-dropdown-modal {
            position: relative;
            width: min(420px, 100%);
            max-height: min(90dvh, 720px);
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-2xl);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            animation: wallet-modal-slide-in 0.22s ease;
        }
        @keyframes wallet-modal-slide-in {
            from { opacity: 0; transform: translateY(12px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .wallet-dropdown-modal > .close-btn {
            position: absolute;
            top: 12px;
            right: 12px;
            z-index: 2;
            background: none;
            border: none;
            color: var(--text-muted);
            font-size: 16px;
            cursor: pointer;
            line-height: 1;
            padding: 4px;
        }
        .wallet-dropdown-modal > .close-btn:hover {
            color: var(--text-primary);
        }
        .wallet-dropdown-modal .wallet-dropdown-head {
            flex-shrink: 0;
            padding: 18px 44px 10px 20px;
        }
        .wallet-dropdown-modal .wallet-dropdown-tabs {
            flex-shrink: 0;
        }
        .wallet-dropdown-modal .wallet-dropdown-body {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            padding: 12px 16px 16px;
            scrollbar-width: thin;
        }
        .wallet-dropdown-modal .wallet-dropdown-body::-webkit-scrollbar {
            width: 6px;
        }
        .wallet-dropdown-modal .wallet-dropdown-body::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.12);
            border-radius: 999px;
        }
        .wallet-dropdown-modal .wallet-dropdown-tab-panel {
            max-height: none;
            overflow: visible;
        }
        .wallet-dropdown-modal.is-deposit-amount {
            max-height: none;
        }
        .wallet-dropdown-modal.is-deposit-amount .wallet-dropdown-body {
            overflow-y: visible;
        }
        .wallet-dropdown-modal.is-deposit-transfer {
            width: min(640px, calc(100vw - 32px));
            max-height: none;
        }
        .wallet-dropdown-modal.is-deposit-transfer .wallet-dropdown-head {
            padding: 14px 44px 8px 18px;
        }
        .wallet-dropdown-modal.is-deposit-transfer .wallet-dropdown-balance {
            font-size: 17px;
        }
        .wallet-dropdown-modal.is-deposit-transfer .wallet-dropdown-tabs {
            padding: 6px 8px;
        }
        .wallet-dropdown-modal.is-deposit-transfer .wallet-dropdown-body {
            overflow-y: visible;
            padding: 10px 16px 14px;
        }
        .wallet-dropdown-head {
            padding: 14px 16px 10px;
            border-bottom: 1px solid var(--border);
        }
        .wallet-dropdown-head-title {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-primary);
            margin-bottom: 4px;
        }
        .wallet-dropdown-balance {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 20px;
            font-weight: 700;
        }
        .wallet-dropdown-balance.tone-high { color: var(--accent-green); }
        .wallet-dropdown-balance.tone-low { color: var(--accent-orange); }
        .wallet-dropdown-balance.tone-zero { color: var(--accent-red); }
        .wallet-dropdown-tabs {
            display: flex;
            gap: 4px;
            padding: 8px 10px;
            border-bottom: 1px solid var(--border);
            background: var(--bg-secondary);
        }
        .wallet-dropdown-tab {
            flex: 1;
            padding: 8px 6px;
            border: none;
            border-radius: var(--radius-sm);
            background: transparent;
            color: var(--text-muted);
            font-family: inherit;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s, color 0.2s;
            white-space: nowrap;
        }
        .wallet-dropdown-tab:hover {
            color: var(--text-secondary);
            background: rgba(255, 255, 255, 0.03);
        }
        .wallet-dropdown-tab.active {
            background: var(--bg-card);
            color: var(--accent-blue);
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
        }
        .wallet-dropdown-body {
            padding: 14px 16px 16px;
            max-height: none;
            overflow: visible;
        }
        .wallet-dropdown-tab-panel {
            max-height: min(80vh, 720px);
            overflow-y: auto;
            overflow-x: hidden;
            scrollbar-width: thin;
        }
        .wallet-dropdown-tab-panel::-webkit-scrollbar {
            width: 6px;
        }
        .wallet-dropdown-tab-panel::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.12);
            border-radius: 999px;
        }
        .wallet-dropdown-hint {
            font-size: 12px;
            color: var(--text-muted);
            margin-bottom: 10px;
        }
        .wallet-topup-options {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 12px;
        }
        .wallet-topup-option {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 12px;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            background: var(--bg-secondary);
            color: var(--text-primary);
            font-family: inherit;
            font-size: 13px;
            cursor: pointer;
            text-align: left;
            transition: border-color 0.2s, background 0.2s;
        }
        .wallet-topup-option:hover {
            border-color: rgba(79, 142, 247, 0.4);
        }
        .wallet-topup-option.selected {
            border-color: var(--accent-blue);
            background: rgba(79, 142, 247, 0.08);
        }
        .wallet-topup-option-bonus {
            color: var(--accent-green);
            font-weight: 600;
            font-size: 12px;
        }
        .wallet-topup-summary {
            padding: 10px 12px;
            background: rgba(16, 185, 129, 0.06);
            border: 1px solid rgba(16, 185, 129, 0.15);
            border-radius: var(--radius-md);
            margin-bottom: 12px;
        }
        .wallet-topup-summary strong {
            display: block;
            font-size: 18px;
            color: var(--accent-green);
            margin-top: 2px;
        }
        .wallet-topup-summary-bonus {
            font-size: 11px;
            color: var(--text-muted);
            margin-top: 4px;
        }
        .wallet-topup-submit {
            width: 100%;
            justify-content: center;
        }
        .wallet-topup-hints {
            margin: 12px 0;
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
        .wallet-deposit-form {
            display: flex;
            flex-direction: column;
            gap: 0;
        }
        .wallet-deposit-form--compact .wallet-deposit-input {
            font-size: 16px;
            padding: 10px 12px;
            margin-bottom: 6px;
        }
        .wallet-deposit-form--compact .wallet-deposit-quick {
            margin-bottom: 8px;
            gap: 6px;
        }
        .wallet-deposit-form--compact .wallet-deposit-quick-btn {
            padding: 7px 4px;
            font-size: 11px;
        }
        .wallet-deposit-form--compact .wallet-deposit-submit {
            margin-top: 2px;
        }
        .wallet-deposit-label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            color: var(--text-secondary);
            margin-bottom: 6px;
        }
        .wallet-deposit-input {
            width: 100%;
            padding: 12px 14px;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            background: var(--bg-secondary);
            color: var(--text-primary);
            font-family: 'Space Grotesk', sans-serif;
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 8px;
        }
        .wallet-deposit-input:focus {
            outline: none;
            border-color: var(--accent-blue);
        }
        .wallet-deposit-input.has-error {
            border-color: var(--accent-red);
        }
        .wallet-deposit-error {
            font-size: 12px;
            color: var(--accent-red);
            margin: 0 0 10px;
        }
        .wallet-deposit-quick {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 8px;
            margin-bottom: 12px;
        }
        .wallet-deposit-quick-btn {
            padding: 8px 6px;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            background: var(--bg-secondary);
            color: var(--text-primary);
            font-family: inherit;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            transition: border-color 0.2s, background 0.2s;
        }
        .wallet-deposit-quick-btn:hover {
            border-color: rgba(79, 142, 247, 0.4);
        }
        .wallet-deposit-quick-btn.selected {
            border-color: var(--accent-blue);
            background: rgba(79, 142, 247, 0.1);
            color: var(--accent-blue);
        }
        .wallet-deposit-checks {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin: 12px 0 14px;
        }
        .wallet-deposit-check {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            font-size: 12px;
            color: var(--text-secondary);
            line-height: 1.5;
            cursor: pointer;
        }
        .wallet-deposit-check input {
            margin-top: 3px;
            flex-shrink: 0;
        }
        .wallet-deposit-check a {
            color: var(--accent-blue);
            text-decoration: underline;
        }
        .wallet-deposit-submit {
            width: 100%;
            justify-content: center;
        }
        .wallet-tx-pending {
            color: var(--accent-orange);
            font-weight: 600;
        }
        .amount-pending {
            color: var(--accent-orange);
            font-weight: 700;
            white-space: nowrap;
        }
        .wallet-deposit-pending {
            text-align: left;
        }
        .wallet-deposit-pending-head {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
        }
        .wallet-deposit-pending-icon {
            font-size: 26px;
            line-height: 1;
            flex-shrink: 0;
        }
        .wallet-deposit-pending-head-text {
            min-width: 0;
        }
        .wallet-deposit-pending-title {
            font-size: 15px;
            font-weight: 700;
            margin: 0;
        }
        .wallet-deposit-pending-subtitle {
            font-size: 11px;
            color: var(--text-muted);
            line-height: 1.4;
            margin: 2px 0 0;
        }
        .wallet-deposit-pending-main {
            display: grid;
            grid-template-columns: 108px minmax(0, 1fr);
            gap: 10px;
            margin-bottom: 10px;
        }
        .wallet-deposit-pending-qr {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 4px;
            min-height: 108px;
            padding: 8px;
            background: var(--bg-secondary);
            border: 1px dashed var(--border);
            border-radius: var(--radius-md);
            font-size: 10px;
            color: var(--text-secondary);
            text-align: center;
            line-height: 1.3;
        }
        .wallet-deposit-pending-qr-icon {
            font-size: 22px;
            line-height: 1;
        }
        .wallet-deposit-pending-grid {
            display: grid;
            grid-template-columns: minmax(88px, auto) minmax(0, 1fr);
            gap: 5px 12px;
            margin: 0;
            padding: 10px 12px;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            align-content: start;
        }
        .wallet-deposit-pending-grid dt {
            margin: 0;
            font-size: 11px;
            color: var(--text-muted);
            line-height: 1.35;
        }
        .wallet-deposit-pending-grid dd {
            margin: 0;
            font-size: 12px;
            font-weight: 700;
            color: var(--text-primary);
            text-align: right;
            line-height: 1.35;
            word-break: break-word;
        }
        .wallet-deposit-pending-grid dd.mono {
            font-family: ui-monospace, monospace;
            color: var(--accent-blue);
        }
        .wallet-deposit-pending-note {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 8px 10px;
            margin-bottom: 8px;
            background: rgba(79, 142, 247, 0.08);
            border: 1px solid rgba(79, 142, 247, 0.2);
            border-radius: var(--radius-md);
        }
        .wallet-deposit-pending-note-text {
            min-width: 0;
            flex: 1;
        }
        .wallet-deposit-pending-note-text span {
            display: block;
            font-size: 10px;
            color: var(--text-muted);
            margin-bottom: 2px;
        }
        .wallet-deposit-pending-note-text strong {
            display: block;
            font-size: 13px;
            font-family: ui-monospace, monospace;
            color: var(--accent-blue);
            word-break: break-all;
            line-height: 1.3;
        }
        .wallet-deposit-copy {
            flex-shrink: 0;
            background: none;
            border: none;
            color: var(--accent-blue);
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            padding: 4px 0;
            white-space: nowrap;
        }
        .wallet-deposit-pending-eta {
            font-size: 11px;
            color: var(--accent-orange);
            margin: 0 0 10px;
            line-height: 1.4;
        }
        .wallet-deposit-pending-foot {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .wallet-deposit-pending-check {
            flex: 1;
            min-width: 0;
            margin: 0;
            font-size: 11px;
        }
        .wallet-deposit-close {
            width: auto;
            flex-shrink: 0;
            min-width: 108px;
            justify-content: center;
        }
        @media (max-width: 560px) {
            .wallet-deposit-pending-main {
                grid-template-columns: 1fr;
            }
            .wallet-deposit-pending-qr {
                min-height: 64px;
                flex-direction: row;
                justify-content: center;
            }
            .wallet-deposit-pending-foot {
                flex-direction: column;
                align-items: stretch;
            }
            .wallet-deposit-close {
                width: 100%;
            }
        }
        .wallet-use-grid {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .wallet-use-card {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            background: var(--bg-secondary);
            text-decoration: none;
            color: inherit;
            transition: border-color 0.2s, background 0.2s;
        }
        .wallet-use-card:hover {
            border-color: rgba(79, 142, 247, 0.4);
            background: var(--bg-card-hover);
        }
        .wallet-use-card-icon {
            font-size: 20px;
            flex-shrink: 0;
        }
        .wallet-use-card-title {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-primary);
        }
        .wallet-use-card-desc {
            font-size: 11px;
            color: var(--text-muted);
            margin-top: 2px;
        }
        .wallet-dropdown-history {
            list-style: none;
            margin: 0;
            padding: 0;
        }
        .wallet-dropdown-history-item {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 10px;
            padding: 10px 0;
            border-bottom: 1px solid var(--border);
            font-size: 12px;
        }
        .wallet-dropdown-history-item:last-child {
            border-bottom: none;
        }
        .wallet-dropdown-history-desc {
            font-weight: 500;
            color: var(--text-primary);
        }
        .wallet-dropdown-history-date {
            font-size: 11px;
            color: var(--text-muted);
            margin-top: 2px;
        }
        .amount-plus { color: var(--accent-green); font-weight: 700; white-space: nowrap; }
        .amount-minus { color: var(--accent-red); font-weight: 700; white-space: nowrap; }
        .wallet-dropdown-view-all {
            display: block;
            text-align: center;
            margin-top: 10px;
            font-size: 12px;
            color: var(--accent-blue);
            text-decoration: none;
        }
        .wallet-dropdown-view-all:hover { text-decoration: underline; }
        .wallet-dropdown-empty {
            text-align: center;
            font-size: 12px;
            color: var(--text-muted);
            padding: 16px 0;
        }
        .wallet-dropdown-toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 300;
            background: rgba(16, 185, 129, 0.15);
            border: 1px solid rgba(16, 185, 129, 0.35);
            color: var(--accent-green);
            padding: 10px 16px;
            border-radius: var(--radius-md);
            font-size: 12px;
            max-width: 320px;
        }
        @media (max-width: 768px) {
            .header { left: 0; padding: 0 10px; gap: 8px; }
            .header-left {
                min-width: 0;
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 12px;
            }
            .header-greeting-full { display: none; }
            .header-greeting-short { display: inline; }
            .header-right {
                flex-shrink: 0;
                gap: 6px;
            }
            .wallet-dropdown-trigger {
                padding: 6px 8px;
                font-size: 11px;
                max-width: 108px;
            }
            .wallet-dropdown-trigger-amount {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                max-width: 72px;
                display: inline-block;
                vertical-align: bottom;
            }
            .wallet-dropdown-trigger-chevron { display: none; }
            .wallet-modal-overlay {
                padding: 12px;
            }
            .wallet-dropdown-modal {
                width: 100%;
            }
            .wallet-dropdown-modal.is-deposit-transfer {
                width: calc(100vw - 24px);
            }
            .wallet-deposit-quick {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
            .header-right .btn-accent { display: none; }
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
        .btn-success { background: rgba(16, 185, 129, 0.1); color: var(--accent-green); border: 1px solid rgba(16, 185, 129, 0.3); }
        .btn-success:hover { background: rgba(16, 185, 129, 0.2); }
        .btn-lg { padding: 12px 24px; font-size: 14px; border-radius: var(--radius-md); }
        .btn-sm { padding: 5px 10px; font-size: 10px; border-radius: 6px; }
        .btn-accent {
            background: var(--accent-blue);
            color: white;
            font-weight: 700;
            padding: 10px 18px;
            border-radius: 50px;
            transition: all 0.3s;
        }
        .btn-accent:hover {
            background: #3A7DE8;
            transform: translateY(-1px);
        }

        /* ── Nút Mở ComfyUI (tím thanh lịch) ──── */
        .btn-launch {
            background: transparent;
            color: var(--accent-purple);
            font-weight: 700;
            padding: 14px 28px;
            font-size: 15px;
            border-radius: var(--radius-md);
            border: 2px solid var(--accent-purple);
            cursor: pointer;
            transition: all 0.3s;
            box-shadow: 0 0 15px rgba(139, 92, 246, 0.15);
        }
        .btn-launch:hover {
            background: rgba(139, 92, 246, 0.08);
            box-shadow: 0 0 25px rgba(139, 92, 246, 0.3);
            transform: translateY(-1px);
        }

        /* ── Nhóm nút điều khiển ──────────────── */
        .btn-group-server {
            display: flex;
            gap: 10px;
            margin-top: 0;
            justify-content: center;
            align-items: stretch;
            flex-wrap: wrap;
            width: 100%;
        }
        .btn-group-server .btn,
        .btn-group-server .btn-launch,
        .btn-group-server .btn-power-square {
            height: 48px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }

        .machine-start-panel {
            margin-top: 0;
        }
        .machine-start-text {
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 10px;
        }
        .machine-start-progress {
            height: 6px;
            border-radius: 999px;
            background: var(--bg-secondary);
            overflow: hidden;
            margin-bottom: 12px;
        }
        .machine-start-progress-fill {
            height: 100%;
            width: 40%;
            border-radius: 999px;
            background: linear-gradient(90deg, var(--accent-blue), #60a5fa, var(--accent-blue));
            animation: machine-start-indeterminate 1.4s ease-in-out infinite;
        }
        @keyframes machine-start-indeterminate {
            0% { transform: translateX(-120%); }
            100% { transform: translateX(320%); }
        }
        .machine-toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 300;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 12px 16px;
            font-size: 13px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        }
        .machine-confirm-lines {
            display: grid;
            gap: 8px;
            margin-bottom: 16px;
            font-size: 13px;
            color: var(--text-secondary);
        }
        .machine-confirm-lines strong {
            color: var(--text-primary);
        }
        .machine-confirm-note {
            font-size: 12px;
            color: var(--accent-blue);
            margin-bottom: 16px;
        }
        .machine-confirm-actions {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
        }

        /* ── Env picker (đổi môi trường) ───────── */
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
        .env-modal-close:disabled { opacity: 0.5; cursor: not-allowed; }
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
        .env-picker-card:hover:not(:disabled) {
            border-color: var(--accent-blue);
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(0,0,0,0.25);
        }
        .env-picker-card.selected {
            border-color: var(--accent-green);
            box-shadow: 0 0 0 1px var(--accent-green), 0 8px 24px rgba(16, 185, 129, 0.15);
        }
        .env-picker-card:disabled { opacity: 0.6; cursor: wait; }
        .env-picker-icon { font-size: 36px; line-height: 1; }
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
        .env-picker-card-disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }
        .env-picker-card-disabled:hover {
            transform: none;
            box-shadow: none;
        }
        .env-picker-soon {
            display: inline-block;
            margin-top: 4px;
            font-size: 11px;
            font-weight: 600;
            color: var(--accent-orange);
        }

        /* ── Nút Tắt hình vuông ───────────────── */
        .btn-power-square {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 0 18px;
            height: 48px;
            border-radius: var(--radius-sm);
            background: rgba(239, 68, 68, 0.1);
            color: var(--accent-red);
            border: 1px solid rgba(239, 68, 68, 0.3);
            cursor: pointer;
            font-weight: 600;
            font-size: 13px;
            font-family: 'Space Grotesk', sans-serif;
            transition: all 0.3s;
            flex-shrink: 0;
        }
        .btn-power-square:hover {
            background: rgba(239, 68, 68, 0.2);
            border-color: rgba(239, 68, 68, 0.5);
        }
        .btn-power-square .power-icon { font-size: 16px; }

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
        button.sidebar-item {
            width: 100%;
            border: none;
            cursor: pointer;
            font-family: inherit;
            text-align: left;
        }
        a.sidebar-item, a.sidebar-logo { text-decoration: none; color: inherit; }

        /* ── Main Content ──────────────────────── */
        .main-content {
            flex: 1 1 auto;
            margin-left: 220px;
            margin-top: 56px;
            padding: 24px;
            min-width: 0;
            max-width: 100%;
            box-sizing: border-box;
            overflow-x: hidden;
        }
        .main-content--models,
        .main-content--workflows,
        .main-content--storage {
            padding: 24px clamp(16px, 2.5vw, 32px) 40px;
        }
        @media (max-width: 768px) {
            .main-content { padding: 12px 10px; }
            .main-content--models,
            .main-content--workflows,
            .main-content--storage { padding: 12px 10px 28px; }
        }

        /* ── Alert Cards ───────────────────────── */
        .alert-cards {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 16px;
        }
        .alert-card {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 14px 18px;
            border-radius: var(--radius-md);
            font-size: 13px;
            font-weight: 500;
            border: 1px solid;
        }
        .alert-card.danger {
            background: rgba(239, 68, 68, 0.08);
            border-color: rgba(239, 68, 68, 0.25);
            color: var(--accent-red);
        }
        .alert-card.warning {
            background: rgba(245, 158, 11, 0.08);
            border-color: rgba(245, 158, 11, 0.25);
            color: var(--accent-orange);
        }
        .alert-icon { font-size: 20px; flex-shrink: 0; }
        .alert-content { flex: 1; min-width: 0; word-break: break-word; }
        .alert-title { font-weight: 600; margin-bottom: 2px; }
        .alert-desc { font-size: 11px; opacity: 0.8; }
        .alert-close {
            background: none; border: none; color: inherit;
            opacity: 0.5; cursor: pointer; font-size: 16px;
            padding: 4px; transition: opacity 0.2s;
        }
        .alert-close:hover { opacity: 1; }

        /* ── Card Grid ─────────────────────────── */
        .card-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
            min-width: 0;
        }
        .card-grid > * {
            min-width: 0;
        }
        @media (max-width: 1200px) { .card-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 768px) { .card-grid { grid-template-columns: 1fr; } }

        .dashboard-two-col {
            grid-column: 1 / -1;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
        }
        @media (max-width: 768px) {
            .dashboard-two-col { grid-template-columns: 1fr; }
        }

        .dashboard-env-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 4px;
            word-break: break-word;
            line-height: 1.4;
        }
        .dashboard-env-desc {
            font-size: 13px;
            color: var(--text-muted);
            margin-bottom: 16px;
            word-break: break-word;
            line-height: 1.5;
        }
        .dashboard-workspace-section {
            margin-bottom: 0;
        }
        .dashboard-workspace-meta-slot {
            min-height: 36px;
            margin-top: 8px;
        }
        .dashboard-server-progress-slot:not(:empty) {
            min-height: 22px;
            margin-top: 12px;
        }
        .dashboard-server-badges-slot:not(:empty) {
            margin-top: 8px;
        }
        .dashboard-server-badges {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        .dashboard-server-actions-slot {
            min-height: 48px;
            margin-top: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .dashboard-workspace-label {
            font-size: 12px;
            font-weight: 600;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: var(--text-muted);
            margin-bottom: 8px;
        }
        .dashboard-workspace-select-wrap {
            display: flex;
            justify-content: center;
            width: 100%;
        }
        .dashboard-workspace-select {
            width: min(100%, 400px);
            padding: 9px 44px 9px 14px;
            font-size: 14px;
            font-weight: 500;
            color: var(--text-primary);
            background-color: var(--bg-secondary);
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%234F8EF7' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 14px center;
            background-size: 16px 16px;
            border: 1.5px solid rgba(79, 142, 247, 0.35);
            border-radius: var(--radius-sm);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
            cursor: pointer;
            appearance: none;
            -webkit-appearance: none;
            transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
        }
        .dashboard-workspace-select:hover:not(:disabled) {
            border-color: rgba(79, 142, 247, 0.65);
            background-color: var(--bg-card-hover);
        }
        .dashboard-workspace-select:focus {
            outline: none;
            border-color: var(--accent-blue);
            box-shadow: 0 0 0 3px rgba(79, 142, 247, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }
        .dashboard-workspace-select:disabled {
            opacity: 0.6;
            cursor: wait;
        }
        .dashboard-workspace-hint {
            font-size: 13px;
            color: var(--text-muted);
            margin-top: 0;
            margin-bottom: 0;
            line-height: 1.5;
            text-align: center;
        }
        .dashboard-workspace-status {
            font-size: 13px;
            color: var(--text-muted);
            margin-top: 0;
            margin-bottom: 0;
            line-height: 1.5;
        }
        .dashboard-workspace-locked {
            font-size: 16px;
            font-weight: 600;
            word-break: break-word;
            line-height: 1.4;
        }
        .dashboard-plan-line {
            font-size: 16px;
            font-weight: 600;
            word-break: break-word;
            line-height: 1.4;
        }

        .dashboard-top-row {
            grid-column: 1 / -1;
            display: grid;
            grid-template-columns: 2fr 1fr;
            grid-template-rows: auto auto;
            gap: 16px;
            align-items: stretch;
            min-width: 0;
        }
        .dashboard-server-column {
            grid-column: 1;
            grid-row: span 2;
            display: grid;
            grid-template-rows: subgrid;
            gap: 16px;
            min-width: 0;
            align-self: stretch;
        }
        .dashboard-top-row .card {
            min-width: 0;
        }
        .dashboard-server-card {
            height: 100%;
            min-height: 0;
            display: flex;
            flex-direction: column;
        }
        .dashboard-top-row .dashboard-plan-card {
            height: 100%;
            min-height: 0;
            display: flex;
            flex-direction: column;
        }
        .dashboard-plan-card-content {
            flex: 1 1 auto;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            gap: 14px;
            min-height: 0;
        }
        .dashboard-sidebar-column {
            grid-column: 2;
            grid-row: span 2;
            display: grid;
            grid-template-rows: subgrid;
            gap: 16px;
            min-width: 0;
            align-self: stretch;
        }
        .dashboard-sidebar-column > .card {
            min-height: 0;
            height: 100%;
            display: flex;
            flex-direction: column;
        }
        .dashboard-storage-summary-card .dashboard-storage-summary-body {
            flex: 1 1 auto;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
        }
        .dashboard-metrics-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            min-width: 0;
            align-items: stretch;
            height: 100%;
            min-height: 0;
        }
        .dashboard-metrics-row > .card {
            min-width: 0;
            height: 100%;
            display: flex;
            flex-direction: column;
        }
        .dashboard-metrics-row--single {
            grid-template-columns: 1fr;
        }
        .dashboard-session-card {
            min-width: 0;
            display: flex;
            flex-direction: column;
        }
        .dashboard-session-body {
            min-height: 84px;
            flex: 1 1 auto;
        }
        .dashboard-perf-body {
            min-height: 84px;
            flex: 1 1 auto;
        }
        .dashboard-plan-card--compact {
            padding-bottom: 14px;
        }
        .dashboard-plan-card--compact .dashboard-plan-card-header {
            margin-bottom: 12px;
        }
        .dashboard-plan-card-content--empty {
            align-items: center;
            justify-content: center;
            text-align: center;
        }
        .dashboard-plan-loading,
        .dashboard-plan-empty-text {
            font-size: 13px;
            color: var(--text-muted);
            margin: 0;
        }
        .dashboard-plan-empty-text {
            color: var(--text-secondary);
            margin-bottom: 12px;
        }
        .dashboard-plan-identity {
            display: flex;
            flex-direction: column;
            gap: 6px;
            min-width: 0;
        }
        .dashboard-plan-name {
            font-size: 16px;
            font-weight: 700;
            line-height: 1.35;
            word-break: break-word;
        }
        .dashboard-plan-spec {
            font-size: 13px;
            color: var(--text-secondary);
            line-height: 1.45;
            word-break: break-word;
        }
        .dashboard-plan-type-badge {
            align-self: flex-start;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 9px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 600;
            line-height: 1.3;
            color: var(--accent-green);
            background: rgba(34, 197, 94, 0.12);
            border: 1px solid rgba(34, 197, 94, 0.25);
            white-space: nowrap;
        }
        .dashboard-plan-hours-block {
            flex: 1 1 auto;
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 8px;
            min-height: 0;
            padding: 2px 0;
        }
        .dashboard-plan-hours-main {
            display: flex;
            align-items: baseline;
            justify-content: center;
            flex-wrap: wrap;
            gap: 4px 6px;
            font-family: 'Space Grotesk', sans-serif;
            font-variant-numeric: tabular-nums;
            line-height: 1.1;
        }
        .dashboard-plan-hours-value {
            font-size: clamp(22px, 4vw, 28px);
            font-weight: 700;
            color: var(--accent-blue);
        }
        .dashboard-plan-hours-sep {
            font-size: 16px;
            font-weight: 500;
            color: var(--text-muted);
        }
        .dashboard-plan-hours-total {
            font-size: clamp(16px, 3vw, 20px);
            font-weight: 600;
            color: var(--text-secondary);
        }
        .dashboard-plan-hours-caption {
            text-align: center;
            font-size: 11px;
            color: var(--text-muted);
            line-height: 1.4;
        }
        .dashboard-plan-compact-progress {
            margin-top: 2px;
            margin-bottom: 0;
        }
        .dashboard-plan-compact-expiry {
            font-size: 11px;
            color: var(--text-muted);
            line-height: 1.45;
            text-align: center;
            word-break: break-word;
        }
        .dashboard-session-timer {
            font-size: 28px;
            font-weight: 700;
            color: var(--accent-blue);
            line-height: 1.1;
            font-variant-numeric: tabular-nums;
        }
        .dashboard-session-timer-label {
            font-size: 12px;
            color: var(--text-muted);
            margin-top: 4px;
            margin-bottom: 12px;
        }
        .dashboard-session-stats {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .dashboard-session-stat {
            font-size: 13px;
            color: var(--text-secondary);
            line-height: 1.5;
        }
        .dashboard-session-muted {
            font-size: 13px;
            color: var(--text-muted);
            line-height: 1.5;
            margin: 0;
        }
        @media (max-width: 992px) {
            .dashboard-top-row {
                grid-template-columns: 1fr;
                grid-template-rows: none;
            }
            .dashboard-server-column,
            .dashboard-sidebar-column {
                grid-column: 1;
                grid-row: auto;
                display: flex;
                flex-direction: column;
                grid-template-rows: none;
            }
            .dashboard-server-card,
            .dashboard-top-row .dashboard-plan-card,
            .dashboard-sidebar-column > .card,
            .dashboard-metrics-row {
                height: auto;
            }
            .dashboard-metrics-row { grid-template-columns: 1fr; }
        }

        .support-active-banner {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
            margin-bottom: 20px;
            padding: 12px 16px;
            border-radius: var(--radius-md);
            border: 1px solid rgba(239, 68, 68, 0.35);
            background: rgba(239, 68, 68, 0.12);
        }
        .support-active-banner-text {
            font-size: 13px;
            font-weight: 600;
            color: var(--accent-red);
        }
        .support-active-banner-timer {
            font-weight: 500;
            color: var(--text-secondary);
        }

        .dashboard-stat-empty {
            font-size: 13px;
            color: var(--text-muted);
            line-height: 1.5;
        }
        .dashboard-stat-summary {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 12px;
        }
        .dashboard-stat-pill {
            display: inline-flex;
            align-items: center;
            padding: 4px 10px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 600;
            background: rgba(79, 142, 247, 0.12);
            color: var(--accent-blue);
        }
        .dashboard-stat-pill.muted {
            background: var(--bg-secondary);
            color: var(--text-muted);
            font-weight: 500;
        }
        .dashboard-stat-list {
            display: grid;
            gap: 0;
        }
        .dashboard-stat-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            padding: 9px 0;
            border-bottom: 1px solid var(--border);
            font-size: 12px;
        }
        .dashboard-stat-row:last-child { border-bottom: none; }
        .dashboard-stat-name {
            color: var(--text-primary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            min-width: 0;
            flex: 1;
        }
        .dashboard-stat-meta {
            color: var(--text-muted);
            font-size: 11px;
            white-space: nowrap;
            flex-shrink: 0;
        }
        .dashboard-stat-meta.highlight {
            color: var(--accent-blue);
            font-weight: 600;
        }

        /* ── Card ──────────────────────────────── */
        .card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: 20px;
            transition: all 0.3s;
            min-width: 0;
        }
        .card:hover { border-color: rgba(79, 142, 247, 0.3); }
        .card.wide { grid-column: span 2; }
        @media (max-width: 1200px) { .card.wide { grid-column: span 2; } }
        @media (max-width: 768px) { .card.wide { grid-column: span 1; } }

        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
            margin-bottom: 14px;
        }
        .card-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-muted);
        }
        .card-actions { display: flex; gap: 6px; }

        /* ── Status Badge ──────────────────────── */
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            border-radius: 14px;
            font-size: 11px;
            font-weight: 600;
        }
        .status-badge.online { background: rgba(16, 185, 129, 0.1); color: var(--accent-green); }
        .status-badge.offline { background: rgba(239, 68, 68, 0.1); color: var(--accent-red); }
        .status-badge.starting { background: rgba(245, 158, 11, 0.1); color: var(--accent-orange); }
        .status-dot { width: 6px; height: 6px; border-radius: 50%; animation: pulse 2s infinite; }
        .online .status-dot {
            background: var(--accent-green);
            animation: pulse-slow 3.5s ease-in-out infinite;
        }
        .offline .status-dot { background: var(--accent-red); }
        .starting .status-dot { background: var(--accent-orange); }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes pulse-slow { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }

        /* ── Timer Display ─────────────────────── */
        .timer-display {
            font-family: 'Space Grotesk', monospace;
            font-size: 42px;
            font-weight: 700;
            letter-spacing: 2px;
            color: var(--accent-green);
            text-align: center;
            padding: 8px 0;
        }
        .timer-label { text-align: center; font-size: 11px; color: var(--text-muted); margin-top: 4px; }

        /* ── Metric ────────────────────────────── */
        .metric-value { font-family: 'Space Grotesk', sans-serif; font-size: 28px; font-weight: 700; }
        .metric-label { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

        /* ── Progress Bar ──────────────────────── */
        .progress-bar { height: 6px; background: var(--bg-secondary); border-radius: 3px; overflow: hidden; margin-top: 6px; }
        .progress-fill { height: 100%; border-radius: 3px; transition: width 0.5s; }
        .progress-fill.green { background: var(--accent-green); }
        .progress-fill.blue { background: var(--accent-blue); }
        .progress-fill.orange { background: var(--accent-orange); }
        .progress-fill.red { background: var(--accent-red); }

        /* ── Perf Row ──────────────────────────── */
        .perf-row { display: flex; gap: 12px; flex-wrap: wrap; }
        .perf-item {
            flex: 1; min-width: 70px;
            background: var(--bg-secondary);
            padding: 12px; border-radius: var(--radius-md);
            text-align: center;
            transition: background 0.3s, border-color 0.3s;
            border: 1px solid transparent;
        }
        .perf-item .value { font-family: 'Space Grotesk', sans-serif; font-size: 18px; font-weight: 700; }
        .perf-item .label { font-size: 9px; color: var(--text-muted); text-transform: uppercase; margin-top: 2px; }

        /* ── Cảnh báo nhấp nháy khi VRAM/GPU ≥ 90% ── */
        .perf-item.alert-flash {
            animation: alertBgFlash 1s ease-in-out infinite;
            border: 1px solid rgba(239, 68, 68, 0.5);
        }
        @keyframes alertBgFlash {
            0%, 100% { background: var(--bg-secondary); }
            50% { background: rgba(239, 68, 68, 0.2); }
        }

        /* ── Storage ───────────────────────────── */
        .storage-item { margin-bottom: 10px; }
        .storage-header { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }
        .storage-header .name { color: var(--text-muted); }
        .storage-header .value { color: var(--text-primary); font-weight: 500; }

        /* ── List ──────────────────────────────── */
        .list-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
        .list-item:last-child { border-bottom: none; }
        .list-item .name { color: var(--text-primary); display: flex; align-items: center; gap: 6px; min-width: 0; }
        .list-item .meta { color: var(--text-muted); font-size: 11px; max-width: 100%; word-break: break-word; text-align: right; }

        /* ── Model Grid ────────────────────────── */
        .models-lora-panel {
            width: 100%;
            max-width: 100%;
            box-sizing: border-box;
        }
        .models-lora-panel .model-section-card {
            width: 100%;
            max-width: 100%;
            box-sizing: border-box;
            margin-bottom: 16px;
            padding: 16px 18px;
        }
        .models-lora-panel .model-section-card .card-header {
            margin-bottom: 10px;
        }
        .models-lora-panel .model-section-card .model-grid {
            margin-top: 0;
        }
        .models-lora-panel .model-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 12px;
            width: 100%;
            box-sizing: border-box;
            align-items: stretch;
        }
        @media (max-width: 900px) {
            .models-lora-panel .model-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 500px) {
            .models-lora-panel .model-grid { grid-template-columns: 1fr; }
        }
        .model-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 0;
            overflow: hidden;
            transition: all 0.2s;
            position: relative;
            width: 100%;
            min-width: 0;
            display: flex;
            flex-direction: column;
        }
        .model-card.selected {
            border-color: var(--accent-purple);
            box-shadow: 0 0 0 1px rgba(139, 92, 246, 0.35);
        }
        .model-card-visual {
            position: relative;
            width: 100%;
            aspect-ratio: 16 / 10;
            min-height: 88px;
            background: var(--bg-card);
            flex-shrink: 0;
        }
        .model-card-visual > img {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
        .model-visual-fallback {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(145deg, #1a1a24 0%, #12121a 100%);
        }
        .model-card-select {
            position: absolute;
            top: 8px;
            right: 8px;
            z-index: 3;
            background: rgba(10, 10, 15, 0.55);
            border-radius: 4px;
            padding: 2px 4px;
            line-height: 0;
        }
        .model-card-select input {
            width: 14px;
            height: 14px;
            accent-color: var(--accent-purple);
            cursor: pointer;
        }
        .model-card:hover { border-color: var(--accent-blue); }
        .model-card .model-icon { font-size: 28px; line-height: 1; opacity: 0.85; }
        .model-card-overlay {
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 2;
            padding: 28px 12px 10px;
            background: linear-gradient(
                to top,
                rgba(10, 10, 15, 0.96) 0%,
                rgba(10, 10, 15, 0.78) 55%,
                transparent 100%
            );
        }
        .model-card-overlay .model-name {
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 3px;
            line-height: 1.3;
            color: var(--text-primary);
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
        .model-card-overlay .model-meta-line {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
            margin-bottom: 6px;
        }
        .model-card-overlay .model-size,
        .model-card-overlay .model-type-tag {
            font-size: 10px;
            color: rgba(241, 241, 245, 0.72);
        }
        .model-card-overlay .model-type-tag {
            text-transform: uppercase;
            letter-spacing: 0.35px;
        }
        .model-card-overlay .model-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 600;
        }
        .model-badge.system { background: rgba(79, 142, 247, 0.22); color: #93c5fd; }
        .model-badge.mine { background: rgba(139, 92, 246, 0.22); color: #c4b5fd; }
        .model-card .model-actions {
            display: flex;
            gap: 4px;
            flex-wrap: wrap;
            padding: 8px 10px 10px;
        }
        .models-page-header {
            display: flex;
            gap: 12px;
            align-items: center;
            margin-bottom: 14px;
            flex-wrap: wrap;
            width: 100%;
        }
        .models-page-header-spacer { flex: 1; min-width: 12px; }
        .models-page-title {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 24px;
            font-weight: 600;
        }
        .models-filter-row {
            display: flex;
            gap: 8px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        .models-filter-tabs {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }
        .models-filter-btn {
            padding: 6px 12px;
            border-radius: 20px;
            border: 1px solid var(--border);
            background: var(--bg-secondary);
            color: var(--text-muted);
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }
        .models-filter-btn:hover { border-color: var(--accent-blue); color: var(--text-primary); }
        .models-filter-btn.active {
            border-color: var(--accent-blue);
            color: var(--accent-blue);
            background: rgba(79, 142, 247, 0.1);
        }
        .models-page-actions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        .models-upload-hint {
            font-size: 12px;
            color: var(--text-muted);
            margin-top: 8px;
            line-height: 1.5;
        }
        .models-modal-field { margin-bottom: 14px; }
        .models-modal-field label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 6px;
            color: var(--text-secondary);
        }
        .models-modal-field input,
        .models-modal-field select {
            width: 100%;
            padding: 10px 12px;
            border-radius: var(--radius-md);
            border: 1px solid var(--border);
            background: var(--bg-secondary);
            color: var(--text-primary);
            font-size: 13px;
            font-family: inherit;
        }
        .models-modal-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 16px;
        }

        /* ── Workflow Grid ─────────────────────── */
        .workflows-panel {
            width: 100%;
            max-width: 100%;
            box-sizing: border-box;
        }
        .workflows-page-header {
            display: flex;
            gap: 12px;
            align-items: center;
            margin-bottom: 14px;
            flex-wrap: wrap;
            width: 100%;
        }
        .workflows-page-header-spacer { flex: 1; min-width: 12px; }
        .workflows-page-title {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 24px;
            font-weight: 600;
        }
        .workflows-filter-row {
            display: flex;
            gap: 8px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        .workflows-filter-btn {
            padding: 6px 12px;
            border-radius: 20px;
            border: 1px solid var(--border);
            background: var(--bg-secondary);
            color: var(--text-muted);
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }
        .workflows-filter-btn:hover { border-color: var(--accent-blue); color: var(--text-primary); }
        .workflows-filter-btn.active {
            border-color: var(--accent-blue);
            color: var(--accent-blue);
            background: rgba(79, 142, 247, 0.1);
        }
        .workflow-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 16px;
            width: 100%;
            box-sizing: border-box;
            align-items: stretch;
        }
        @media (max-width: 900px) {
            .workflow-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 500px) {
            .workflow-grid { grid-template-columns: 1fr; }
        }
        .workflow-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            overflow: hidden;
            position: relative;
            display: flex;
            flex-direction: column;
            transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        }
        .workflow-card:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
            border-color: rgba(79, 142, 247, 0.35);
        }
        .workflow-delete-btn {
            position: absolute;
            top: 8px;
            right: 8px;
            z-index: 3;
            width: 26px;
            height: 26px;
            padding: 0;
            border-radius: 6px;
            border: 1px solid rgba(239, 68, 68, 0.35);
            background: rgba(239, 68, 68, 0.15);
            color: var(--accent-red);
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            line-height: 1;
            transition: background 0.2s;
        }
        .workflow-delete-btn:hover:not(:disabled) {
            background: rgba(239, 68, 68, 0.28);
        }
        .workflow-delete-btn:disabled { opacity: 0.6; cursor: wait; }
        .workflow-card-thumb {
            width: 100%;
            aspect-ratio: 16 / 9;
            background: #e5e7eb;
            flex-shrink: 0;
            overflow: hidden;
        }
        .workflow-card-thumb > img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
        .workflow-thumb-fallback {
            width: 100%;
            height: 100%;
            background: linear-gradient(145deg, #e5e7eb 0%, #d1d5db 100%);
        }
        .workflow-card-body {
            padding: 12px 14px 14px;
            display: flex;
            flex-direction: column;
            flex: 1;
            gap: 8px;
        }
        .workflow-card-title {
            font-size: 14px;
            font-weight: 600;
            line-height: 1.35;
            color: var(--text-primary);
            margin: 0;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
        .workflow-card-meta {
            font-size: 11px;
            color: var(--text-muted);
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 4px;
        }
        .workflow-meta-dot { opacity: 0.6; }
        .workflow-badge-row {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        .workflow-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 600;
        }
        .workflow-badge.gpu {
            background: rgba(79, 142, 247, 0.18);
            color: #2563eb;
        }
        .workflow-badge.system {
            background: rgba(139, 92, 246, 0.18);
            color: #7c3aed;
        }
        .workflow-badge.mine {
            background: rgba(16, 185, 129, 0.18);
            color: #059669;
        }
        .workflow-card-actions {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }
        .workflow-run-btn {
            width: 100%;
            margin-top: auto;
            padding: 10px 14px;
            border: none;
            border-radius: 8px;
            background: var(--accent-green);
            color: white;
            font-family: 'Space Grotesk', sans-serif;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            transition: background 0.2s, transform 0.2s;
        }
        .workflow-run-btn:hover {
            background: #0d9668;
            transform: translateY(-1px);
        }

        /* ── Storage Panel ─────────────────────── */
        .storage-panel {
            width: 100%;
            max-width: 100%;
            box-sizing: border-box;
        }
        .storage-page-header {
            margin-bottom: 14px;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 10px;
        }
        .storage-page-title {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 24px;
            font-weight: 600;
        }
        .storage-action-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 20px;
        }
        .storage-transfer-btn {
            background: var(--accent-blue);
            color: white;
            border: none;
            font-weight: 700;
            padding: 8px 16px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(79, 142, 247, 0.25);
        }
        .storage-transfer-btn:hover:not(:disabled) {
            background: #3A7DE8;
            transform: translateY(-1px);
        }
        .storage-transfer-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .storage-transfer-modal {
            max-width: 440px;
        }
        .storage-transfer-directions {
            display: grid;
            gap: 10px;
            margin-bottom: 16px;
        }
        .storage-transfer-option {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 12px 14px;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: border-color 0.2s, background 0.2s;
            text-align: left;
            background: var(--bg-secondary);
        }
        .storage-transfer-option:hover:not(.disabled) {
            border-color: var(--accent-blue);
        }
        .storage-transfer-option.selected {
            border-color: var(--accent-blue);
            background: rgba(79, 142, 247, 0.08);
        }
        .storage-transfer-option.disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }
        .storage-transfer-option input {
            margin-top: 3px;
            accent-color: var(--accent-blue);
        }
        .storage-transfer-option-main {
            flex: 1;
            min-width: 0;
        }
        .storage-transfer-option-main strong {
            display: block;
            font-size: 13px;
            margin-bottom: 4px;
        }
        .storage-transfer-option-main span {
            font-size: 11px;
            color: var(--text-muted);
        }
        .storage-transfer-summary {
            font-size: 12px;
            color: var(--text-secondary);
            margin-bottom: 16px;
            padding: 10px 12px;
            border-radius: var(--radius-sm);
            background: var(--bg-secondary);
        }
        .storage-transfer-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }
        .storage-columns {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
            align-items: start;
        }
        @media (max-width: 900px) {
            .storage-columns { grid-template-columns: 1fr; }
        }
        .storage-card {
            background: var(--bg-card);
            color: var(--text-primary);
            border: 1px solid var(--border);
            border-radius: 8px;
            box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
            padding: 18px;
            min-width: 0;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .storage-card:hover {
            border-color: rgba(79, 142, 247, 0.25);
        }
        .storage-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 14px;
            flex-wrap: wrap;
        }
        .storage-card-header h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 700;
            color: #F8F8FC;
        }
        .storage-status {
            font-size: 10px;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 10px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }
        .storage-status.online {
            background: rgba(16, 185, 129, 0.15);
            color: #34d399;
        }
        .storage-status.offline {
            background: rgba(239, 68, 68, 0.12);
            color: #f87171;
        }
        .storage-status.backup {
            background: rgba(79, 142, 247, 0.15);
            color: #93c5fd;
        }
        .storage-card-offline {
            position: relative;
        }
        .storage-offline-notice {
            margin: 0 0 12px;
            padding: 10px 12px;
            border-radius: 8px;
            background: rgba(239, 68, 68, 0.08);
            border: 1px solid rgba(239, 68, 68, 0.25);
            color: #f87171;
            font-size: 12px;
            font-weight: 600;
        }
        .storage-card-body-dimmed {
            position: relative;
            pointer-events: none;
            user-select: none;
        }
        .storage-card-body-dimmed::after {
            content: '';
            position: absolute;
            inset: 0;
            background: rgba(10, 10, 15, 0.32);
            border-radius: 6px;
            pointer-events: none;
        }
        .storage-progress-wrap {
            margin-bottom: 16px;
        }
        .storage-progress-meta {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            font-size: 12px;
            color: #A8A8B8;
            margin-bottom: 6px;
        }
        .storage-progress-meta strong {
            color: #F4F4F8;
        }
        .storage-progress-track {
            height: 8px;
            border-radius: 999px;
            background: var(--bg-secondary);
            overflow: hidden;
        }
        .storage-progress-fill {
            height: 100%;
            border-radius: 999px;
            transition: width 0.3s ease;
        }
        .storage-progress-fill.ssd {
            background: linear-gradient(90deg, #4F8EF7, #2563eb);
        }
        .storage-progress-fill.backup {
            background: linear-gradient(90deg, #34d399, #059669);
        }
        .storage-card-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 10px;
        }
        .storage-list-title {
            display: block;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            color: #A8A8B8;
            margin-bottom: 8px;
        }
        .storage-folder-list,
        .storage-backup-list {
            list-style: none;
            margin: 0;
            padding: 0;
        }
        .storage-folder-item {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 10px 8px;
            border-radius: 6px;
            transition: background 0.15s;
        }
        .storage-folder-item:hover {
            background: var(--bg-card-hover);
        }
        .storage-folder-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            border-radius: 4px;
            background: rgba(251, 191, 36, 0.22);
            color: #fde68a;
            font-size: 16px;
            line-height: 1;
            flex-shrink: 0;
            filter: brightness(1.12);
        }
        .storage-folder-info {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
        }
        .storage-folder-name {
            font-size: 13px;
            font-weight: 600;
            color: #F4F4F8;
        }
        .storage-folder-meta {
            font-size: 11px;
            color: #B0B0BE;
        }
        .storage-empty {
            font-size: 13px;
            color: var(--text-muted);
            padding: 16px 8px;
            margin: 0;
        }
        .storage-backup-item {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 10px 8px;
            border-radius: 6px;
            border-bottom: 1px solid var(--border);
            transition: background 0.15s;
        }
        .storage-backup-item:last-child {
            border-bottom: none;
        }
        .storage-backup-item:hover {
            background: var(--bg-card-hover);
        }
        .storage-backup-main {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
            flex: 1;
        }
        .storage-backup-name {
            font-size: 13px;
            font-weight: 600;
            color: #F4F4F8;
            word-break: break-word;
        }
        .storage-backup-meta {
            font-size: 11px;
            color: #B0B0BE;
        }
        .storage-backup-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        .storage-delete-btn {
            background: rgba(239, 68, 68, 0.1);
            color: var(--accent-red);
            border: 1px solid rgba(239, 68, 68, 0.25);
        }
        .storage-delete-btn:hover:not(:disabled) {
            background: rgba(239, 68, 68, 0.18);
        }

        /* ── Storage Upgrade Modal ─────────────── */
        .storage-upgrade-overlay.active {
            animation: storageModalFadeIn 0.25s ease;
            padding: 12px;
            overflow: hidden;
        }
        @keyframes storageModalFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        .storage-upgrade-modal {
            animation: storageModalSlideUp 0.3s ease;
        }
        @keyframes storageModalSlideUp {
            from { opacity: 0; transform: translateY(16px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 768px) {
            .storage-upgrade-overlay.active {
                padding: 8px;
            }
            .modal.storage-upgrade-modal {
                max-height: calc(100dvh - 16px);
                padding: 14px 12px 12px;
                border-radius: var(--radius-lg);
            }
        }
        @media (max-height: 720px) {
            .modal.storage-upgrade-modal {
                padding: 12px 14px 10px;
            }
            .modal.storage-upgrade-modal h3 {
                margin-bottom: 8px;
                font-size: 16px;
            }
        }
        .storage-upgrade-label {
            display: block;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            color: var(--text-muted);
            margin-bottom: 8px;
        }
        .storage-upgrade-columns {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
            margin-bottom: 10px;
            flex-shrink: 1;
            min-height: 0;
        }
        @media (max-width: 768px) {
            .storage-upgrade-columns {
                grid-template-columns: 1fr;
                gap: 8px;
            }
        }
        .storage-upgrade-zone {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 10px;
            min-width: 0;
        }
        .storage-upgrade-zone-title {
            margin: 0 0 8px;
            font-size: 13px;
            font-weight: 700;
            color: var(--text-primary);
        }
        .storage-upgrade-zone .storage-progress-wrap {
            margin-bottom: 8px;
        }
        .storage-upgrade-zone .storage-progress-meta {
            font-size: 10px;
            margin-bottom: 4px;
        }
        .storage-upgrade-zone .storage-progress-track {
            height: 6px;
        }
        .storage-upgrade-plans {
            border: none;
            margin: 0;
            padding: 0;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 6px;
        }
        .storage-upgrade-plans legend {
            padding: 0;
            grid-column: 1 / -1;
            margin-bottom: 2px;
        }
        .storage-upgrade-option-row {
            display: contents;
        }
        .storage-upgrade-option-row.blocked {
            display: grid;
            grid-column: 1 / -1;
            grid-template-columns: 1fr auto;
            align-items: start;
            gap: 4px 8px;
            margin-bottom: 2px;
        }
        .storage-upgrade-option {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 8px;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            background: var(--bg-card);
            cursor: pointer;
            transition: border-color 0.2s, background 0.2s;
        }
        .storage-upgrade-option-row.blocked .storage-upgrade-option {
            grid-column: 1 / 2;
        }
        .storage-upgrade-option:hover:not(.is-blocked) {
            border-color: rgba(79, 142, 247, 0.4);
        }
        .storage-upgrade-option.selected {
            border-color: var(--accent-blue);
            background: rgba(79, 142, 247, 0.08);
        }
        .storage-upgrade-option.is-blocked {
            opacity: 0.55;
            cursor: not-allowed;
            border-color: rgba(239, 68, 68, 0.25);
            background: rgba(239, 68, 68, 0.04);
        }
        .storage-upgrade-option input {
            accent-color: var(--accent-blue);
            flex-shrink: 0;
        }
        .storage-upgrade-option-main {
            display: flex;
            flex-direction: column;
            gap: 1px;
            flex: 1;
            min-width: 0;
        }
        .storage-upgrade-option-main strong {
            font-size: 12px;
            color: var(--text-primary);
            line-height: 1.2;
        }
        .storage-current-dot {
            color: var(--accent-green);
            font-size: 10px;
        }
        .storage-upgrade-option-price {
            font-size: 9px;
            color: var(--text-muted);
            line-height: 1.2;
        }
        .storage-upgrade-option-tag {
            display: none;
        }
        .storage-option-blocked-msg {
            grid-column: 1 / -1;
            margin: 0;
            font-size: 10px;
            line-height: 1.35;
            color: #f87171;
            font-weight: 500;
        }
        .storage-upgrade-option-row.blocked .storage-clean-mini {
            grid-column: 2 / 3;
            grid-row: 1;
            align-self: center;
        }
        .storage-clean-mini {
            padding: 4px 8px;
            font-size: 10px;
            background: rgba(239, 68, 68, 0.1);
            color: #fca5a5;
            border: 1px solid rgba(239, 68, 68, 0.28);
            white-space: nowrap;
        }
        .storage-clean-mini:hover {
            background: rgba(239, 68, 68, 0.18);
        }
        .storage-upgrade-summary {
            font-size: 12px;
            color: var(--text-secondary);
            line-height: 1.5;
            flex-shrink: 0;
        }
        .storage-upgrade-summary p {
            margin: 0 0 2px;
        }
        .storage-upgrade-summary-divider {
            height: 1px;
            background: var(--border);
            margin: 0 0 8px;
        }
        .storage-upgrade-summary-total {
            margin-top: 4px !important;
            font-size: 13px;
            color: var(--text-primary) !important;
        }
        .storage-upgrade-summary-total strong {
            color: #93c5fd;
        }
        .storage-section-highlight {
            animation: storageSectionHighlight 2s ease;
        }
        @keyframes storageSectionHighlight {
            0% {
                box-shadow: 0 0 0 0 rgba(251, 191, 36, 0);
                background: var(--bg-card);
            }
            15%, 70% {
                box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.45);
                background: rgba(251, 191, 36, 0.08);
            }
            100% {
                box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
                background: var(--bg-card);
            }
        }
        .storage-upgrade-summary p span:first-child {
            font-weight: 600;
            color: var(--text-muted);
        }
        .storage-upgrade-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 10px;
            flex-shrink: 0;
        }
        .storage-toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 300;
            padding: 12px 18px;
            border-radius: var(--radius-md);
            background: rgba(16, 185, 129, 0.15);
            border: 1px solid rgba(16, 185, 129, 0.35);
            color: #6ee7b7;
            font-size: 13px;
            font-weight: 600;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
            animation: storageToastIn 0.35s ease;
        }
        @keyframes storageToastIn {
            from { opacity: 0; transform: translateY(12px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 768px) {
            .storage-toast {
                left: 16px;
                right: 16px;
                bottom: 16px;
            }
        }

        /* ── Storage status & checkout ─────────── */
        .storage-status-badge {
            font-size: 10px;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 12px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            max-width: min(100%, 420px);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .storage-status-badge.pending {
            background: rgba(245, 158, 11, 0.15);
            color: #fbbf24;
            border: 1px solid rgba(245, 158, 11, 0.35);
        }
        .storage-status-badge.rejected {
            background: rgba(239, 68, 68, 0.12);
            color: #f87171;
            border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .storage-checkout-page {
            max-width: 560px;
        }
        .storage-checkout-back {
            display: inline-block;
            font-size: 13px;
            color: var(--text-muted);
            text-decoration: none;
            margin-bottom: 12px;
        }
        .storage-checkout-back:hover {
            color: var(--accent-blue);
        }
        .storage-checkout-title {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 22px;
            margin-bottom: 16px;
        }
        .storage-checkout-summary-card h3 {
            font-size: 15px;
            margin-bottom: 10px;
        }
        .storage-checkout-summary-card p {
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 6px;
        }
        .storage-checkout-total {
            margin-top: 10px !important;
            font-size: 15px !important;
            color: var(--text-primary) !important;
        }
        .storage-checkout-sub {
            display: block;
            font-size: 11px;
            color: var(--text-muted);
            font-weight: 400;
            margin-top: 2px;
        }
        .storage-checkout-error {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.25);
            color: #f87171;
            padding: 10px 12px;
            border-radius: 8px;
            font-size: 13px;
            margin-bottom: 12px;
        }
        .storage-checkout-methods {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-bottom: 12px;
        }
        @media (max-width: 500px) {
            .storage-checkout-methods { grid-template-columns: 1fr; }
        }
        .storage-checkout-method {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
            padding: 12px;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            background: var(--bg-secondary);
            cursor: pointer;
            text-align: left;
            color: inherit;
            font-family: inherit;
            transition: border-color 0.2s, background 0.2s;
        }
        .storage-checkout-method.active {
            border-color: var(--accent-blue);
            background: rgba(79, 142, 247, 0.08);
        }
        .storage-checkout-method .method-icon {
            font-size: 20px;
        }
        .storage-checkout-method .method-label {
            font-size: 13px;
            font-weight: 700;
            color: var(--text-primary);
        }
        .storage-checkout-method .method-meta {
            font-size: 11px;
            color: var(--text-muted);
        }
        .storage-checkout-panel .subtitle {
            font-size: 12px;
            color: var(--text-muted);
            margin-bottom: 12px;
        }
        .storage-checkout-qr {
            background: var(--bg-secondary);
            border: 1px dashed var(--border);
            border-radius: var(--radius-md);
            padding: 32px;
            text-align: center;
            color: var(--text-muted);
            margin-bottom: 12px;
        }
        .storage-checkout-transfer-note {
            font-size: 13px;
            margin-bottom: 10px;
        }
        .storage-checkout-transfer-note .highlight {
            margin-top: 6px;
            padding: 8px 10px;
            background: var(--bg-secondary);
            border-radius: 6px;
            font-weight: 600;
            word-break: break-word;
        }
        .storage-checkout-check {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            font-size: 12px;
            color: var(--text-secondary);
            margin-top: 12px;
            cursor: pointer;
        }
        .storage-checkout-warn {
            color: #fbbf24;
            font-size: 12px;
            margin-top: 8px;
        }

        /* ── History / Session ─────────────────── */
        .history-panel .page-title { margin-bottom: 6px; }
        .history-panel .page-subtitle { margin-bottom: 24px; }
        .history-view-all-btn {
            background: none;
            border: none;
            padding: 0;
            font: inherit;
            color: var(--accent-blue);
            cursor: pointer;
        }
        .history-view-all-btn:hover { text-decoration: underline; }
        .history-empty {
            text-align: center;
            padding: 32px 16px;
            color: var(--text-muted);
            font-size: 13.5px;
            line-height: 1.6;
        }
        .history-error {
            text-align: center;
            padding: 24px 16px;
            color: var(--accent-red);
            font-size: 13.5px;
        }
        .history-load-more {
            background: none;
            border: none;
            width: 100%;
            font: inherit;
        }
        .history-load-more:disabled {
            opacity: 0.6;
            cursor: wait;
        }

        .session-item {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 18px 20px;
            margin-bottom: 12px;
            transition: border-color 0.2s;
        }
        .session-item:hover {
            border-color: rgba(79, 142, 247, 0.3);
        }
        .session-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            gap: 12px;
            flex-wrap: wrap;
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
            white-space: nowrap;
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
            animation: session-pulse 2s infinite;
        }
        @keyframes session-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
        }
        .session-details {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
        }
        .session-detail {
            display: flex;
            align-items: flex-start;
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
            background: none;
            border: none;
            width: 100%;
            font: inherit;
        }
        .view-all-link:hover { text-decoration: underline; }

        @media (max-width: 900px) {
            .session-details { grid-template-columns: 1fr; }
        }

        /* ── Support ───────────────────────────── */
        .support-row { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; font-size: 12px; color: var(--text-muted); }

        /* ── Modal ─────────────────────────────── */
        .modal-overlay {
            display: none; position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7); z-index: 200;
            align-items: center; justify-content: center;
        }
        .modal-overlay.active { display: flex; }
        .modal {
            background: var(--bg-card); border: 1px solid var(--border);
            border-radius: var(--radius-2xl); padding: 28px;
            max-width: 480px; width: 90%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            position: relative;
        }
        .modal h3 { font-size: 18px; margin-bottom: 14px; font-family: 'Space Grotesk', sans-serif; }
        .modal .close-btn {
            position: absolute; top: 12px; right: 12px;
            background: none; border: none;
            color: var(--text-muted); font-size: 16px; cursor: pointer;
        }
        .modal .option-group {
            background: var(--bg-secondary); border: 1px solid var(--border);
            border-radius: var(--radius-md); padding: 12px; margin-bottom: 8px;
        }
        .modal .option-group label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; }
        .modal .file-list { margin-top: 10px; }
        .modal .file-list label { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; cursor: pointer; }
        .modal .warning {
            background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2);
            border-radius: var(--radius-sm); padding: 8px;
            font-size: 11px; color: var(--accent-orange); margin-top: 10px;
        }
        .modal.storage-upgrade-modal {
            max-width: 650px;
            width: 100%;
            padding: 18px 20px 16px;
            max-height: calc(100dvh - 24px);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            box-sizing: border-box;
        }
        .modal.storage-upgrade-modal h3 {
            margin-bottom: 10px;
            font-size: 17px;
            flex-shrink: 0;
        }

        /* ── Plan selector modal ───────────────── */
        .plan-selector-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.65);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            z-index: 1000;
            animation: planSelectorFadeIn 0.2s ease;
        }
        @keyframes planSelectorFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        .plan-selector-modal {
            width: min(480px, 100%);
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 24px 48px rgba(0, 0, 0, 0.45);
            animation: planSelectorScaleIn 0.22s ease;
        }
        @keyframes planSelectorScaleIn {
            from { opacity: 0; transform: scale(0.96); }
            to { opacity: 1; transform: scale(1); }
        }
        .plan-selector-modal h3 {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 8px;
        }
        .plan-selector-subtitle {
            color: var(--text-secondary);
            font-size: 14px;
            margin-bottom: 16px;
            line-height: 1.5;
        }
        .plan-selector-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 14px;
        }
        .plan-selector-card {
            width: 100%;
            text-align: left;
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 16px;
            background: var(--bg-secondary);
            color: var(--text-primary);
            cursor: pointer;
            transition: border-color 0.15s, background 0.15s;
        }
        .plan-selector-card:hover {
            border-color: var(--accent-blue);
        }
        .plan-selector-card.selected {
            border: 2px solid var(--accent-blue);
            background: rgba(79, 142, 247, 0.05);
        }
        .plan-selector-card-head {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
            font-size: 15px;
        }
        .plan-selector-radio {
            color: var(--accent-blue);
            font-size: 14px;
            line-height: 1;
        }
        .plan-selector-card-meta,
        .plan-selector-card-price {
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 4px;
        }
        .plan-selector-badge {
            display: inline-flex;
            align-items: center;
            margin-top: 8px;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
        }
        .plan-selector-badge.starter {
            background: rgba(34, 197, 94, 0.15);
            color: #22C55E;
        }
        .plan-selector-badge.pro {
            background: rgba(139, 92, 246, 0.15);
            color: #8B5CF6;
        }
        .plan-selector-badge.studio {
            background: rgba(245, 158, 11, 0.15);
            color: #F59E0B;
        }
        .plan-selector-badge.gift {
            background: rgba(34, 197, 94, 0.12);
            color: #22C55E;
        }
        .plan-selector-badge.hourly {
            background: rgba(79, 142, 247, 0.12);
            color: var(--accent-blue);
        }
        .plan-selector-expiry-warn {
            margin-top: 8px;
            font-size: 12px;
            font-weight: 600;
            color: #F59E0B;
        }
        .plan-selector-tip {
            font-size: 12px;
            color: var(--text-muted);
            margin-bottom: 18px;
            line-height: 1.5;
        }
        .plan-selector-actions {
            display: flex;
            justify-content: space-between;
            gap: 12px;
        }

        /* ── Responsive ────────────────────────── */
        @media (max-width: 768px) {
            .timer-display { font-size: 32px; }
            .metric-value { font-size: clamp(20px, 7vw, 28px); }
            .card { padding: 14px; }
            .card-header { align-items: flex-start; }
            .status-badge {
                max-width: 100%;
                flex-wrap: wrap;
                white-space: normal;
                line-height: 1.35;
            }
            .dashboard-server-card {
                padding-top: 12px;
            }
            .btn-group-server {
                flex-direction: column;
                align-items: stretch;
            }
            .btn-group-server .btn,
            .btn-group-server .btn-launch,
            .btn-group-server .btn-power-square {
                width: 100%;
                height: auto;
                min-height: 46px;
                white-space: normal;
                text-align: center;
                padding: 12px 14px;
            }
            .btn-launch {
                padding: 12px 14px;
                font-size: 14px;
            }
            .machine-confirm-actions {
                flex-direction: column;
            }
            .machine-confirm-actions .btn {
                width: 100%;
                justify-content: center;
            }
            .machine-toast {
                left: 10px;
                right: 10px;
                bottom: 12px;
                max-width: none;
            }
            .support-row {
                flex-direction: column;
                align-items: center;
                gap: 10px;
                text-align: center;
            }
            .support-active-banner {
                flex-direction: column;
                align-items: stretch;
            }
            .support-active-banner .btn {
                width: 100%;
                justify-content: center;
            }
            .alert-card {
                flex-wrap: wrap;
            }
            .notification-dropdown-panel {
                position: fixed;
                top: auto;
                bottom: calc(64px + env(safe-area-inset-bottom));
                left: 8px;
                right: 8px;
                width: auto;
                max-width: none;
            }
            .dashboard-stat-row {
                flex-wrap: wrap;
            }
            .dashboard-stat-meta {
                white-space: normal;
                text-align: left;
            }
            .plan-selector-actions {
                flex-direction: column;
            }
            .plan-selector-actions .btn {
                width: 100%;
                justify-content: center;
            }
        }
        @media (max-width: 480px) {
            .main-content { padding: 10px 8px; }
            .header { padding: 0 8px; }
            .wallet-dropdown-trigger { max-width: 96px; }
        }

        /* ── Mobile / Tablet shell ─────────────── */
        .dashboard-shell {
            min-height: 100vh;
        }

        .dashboard-hamburger {
            display: none;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            border-radius: var(--radius-md);
            border: 1px solid var(--border);
            background: var(--bg-card);
            color: var(--text-primary);
            font-size: 18px;
            cursor: pointer;
            flex-shrink: 0;
        }

        .dashboard-sidebar-backdrop {
            position: fixed;
            inset: 0;
            z-index: 110;
            border: none;
            background: rgba(0, 0, 0, 0.55);
            cursor: pointer;
        }

        .dashboard-bottom-nav {
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 120;
            display: flex;
            align-items: stretch;
            justify-content: space-around;
            gap: 4px;
            padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
            background: rgba(13, 13, 20, 0.96);
            border-top: 1px solid var(--border);
            backdrop-filter: blur(12px);
        }

        .dashboard-bottom-nav-item {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 2px;
            min-height: 52px;
            padding: 4px 6px;
            border: none;
            border-radius: 10px;
            background: transparent;
            color: var(--text-muted);
            text-decoration: none;
            font-size: 10px;
            font-family: inherit;
            cursor: pointer;
        }

        .dashboard-bottom-nav-item.active {
            color: var(--accent-blue);
            background: rgba(79, 142, 247, 0.1);
        }

        .dashboard-bottom-nav-icon {
            font-size: 18px;
            line-height: 1;
        }

        .dashboard-bottom-nav-label {
            line-height: 1.2;
            text-align: center;
        }

        .main-content--mobile-bottom-nav {
            padding-bottom: calc(72px + env(safe-area-inset-bottom));
        }

        .dashboard-mobile-notif-host {
            position: fixed;
            bottom: calc(58px + env(safe-area-inset-bottom));
            right: 12px;
            z-index: 130;
            width: 1px;
            height: 1px;
            overflow: visible;
            pointer-events: none;
        }

        .dashboard-mobile-notif-host .notification-bell-wrap {
            pointer-events: auto;
            position: absolute;
            right: 0;
            bottom: 0;
            opacity: 0;
            width: 40px;
            height: 40px;
        }

        .dashboard-mobile-notif-host .notification-bell-trigger {
            width: 40px;
            height: 40px;
        }

        .comfy-mobile-note {
            width: 100%;
            margin: 0 0 8px;
            padding: 12px 14px;
            border-radius: var(--radius-md);
            background: rgba(79, 142, 247, 0.08);
            border: 1px solid rgba(79, 142, 247, 0.2);
            color: var(--text-secondary);
            font-size: 13px;
            line-height: 1.5;
            text-align: center;
        }

        .comfy-mobile-try-btn {
            display: block;
            margin: 8px auto 0;
            border: none;
            background: none;
            color: var(--accent-blue);
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            text-decoration: underline;
            font-family: inherit;
        }

        .dashboard-recent-images-mobile {
            grid-column: 1 / -1;
        }

        .dashboard-recent-images-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
        }

        .dashboard-recent-image-item {
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-width: 0;
        }

        .dashboard-recent-image-item img {
            width: 100%;
            aspect-ratio: 1;
            object-fit: cover;
            border-radius: var(--radius-md);
            border: 1px solid var(--border);
            background: var(--bg-secondary);
        }

        .dashboard-recent-image-download {
            width: 100%;
            justify-content: center;
        }

        @media (max-width: 767px) {
            .dashboard-hamburger { display: inline-flex; }

            .dashboard-shell--mobile .sidebar {
                width: min(280px, 86vw);
                transform: translateX(-110%);
                transition: transform 0.25s ease;
                z-index: 115;
                box-shadow: 8px 0 24px rgba(0, 0, 0, 0.35);
            }

            .dashboard-shell--mobile.dashboard-shell--sidebar-open .sidebar {
                transform: translateX(0);
            }

            .dashboard-shell--mobile .header {
                left: 0;
            }

            .dashboard-shell--mobile .main-content {
                margin-left: 0;
            }

            .dashboard-shell--mobile .sidebar-logo span:last-child,
            .dashboard-shell--mobile .sidebar-item span:not(.icon) {
                display: inline;
            }

            .dashboard-shell--mobile .sidebar-item {
                justify-content: flex-start;
                padding: 10px 12px;
            }

            .dashboard-shell--mobile .sidebar-logo {
                justify-content: flex-start;
            }
        }

        @media (min-width: 768px) and (max-width: 1024px) {
            .dashboard-shell--tablet .sidebar {
                width: 64px;
                padding: 16px 0;
            }

            .dashboard-shell--tablet .sidebar-logo {
                justify-content: center;
                padding: 0 8px 14px;
            }

            .dashboard-shell--tablet .sidebar-logo span:last-child {
                display: none;
            }

            .dashboard-shell--tablet .sidebar-item {
                justify-content: center;
                padding: 10px 8px;
            }

            .dashboard-shell--tablet .sidebar-item span:not(.icon) {
                display: none;
            }

            .dashboard-shell--tablet .sidebar-divider {
                margin: 4px 8px;
            }

            .dashboard-shell--tablet .header {
                left: 64px;
            }

            .dashboard-shell--tablet .main-content {
                margin-left: 64px;
            }
        }`;

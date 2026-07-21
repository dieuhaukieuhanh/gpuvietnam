export const myPlanStyles = `
        .my-plan-panel {
            width: 100%;
            max-width: none;
        }

        .my-plan-hero {
            margin-bottom: 20px;
        }

        .my-plan-hero h2 {
            font-size: 22px;
            font-weight: 700;
            margin-bottom: 6px;
        }

        .my-plan-hero p {
            color: var(--text-secondary);
            font-size: 14px;
        }

        .my-plan-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 24px;
            margin-bottom: 16px;
        }

        .my-plan-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 20px;
        }

        .my-plan-name {
            font-size: 20px;
            font-weight: 700;
        }

        .my-plan-badge {
            font-size: 11px;
            font-weight: 600;
            padding: 4px 10px;
            border-radius: 999px;
            background: rgba(79, 142, 247, 0.15);
            color: var(--accent-blue);
        }

        .my-plan-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
            margin-bottom: 20px;
        }

        @media (max-width: 640px) {
            .my-plan-grid {
                grid-template-columns: 1fr;
            }
        }

        .my-plan-stat {
            padding: 14px 16px;
            background: var(--bg-secondary);
            border-radius: var(--radius-md);
            border: 1px solid var(--border);
        }

        .my-plan-stat-label {
            font-size: 12px;
            color: var(--text-muted);
            margin-bottom: 6px;
        }

        .my-plan-stat-value {
            font-size: 15px;
            font-weight: 600;
            color: var(--text-primary);
        }

        .my-plan-stat-value.accent {
            color: var(--accent-blue);
        }

        .my-plan-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            align-items: center;
        }

        .my-plan-renew-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 14px 28px;
            font-size: 15px;
            font-weight: 700;
            border-radius: var(--radius-md);
            border: 2px solid rgba(167, 139, 250, 0.85);
            background: linear-gradient(135deg, rgba(79, 142, 247, 0.22) 0%, rgba(139, 92, 246, 0.28) 100%);
            color: #fff;
            box-shadow:
                0 0 0 1px rgba(139, 92, 246, 0.35),
                0 0 20px rgba(139, 92, 246, 0.25),
                0 4px 16px rgba(79, 142, 247, 0.2);
            transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
            text-decoration: none;
        }

        .my-plan-renew-btn:hover {
            transform: translateY(-1px);
            border-color: rgba(196, 181, 253, 0.95);
            box-shadow:
                0 0 0 1px rgba(167, 139, 250, 0.5),
                0 0 28px rgba(139, 92, 246, 0.4),
                0 6px 22px rgba(79, 142, 247, 0.28);
            color: #fff;
        }

        .my-plan-renew-urgent {
            animation: my-plan-renew-glow 2s ease-in-out infinite;
        }

        @keyframes my-plan-renew-glow {
            0%, 100% {
                box-shadow:
                    0 0 0 1px rgba(139, 92, 246, 0.35),
                    0 0 20px rgba(139, 92, 246, 0.25),
                    0 4px 16px rgba(79, 142, 247, 0.2);
            }
            50% {
                box-shadow:
                    0 0 0 2px rgba(196, 181, 253, 0.55),
                    0 0 32px rgba(139, 92, 246, 0.45),
                    0 6px 22px rgba(79, 142, 247, 0.3);
            }
        }

        .my-plan-expiry-warn {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            margin-bottom: 16px;
            border-radius: var(--radius-md);
            background: rgba(245, 158, 11, 0.1);
            border: 1px solid rgba(245, 158, 11, 0.25);
            color: var(--accent-orange);
            font-size: 13px;
        }

        .my-plan-upgrade {
            border-color: rgba(139, 92, 246, 0.35);
            background: linear-gradient(135deg, rgba(79, 142, 247, 0.08) 0%, rgba(139, 92, 246, 0.08) 100%);
        }

        .my-plan-upgrade-title {
            font-size: 16px;
            font-weight: 700;
            margin-bottom: 8px;
        }

        .my-plan-upgrade-desc {
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 14px;
            line-height: 1.5;
        }

        .my-plan-upgrade-price {
            font-size: 14px;
            margin-bottom: 14px;
        }

        .my-plan-upgrade-price strong {
            color: var(--accent-purple);
        }

        .my-plan-note {
            padding: 14px 16px;
            border-radius: var(--radius-md);
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            font-size: 14px;
            color: var(--text-secondary);
            margin-bottom: 16px;
        }

        .my-plan-note strong {
            color: var(--text-primary);
        }

        .my-plan-footer-link {
            display: inline-block;
            margin-top: 8px;
            font-size: 14px;
            color: var(--accent-blue);
            text-decoration: none;
        }

        .my-plan-footer-link:hover {
            text-decoration: underline;
        }

        .my-plan-empty {
            text-align: center;
            padding: 48px 24px;
        }

        .my-plan-empty h3 {
            font-size: 18px;
            margin-bottom: 10px;
        }

        .my-plan-empty p {
            color: var(--text-secondary);
            font-size: 14px;
            margin-bottom: 20px;
        }

        .my-plan-welcome {
            text-align: center;
            padding: 32px 24px;
            margin-bottom: 20px;
        }

        .my-plan-welcome-compact {
            padding: 18px 20px;
            margin-bottom: 16px;
        }

        .my-plan-tier-grid {
            display: flex;
            flex-direction: column;
            gap: 14px;
            margin-bottom: 20px;
            width: 100%;
        }

        .my-plan-tier-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 16px 18px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            min-height: 180px;
        }

        .my-plan-tier-card.is-selected {
            border-color: rgba(16, 185, 129, 0.5);
            box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.12);
        }

        .my-plan-tier-card.is-empty {
            opacity: 0.92;
        }

        .my-plan-tier-select {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            cursor: pointer;
            margin: 0;
        }

        .my-plan-tier-radio {
            margin-top: 4px;
            flex-shrink: 0;
            accent-color: var(--accent-green);
            cursor: pointer;
        }

        .my-plan-tier-radio:disabled {
            cursor: not-allowed;
        }

        .my-plan-tier-head {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
        }

        .my-plan-tier-name {
            font-size: 17px;
            font-weight: 700;
            color: var(--text-primary);
        }

        .my-plan-tier-spec {
            font-size: 12px;
            color: var(--text-muted);
        }

        .my-plan-tier-tree {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding-left: 2px;
        }

        .my-plan-tier-empty {
            font-size: 13px;
            color: var(--text-muted);
            margin: 0;
            padding-left: 22px;
        }

        .my-plan-tier-line {
            display: flex;
            flex-wrap: wrap;
            align-items: baseline;
            gap: 0 6px;
            font-size: 13px;
            line-height: 1.45;
            color: var(--text-secondary);
        }

        .my-plan-tier-line.is-active-line {
            color: var(--text-primary);
        }

        .my-plan-tier-line.is-muted {
            opacity: 0.55;
        }

        .my-plan-tier-branch {
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            color: var(--text-muted);
            flex-shrink: 0;
        }

        .my-plan-tier-package {
            font-weight: 600;
            color: var(--text-primary);
            min-width: 4.5rem;
        }

        .my-plan-tier-line.is-muted .my-plan-tier-package {
            color: var(--text-secondary);
        }

        .my-plan-tier-sep {
            color: var(--text-muted);
        }

        .my-plan-tier-remaining {
            flex: 1;
            min-width: 0;
        }

        .my-plan-tier-status {
            font-size: 11px;
            color: var(--text-muted);
        }

        .my-plan-tier-renew {
            margin-left: auto;
            padding: 0;
            border: none;
            background: none;
            color: var(--accent-blue);
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            text-decoration: underline;
            text-underline-offset: 2px;
        }

        .my-plan-tier-renew:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .my-plan-tier-buy {
            align-self: flex-start;
            margin-top: auto;
            width: 20%;
            justify-content: center;
            padding: 6px 12px;
            font-size: 13px;
            font-weight: 600;
            border: 1px solid var(--accent-blue, #4f8ef7);
            color: var(--accent-blue, #4f8ef7);
            background: rgba(79, 142, 247, 0.08);
            border-radius: var(--radius-md, 8px);
            transition: background 0.15s ease, border-color 0.15s ease;
            white-space: nowrap;
        }

        .my-plan-tier-buy:hover {
            background: rgba(79, 142, 247, 0.18);
            border-color: var(--accent-blue, #4f8ef7);
        }

        .my-plan-tier-buy:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .my-plan-storage-upgrade {
            margin-top: 20px;
            max-width: 460px;
        }

        .purchase-modal {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 24px;
            max-width: 520px;
            width: 100%;
            max-height: min(90vh, 720px);
            overflow-y: auto;
        }

        .purchase-modal h3 {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 6px;
        }

        .purchase-modal-spec {
            font-size: 13px;
            color: var(--text-muted);
            margin-bottom: 4px;
        }

        .purchase-modal-hint {
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 14px;
        }

        .purchase-modal-options {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 14px;
        }

        .purchase-option {
            display: block;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            background: var(--bg-secondary);
            cursor: pointer;
            transition: border-color 0.15s ease, background 0.15s ease;
        }

        .purchase-option.is-selected {
            border-color: rgba(79, 142, 247, 0.55);
            background: rgba(79, 142, 247, 0.08);
        }

        .purchase-option-radio {
            position: absolute;
            opacity: 0;
            pointer-events: none;
        }

        .purchase-option-body {
            padding: 12px 14px;
        }

        .purchase-option-head {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            line-height: 1.5;
            margin-bottom: 8px;
        }

        .purchase-option-title {
            font-weight: 700;
            color: var(--text-primary);
        }

        .purchase-option-sep {
            color: var(--text-muted);
        }

        .purchase-option-detail {
            color: var(--text-secondary);
        }

        .purchase-option-hourly-detail {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            flex-wrap: wrap;
        }

        .purchase-option-hours-input {
            width: 72px;
            padding: 4px 8px;
            border-radius: var(--radius-sm);
            border: 1px solid var(--border);
            background: var(--bg-card);
            color: var(--text-primary);
            font-size: 13px;
            font-weight: 600;
            text-align: right;
        }

        .purchase-option-hours-input:focus {
            outline: 2px solid rgba(79, 142, 247, 0.45);
            outline-offset: 1px;
        }

        .purchase-option-hours-suffix {
            color: var(--text-secondary);
            font-weight: 600;
        }

        .purchase-option-price {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 12px;
            font-size: 13px;
        }

        .purchase-option-price-label {
            color: var(--text-muted);
        }

        .purchase-option-price strong {
            color: var(--accent-blue);
            font-size: 14px;
        }

        .purchase-hourly-panel {
            border: 1px dashed var(--border);
            border-radius: var(--radius-md);
            padding: 12px 14px;
            margin-bottom: 14px;
            background: rgba(79, 142, 247, 0.04);
        }

        .purchase-hourly-field {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            font-size: 14px;
            color: var(--text-secondary);
            margin-bottom: 8px;
        }

        .purchase-hourly-field input {
            width: 120px;
            padding: 8px 10px;
            border-radius: var(--radius-sm);
            border: 1px solid var(--border);
            background: var(--bg-card);
            color: var(--text-primary);
            font-size: 14px;
            font-weight: 600;
            text-align: right;
        }

        .purchase-hourly-total,
        .purchase-modal-total {
            font-size: 14px;
            color: var(--text-secondary);
            margin-bottom: 16px;
        }

        .purchase-hourly-total strong,
        .purchase-modal-total strong {
            color: var(--accent-blue);
            font-size: 16px;
        }

        .my-plan-welcome-icon {
            font-size: 40px;
            margin-bottom: 12px;
        }

        .my-plan-welcome-text {
            font-size: 15px;
            color: var(--text-secondary);
            line-height: 1.6;
            max-width: 420px;
            margin: 0 auto 24px;
        }

        .my-plan-picker-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 12px;
            margin-bottom: 20px;
        }

        @media (max-width: 720px) {
            .my-plan-picker-grid {
                grid-template-columns: 1fr;
            }
        }

        .my-plan-picker-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .my-plan-picker-card.featured {
            border-color: rgba(79, 142, 247, 0.45);
        }

        .my-plan-picker-name {
            font-size: 16px;
            font-weight: 700;
        }

        .my-plan-picker-spec {
            font-size: 12px;
            color: var(--text-muted);
        }

        .my-plan-picker-price {
            font-size: 14px;
            font-weight: 600;
            color: var(--accent-blue);
            margin-bottom: 4px;
        }

        .my-plan-trial-link {
            display: inline-block;
            margin-top: 4px;
            font-size: 14px;
            font-weight: 600;
            color: var(--accent-green);
            text-decoration: none;
        }

        .my-plan-trial-link:hover {
            text-decoration: underline;
        }

        .my-plan-expired {
            text-align: center;
            padding: 32px 24px;
        }

        .my-plan-expired-icon {
            font-size: 40px;
            margin-bottom: 12px;
        }

        .my-plan-expired-text {
            font-size: 15px;
            color: var(--text-secondary);
            line-height: 1.6;
            margin-bottom: 24px;
        }

        .my-plan-expired-text strong {
            color: var(--text-primary);
        }

        .my-plan-grant-banner {
            background: rgba(34, 197, 94, 0.12);
            border: 1px solid rgba(34, 197, 94, 0.35);
            border-radius: var(--radius-lg);
            padding: 16px 18px;
            margin-bottom: 16px;
        }

        .my-plan-grant-title {
            font-size: 14px;
            font-weight: 600;
            color: var(--accent-green);
            line-height: 1.5;
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
        }

        .my-plan-grant-badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .my-plan-grant-badge.starter {
            background: rgba(34, 197, 94, 0.18);
            color: #22C55E;
        }

        .my-plan-grant-badge.pro {
            background: rgba(139, 92, 246, 0.18);
            color: #8B5CF6;
        }

        .my-plan-grant-badge.studio {
            background: rgba(245, 158, 11, 0.18);
            color: #F59E0B;
        }

        .my-plan-grant-note {
            margin-top: 8px;
            font-size: 13px;
            color: var(--text-secondary);
            line-height: 1.5;
        }

        .my-plan-grant-updated {
            margin-top: 8px;
            font-size: 12px;
            font-weight: 600;
            color: var(--accent-blue);
        }

        .my-plan-active-highlight {
            margin-bottom: 20px;
        }

        .my-plan-active-label {
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--accent-green);
            margin-bottom: 8px;
        }

        .my-plan-section {
            margin-bottom: 20px;
        }

        .my-plan-section-title {
            font-size: 14px;
            font-weight: 600;
            color: var(--text-secondary);
            margin-bottom: 10px;
        }

        .my-plan-section-inactive {
            opacity: 0.72;
        }

        .my-plan-inventory-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 18px 20px;
            margin-bottom: 10px;
        }

        .my-plan-inventory-card.is-active {
            border-color: rgba(16, 185, 129, 0.45);
            box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.15);
        }

        .my-plan-inventory-card.is-inactive {
            opacity: 0.65;
        }

        .my-plan-inventory-head {
            display: flex;
            align-items: flex-start;
            gap: 12px;
        }

        .my-plan-inventory-icon {
            font-size: 22px;
            line-height: 1;
        }

        .my-plan-inventory-title {
            font-size: 16px;
            font-weight: 700;
            margin-bottom: 4px;
        }

        .my-plan-inventory-gpu {
            display: block;
            font-size: 12px;
            font-weight: 500;
            color: var(--text-muted);
            margin-top: 2px;
        }

        .my-plan-inventory-meta {
            font-size: 13px;
            color: var(--text-secondary);
        }

        .my-plan-inventory-badge {
            margin-left: auto;
            flex-shrink: 0;
            font-size: 10px;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 999px;
            white-space: nowrap;
        }

        .my-plan-inventory-badge.active {
            background: rgba(16, 185, 129, 0.15);
            color: var(--accent-green);
        }

        .my-plan-inventory-badge.ready {
            background: rgba(79, 142, 247, 0.15);
            color: var(--accent-blue);
        }

        .my-plan-inventory-badge.muted {
            background: var(--bg-secondary);
            color: var(--text-muted);
        }

        .my-plan-inventory-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 12px;
        }

        .my-plan-inventory-tag {
            font-size: 11px;
            padding: 3px 8px;
            border-radius: 999px;
            background: var(--bg-secondary);
            color: var(--text-secondary);
            border: 1px solid var(--border);
        }

        .my-plan-inventory-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 14px;
        }

        .my-plan-buy-more {
            margin-top: 8px;
        }

        .my-plan-toast {
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
        }

        .renew-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.72);
            z-index: 400;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
        }

        .renew-modal {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 24px;
            max-width: 440px;
            width: 100%;
        }

        .renew-modal h3 {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 16px;
        }

        .renew-modal-line {
            font-size: 14px;
            line-height: 1.6;
            color: var(--text-secondary);
            margin-bottom: 10px;
        }

        .renew-modal-line strong {
            color: var(--accent-blue);
        }

        .renew-modal-warn {
            color: var(--accent-orange);
        }

        .renew-modal-muted {
            color: var(--text-muted);
            font-size: 14px;
        }

        .renew-modal-error {
            color: var(--accent-red);
            font-size: 13px;
            margin-bottom: 12px;
        }

        .renew-modal-qr {
            text-align: center;
            padding: 24px;
            margin: 12px 0;
            background: var(--bg-secondary);
            border-radius: var(--radius-md);
            border: 1px dashed var(--border);
        }

        .renew-modal-transfer {
            display: flex;
            flex-direction: column;
            gap: 4px;
            font-size: 13px;
            margin-bottom: 8px;
        }

        .renew-modal-transfer strong {
            color: var(--accent-blue);
            font-size: 15px;
        }

        .renew-modal-copy {
            background: none;
            border: none;
            color: var(--accent-blue);
            font-size: 13px;
            cursor: pointer;
            padding: 0;
            margin-bottom: 12px;
        }

        .renew-modal-hint {
            font-size: 12px;
            color: var(--text-muted);
            margin-bottom: 16px;
        }

        .renew-modal-check {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            font-size: 13px;
            color: var(--text-secondary);
            margin: 12px 0 4px;
            cursor: pointer;
        }

        .renew-modal-check input {
            margin-top: 3px;
        }

        .renew-modal-actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
`;

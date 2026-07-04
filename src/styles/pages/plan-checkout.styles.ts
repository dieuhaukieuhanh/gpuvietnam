export const styles = `
        .plan-checkout-page {
            padding-top: 100px;
            padding-bottom: 80px;
            min-height: 100vh;
        }
        .plan-checkout-back {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            color: var(--text-muted);
            text-decoration: none;
            font-size: 13px;
            margin-bottom: 20px;
        }
        .plan-checkout-back:hover {
            color: var(--accent-blue);
        }
        .plan-checkout-title {
            font-size: 28px;
            margin-bottom: 8px;
            text-align: center;
        }
        .plan-checkout-subtitle {
            text-align: center;
            color: var(--text-secondary);
            font-size: 14px;
            margin-bottom: 28px;
        }
        .plan-checkout-summary {
            max-width: 640px;
            margin: 0 auto 24px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: 24px;
        }
        .plan-checkout-summary h3 {
            font-size: 18px;
            margin-bottom: 14px;
        }
        .plan-checkout-summary-row {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            font-size: 14px;
            color: var(--text-secondary);
            margin-bottom: 8px;
        }
        .plan-checkout-summary-row strong {
            color: var(--text-primary);
        }
        .plan-checkout-total {
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid var(--border);
            font-size: 22px;
            font-weight: 700;
            text-align: center;
            color: var(--accent-blue);
        }
        .plan-checkout-methods {
            max-width: 640px;
            margin: 0 auto 20px;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }
        @media (max-width: 640px) {
            .plan-checkout-methods {
                grid-template-columns: 1fr;
            }
        }
        .plan-checkout-method {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
            padding: 16px;
            border-radius: var(--radius-lg);
            border: 1.5px solid var(--border);
            background: var(--bg-card);
            cursor: pointer;
            text-align: left;
            transition: all 0.2s;
            font-family: inherit;
            color: inherit;
        }
        .plan-checkout-method.active {
            border-color: var(--accent-blue);
            background: rgba(79, 142, 247, 0.08);
        }
        .plan-checkout-method .method-icon {
            font-size: 22px;
        }
        .plan-checkout-method .method-label {
            font-size: 14px;
            font-weight: 700;
        }
        .plan-checkout-method .method-meta {
            font-size: 12px;
            color: var(--text-muted);
        }
        .plan-checkout-panel {
            max-width: 640px;
            margin: 0 auto;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: 24px;
        }
        .plan-checkout-panel .subtitle {
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 16px;
        }
        .plan-checkout-qr {
            width: 180px;
            height: 180px;
            margin: 0 auto 16px;
            background: var(--bg-secondary);
            border: 2px dashed var(--border);
            border-radius: var(--radius-lg);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-muted);
            font-size: 13px;
            text-align: center;
        }
        .plan-checkout-transfer-note {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 14px;
            margin-bottom: 12px;
            font-size: 13px;
        }
        .plan-checkout-transfer-note .highlight {
            display: block;
            margin-top: 6px;
            color: var(--accent-blue);
            font-weight: 600;
            word-break: break-word;
        }
        .plan-checkout-check {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-top: 16px;
            font-size: 13px;
            color: var(--text-secondary);
            cursor: pointer;
        }
        .plan-checkout-warn {
            color: #fbbf24;
            font-size: 13px;
            margin-top: 10px;
        }
        .plan-checkout-error {
            max-width: 640px;
            margin: 0 auto 16px;
            padding: 12px 16px;
            border-radius: var(--radius-md);
            background: rgba(239, 68, 68, 0.12);
            color: #fca5a5;
            font-size: 13px;
        }
        .plan-checkout-hint {
            max-width: 640px;
            margin: 20px auto 0;
            text-align: center;
            font-size: 12.5px;
            color: var(--text-muted);
        }
`;

export const styles = `
        .checkout-action-wrap {
            width: 100%;
        }
        .checkout-action-wrap--compact {
            margin-top: 10px;
        }
        .checkout-action-loading {
            display: block;
            text-align: center;
            font-size: 12px;
            color: var(--text-muted);
            padding: 10px 0;
        }
        .checkout-action-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
            border-radius: var(--radius-md);
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.25s;
            border: none;
            text-decoration: none;
        }
        .checkout-action-btn:disabled {
            opacity: 0.45;
            cursor: not-allowed;
            pointer-events: none;
        }
        .checkout-action-btn--pay {
            padding: 16px 24px;
            font-size: 16px;
            background: #059669;
            color: #fff;
            box-shadow: 0 4px 20px rgba(5, 150, 105, 0.35);
        }
        .checkout-action-btn--pay:hover:not(:disabled) {
            background: #047857;
            transform: translateY(-1px);
            box-shadow: 0 8px 28px rgba(5, 150, 105, 0.45);
        }
        .checkout-action-btn--login {
            padding: 11px 20px;
            font-size: 13.5px;
            background: transparent;
            color: var(--text-primary);
            border: 1.5px solid var(--border);
        }
        .checkout-action-btn--login:hover:not(:disabled) {
            border-color: var(--accent-blue);
            background: rgba(79, 142, 247, 0.06);
        }
        .checkout-action-btn--compact.checkout-action-btn--pay {
            padding: 12px 16px;
            font-size: 14px;
        }
        .checkout-action-btn--compact.checkout-action-btn--login {
            padding: 9px 14px;
            font-size: 12.5px;
        }
        @media (max-width: 640px) {
            .checkout-action-btn--pay {
                padding: 15px 20px;
                font-size: 15px;
            }
        }
`;

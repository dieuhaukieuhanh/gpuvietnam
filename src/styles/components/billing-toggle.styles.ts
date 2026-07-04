export const styles = `
        .billing-toggle-bar {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 16px;
            margin: 0 auto 40px;
            max-width: 960px;
            padding: 0 4px;
        }
        .billing-hours-label-card {
            display: flex;
            align-items: center;
            flex-shrink: 0;
            padding: 12px 18px;
            border-radius: var(--radius-lg);
            border: 1px solid rgba(139, 92, 246, 0.35);
            background: rgba(139, 92, 246, 0.12);
            font-family: 'Space Grotesk', sans-serif;
            font-size: 13.5px;
            font-weight: 700;
            color: var(--accent-purple);
            white-space: nowrap;
        }
        .billing-hours-arrow {
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            font-size: 20px;
            color: var(--accent-purple);
            line-height: 1;
        }
        .billing-toggle-group {
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
        .billing-toggle-btn {
            padding: 10px 20px;
            border-radius: 14px;
            font-size: 13.5px;
            font-weight: 500;
            cursor: pointer;
            border: none;
            background: transparent;
            color: var(--text-muted);
            transition: all 0.25s;
            font-family: inherit;
            white-space: nowrap;
        }
        .billing-toggle-btn:hover {
            color: var(--text-primary);
        }
        .billing-toggle-btn.active {
            background: var(--accent-blue);
            color: white;
        }
        @media (max-width: 768px) {
            .billing-toggle-bar {
                flex-direction: column;
                align-items: stretch;
                gap: 14px;
                margin-bottom: 32px;
                padding: 0 8px;
                width: 100%;
                box-sizing: border-box;
            }
            .billing-hours-arrow {
                display: none;
            }
            .billing-hours-label-card {
                width: 100%;
                justify-content: center;
                white-space: normal;
                text-align: center;
                padding: 11px 14px;
                font-size: 13px;
                box-sizing: border-box;
            }
            .billing-toggle-group {
                display: flex;
                flex-direction: column;
                align-items: stretch;
                width: 100%;
                gap: 8px;
                padding: 8px;
                border-radius: 16px;
                box-sizing: border-box;
            }
            .billing-toggle-btn {
                flex: none;
                width: 100%;
                min-width: 0;
                white-space: normal;
                text-align: left;
                line-height: 1.45;
                padding: 12px 14px;
                font-size: 13px;
            }
        }
        @media (max-width: 480px) {
            .billing-toggle-btn {
                font-size: 12.5px;
                padding: 11px 12px;
            }
        }
`;

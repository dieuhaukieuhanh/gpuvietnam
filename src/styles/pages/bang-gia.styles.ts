export const styles = `
        .pricing-page {
            padding-top: 100px;
            padding-bottom: 80px;
            min-height: 100vh;
        }
        .pricing-page .page-title {
            text-align: center;
            font-size: 34px;
            margin-bottom: 10px;
            font-family: 'Space Grotesk', sans-serif;
        }
        .pricing-page .page-subtitle {
            text-align: center;
            color: var(--text-secondary);
            font-size: 15px;
            margin-bottom: 12px;
            max-width: 640px;
            margin-left: auto;
            margin-right: auto;
        }
        .pricing-page .pricing-hint {
            text-align: center;
            color: var(--text-muted);
            font-size: 13px;
            margin-bottom: 36px;
        }
        .pricing-page-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            max-width: 1100px;
            margin: 0 auto;
            align-items: stretch;
        }
        @media (max-width: 1000px) {
            .pricing-page-grid { grid-template-columns: 1fr; max-width: 480px; }
        }
        .pricing-tier-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: 24px 22px;
            display: flex;
            flex-direction: column;
            position: relative;
        }
        .pricing-tier-card.featured {
            border-color: var(--accent-blue);
            box-shadow: var(--shadow-pro);
        }
        .pricing-tier-badge {
            position: absolute;
            top: -11px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--gradient-hero);
            color: white;
            font-size: 10.5px;
            font-weight: 700;
            padding: 4px 14px;
            border-radius: 20px;
            white-space: nowrap;
        }
        .pricing-tier-name {
            font-size: 26px;
            font-weight: 700;
            margin-bottom: 4px;
            font-family: 'Space Grotesk', sans-serif;
        }
        .pricing-tier-gpu {
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 20px;
        }
        .pricing-tier-row {
            padding: 14px 0;
            border-bottom: 1px solid var(--border);
        }
        .pricing-tier-row:last-of-type {
            border-bottom: none;
            margin-bottom: 16px;
        }
        .pricing-tier-row-label {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            color: var(--text-muted);
            margin-bottom: 6px;
        }
        .pricing-tier-row-price {
            font-size: 28px;
            font-weight: 700;
            color: var(--text-primary);
            display: flex;
            align-items: baseline;
            gap: 4px;
        }
        .pricing-tier-row-price span {
            font-size: 13px;
            font-weight: 400;
            color: var(--text-muted);
        }
        .pricing-tier-row-note {
            font-size: 11.5px;
            color: var(--text-muted);
            margin-top: 4px;
            line-height: 1.45;
        }
        .pricing-tier-buy {
            margin-top: auto;
            width: 100%;
            justify-content: center;
        }
        .pricing-tier-buy + .pricing-tier-buy {
            margin-top: 8px;
        }
`;

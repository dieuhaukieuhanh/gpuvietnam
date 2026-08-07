export const authPageStyles = `
        :root {
            --auth-text: #0f172a;
            --auth-muted: #64748b;
            --auth-border: #e2e8f0;
            --auth-blue: #1d4ed8;
            --auth-blue-hover: #1e40af;
            --auth-error-bg: #fef2f2;
            --auth-error-text: #b91c1c;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        html, body {
            height: 100%;
            overflow: hidden;
        }

        @media (max-height: 500px) {
            html, body { overflow: auto; }
        }

        body {
            font-family: 'Inter', sans-serif;
            color: var(--auth-text);
            background: #f4f6fb;
        }

        h1, h2, h3 {
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 600;
        }

        .auth-page {
            display: flex;
            min-height: 100vh;
            height: 100vh;
            overflow: hidden;
        }

        @media (max-height: 500px) {
            .auth-page {
                height: auto;
                min-height: 100vh;
                overflow: visible;
            }
        }

        .auth-hero {
            flex: 1 1 50%;
            display: flex;
            flex-direction: column;
            position: relative;
            padding: 28px 36px;
            background: linear-gradient(
                145deg,
                rgba(79, 142, 247, 0.22) 0%,
                rgba(139, 92, 246, 0.18) 45%,
                #0a0a0f 100%
            );
            color: #f1f1f5;
            overflow: hidden;
        }

        @media (max-width: 768px) {
            .auth-hero { display: none; }
        }

        .auth-back-link {
            position: absolute;
            top: 24px;
            left: 28px;
            font-size: 13px;
            color: rgba(241, 241, 245, 0.75);
            text-decoration: none;
            transition: color 0.2s;
        }

        .auth-back-link:hover {
            color: #fff;
        }

        .auth-back-link-mobile {
            display: none;
            margin-bottom: 12px;
            font-size: 13px;
            color: var(--auth-muted);
            text-decoration: none;
        }

        .auth-back-link-mobile:hover {
            color: var(--auth-blue);
        }

        @media (max-width: 768px) {
            .auth-back-link-mobile { display: inline-block; }
        }

        .auth-hero-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 48px 24px 32px;
            max-width: 420px;
            margin: 0 auto;
        }

        .auth-logo {
            display: inline-flex;
            align-items: center;
            gap: 12px;
            font-family: 'Space Grotesk', sans-serif;
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 16px;
        }

        .auth-logo-icon {
            width: 48px;
            height: 48px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            background: linear-gradient(135deg, #4f8ef7 0%, #8b5cf6 100%);
            font-size: 24px;
        }

        .auth-tagline {
            font-size: 18px;
            line-height: 1.5;
            color: rgba(241, 241, 245, 0.88);
            margin-bottom: 32px;
        }

        .auth-illustration {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 16px;
            font-size: 40px;
            opacity: 0.9;
        }

        .auth-illustration span:nth-child(2) {
            font-size: 28px;
            opacity: 0.7;
        }

        .auth-main {
            flex: 1 1 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            background: #f4f6fb;
            overflow-y: auto;
        }

        @media (max-width: 768px) {
            .auth-main {
                flex: 1 1 100%;
                width: 100%;
                padding: 20px;
            }
        }

        @media (max-height: 500px) {
            .auth-main { overflow: visible; }
        }

        .auth-form-wrap {
            width: 100%;
            max-width: 420px;
        }

        .auth-form-card {
            background: #fff;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(15, 23, 42, 0.08);
            padding: 24px 22px;
        }

        .auth-form-title {
            font-size: 22px;
            margin-bottom: 6px;
            color: var(--auth-text);
        }

        .auth-form-subtitle {
            font-size: 13px;
            color: var(--auth-muted);
            margin-bottom: 18px;
            line-height: 1.45;
        }

        .auth-field {
            margin-bottom: 12px;
        }

        .auth-field label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            color: #334155;
            margin-bottom: 6px;
        }

        .auth-field input {
            width: 100%;
            height: 44px;
            padding: 0 12px;
            border: 1px solid var(--auth-border);
            border-radius: 8px;
            font-family: inherit;
            font-size: 14px;
            color: var(--auth-text);
            background: #fff;
            transition: border-color 0.2s, box-shadow 0.2s;
        }

        .auth-field input:focus {
            outline: none;
            border-color: #4f8ef7;
            box-shadow: 0 0 0 3px rgba(79, 142, 247, 0.15);
        }

        .auth-field input::placeholder {
            color: #94a3b8;
        }

        .auth-error {
            margin-bottom: 12px;
            padding: 10px 12px;
            border-radius: 8px;
            background: var(--auth-error-bg);
            color: var(--auth-error-text);
            font-size: 13px;
            line-height: 1.4;
        }

        .auth-submit {
            width: 100%;
            height: 48px;
            margin-top: 4px;
            border: none;
            border-radius: 8px;
            background: var(--auth-blue);
            color: #fff;
            font-family: 'Space Grotesk', sans-serif;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
        }

        .auth-submit:hover:not(:disabled) {
            background: var(--auth-blue-hover);
        }

        .auth-submit:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .auth-note {
            margin-top: 10px;
            font-size: 11px;
            line-height: 1.45;
            color: var(--auth-muted);
        }

        .auth-links {
            margin-top: 14px;
            text-align: center;
            font-size: 12px;
            color: var(--auth-muted);
        }

        .auth-links a {
            color: var(--auth-blue);
            text-decoration: none;
            font-weight: 500;
        }

        .auth-links a:hover {
            text-decoration: underline;
        }

        .auth-divider {
            display: flex;
            align-items: center;
            gap: 12px;
            margin: 14px 0;
        }
        .auth-divider::before,
        .auth-divider::after {
            content: '';
            flex: 1;
            height: 1px;
            background: var(--auth-border);
        }
        .auth-divider span {
            font-size: 11px;
            color: var(--auth-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .auth-google-btn {
            width: 100%;
            height: 48px;
            border: 1.5px solid var(--auth-border);
            border-radius: 8px;
            background: #fff;
            color: #3c4043;
            font-family: 'Space Grotesk', sans-serif;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            transition: background 0.2s, box-shadow 0.2s;
        }
        .auth-google-btn:hover:not(:disabled) {
            background: #f8f9fa;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
        .auth-google-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        @media (max-width: 400px) {
            .auth-main { padding: 16px; }
            .auth-form-card { padding: 20px 16px; }
            .auth-field input { height: 40px; font-size: 13px; }
            .auth-submit { height: 44px; font-size: 14px; }
        }
`;

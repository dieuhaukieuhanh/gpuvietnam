import Head from 'next/head';
import PricingPage from '@/components/pricing/PricingPage';
import { styles } from '@/styles/pages/trang-chu.styles';

export default function BangGiaPage() {
  return (
    <>
      <Head>
        <title>GPUVietnam – Bảng giá GPU</title>
        <style
          dangerouslySetInnerHTML={{
            __html:
              styles +
              `
        .pricing-standalone-wrap {
            padding-top: 80px;
        }
        .active-plan-banner {
            margin: 88px 24px 0;
            padding: 0 24px;
        }
        .active-plan-banner-inner {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 18px 22px;
            border-radius: var(--radius-lg);
            background: linear-gradient(180deg, rgba(79, 142, 247, 0.12) 0%, rgba(22, 22, 31, 0.9) 100%);
            border: 1px solid rgba(79, 142, 247, 0.22);
        }
        .active-plan-banner-inner p {
            margin: 0;
            color: var(--text-secondary);
            font-size: 15px;
        }
        .active-plan-banner-inner strong {
            color: var(--text-primary);
        }
        .btn-dashboard-go {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 12px 22px;
            border-radius: var(--radius-md);
            border: none;
            background: #1d4ed8;
            color: #fff;
            font-family: inherit;
            font-size: 14px;
            font-weight: 600;
            text-decoration: none;
            cursor: pointer;
            transition: background 0.2s;
            box-shadow: 0 4px 14px rgba(29, 78, 216, 0.35);
        }
        .btn-dashboard-go:hover {
            background: #1e40af;
        }
        `,
          }}
        />
      </Head>
      <PricingPage />
    </>
  );
}

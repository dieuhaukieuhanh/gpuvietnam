/**
 * POST /api/payment/sepay-qr
 *
 * Generate a VietQR code for bank transfer.
 * Returns qrUrl (preferred) and optional qrDataUrl.
 *
 * Body: { amount: number, transferCode: string, fullName?: string, description?: string }
 */
import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { generateVietQR, parseTransferCode } from '@/lib/sepay';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const { amount, transferCode, description: descriptionOverride } = req.body || {};
    if (!amount || !transferCode) {
      return res.status(400).json({ error: 'Thiếu amount hoặc transferCode.' });
    }

    const code = parseTransferCode(transferCode) || String(transferCode).trim().toUpperCase();
    // Nội dung CK / QR des = chỉ mã 6 ký tự (NVxxxx)
    const fromOverride =
      typeof descriptionOverride === 'string' ? parseTransferCode(descriptionOverride) : null;
    const description = fromOverride || code;

    const result = await generateVietQR({
      amount: Number(amount),
      description,
      asDataUrl: true,
    });

    if (result.error) {
      return res.status(502).json({ error: result.error });
    }

    return res.status(200).json({
      success: true,
      qrUrl: result.qrUrl,
      qrDataUrl: result.qrDataUrl || result.qrUrl,
    });
  } catch (error) {
    console.error('[sepay-qr] Error:', error);
    return res.status(500).json({ error: 'Lỗi tạo mã QR.' });
  }
}

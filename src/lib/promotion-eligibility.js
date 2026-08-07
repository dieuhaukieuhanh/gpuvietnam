/**
 * Kiểm tra quyền nhận khuyến mại.
 *
 * Luật:
 * - Cần phone_verified = true để nhận KM tự động
 * - Admin có thể override (cộng KM thủ công cho bất kỳ user nào)
 *
 * Usage:
 *   import { canClaimPromotion, assertCanClaimPromotion } from '@/lib/promotion-eligibility';
 *
 *   const eligibility = await canClaimPromotion(supabaseAdmin, userId);
 *   if (!eligibility.ok) return res.status(400).json({ error: eligibility.reason });
 */

import { resolveUserRole } from '@/lib/user-role';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {{ allowAdminOverride?: boolean }} options
 * @returns {Promise<{ok: boolean, reason?: string, phoneVerified?: boolean, isAdmin?: boolean}>}
 */
export async function canClaimPromotion(supabaseAdmin, userId, { allowAdminOverride = true } = {}) {
  if (!userId) {
    return { ok: false, reason: 'Không tìm thấy tài khoản.' };
  }

  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('phone_verified, role')
    .eq('id', userId)
    .maybeSingle();

  if (!userRow) {
    return { ok: false, reason: 'Không tìm thấy tài khoản.' };
  }

  // Admin luôn có quyền (kể cả khi cộng KM thủ công cho user khác)
  if (allowAdminOverride && userRow.role === 'admin') {
    return { ok: true, phoneVerified: userRow.phone_verified, isAdmin: true };
  }

  if (!userRow.phone_verified) {
    return {
      ok: false,
      reason: 'Bạn cần xác thực số điện thoại để nhận khuyến mại. Vào Cài đặt → Thêm SĐT.',
      phoneVerified: false,
    };
  }

  return { ok: true, phoneVerified: true };
}

/**
 * Assert version — throw nếu không đủ điều kiện.
 * Dùng trong API endpoints muốn xử lý lỗi riêng.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @returns {Promise<{phoneVerified: boolean, isAdmin: boolean}>}
 */
export async function assertCanClaimPromotion(supabaseAdmin, userId) {
  const result = await canClaimPromotion(supabaseAdmin, userId);
  if (!result.ok) {
    const err = new Error(result.reason);
    err.code = 'PROMOTION_NOT_ELIGIBLE';
    err.status = 400;
    throw err;
  }
  return { phoneVerified: result.phoneVerified, isAdmin: result.isAdmin };
}

/**
 * Admin override: cho phép admin cộng KM cho user chưa verify SĐT.
 * Luôn trả về true — admin toàn quyền quyết định.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} adminUserId — ID của admin đang thực hiện
 * @returns {Promise<boolean>}
 */
export async function isAdminOverride(supabaseAdmin, adminUserId) {
  const role = await resolveUserRole(supabaseAdmin, { userId: adminUserId });
  return role === 'admin';
}

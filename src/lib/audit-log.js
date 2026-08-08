/**
 * Ghi sự kiện xác thực vào public.auth_audit_log.
 * Dùng service_role client để bypass RLS.
 *
 * Usage:
 *   await logAuthEvent(supabaseAdmin, 'login_success', { userId, email, ip, userAgent: req.headers['user-agent'] });
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin — client với service_role key
 * @param {string} event — 'register' | 'login_success' | 'login_fail' | 'otp_verify' | 'otp_send' | 'password_change' | 'signout_all'
 * @param {{ userId?: string, email?: string, phone?: string, ip?: string, userAgent?: string, metadata?: object }} context
 */
export async function logAuthEvent(supabaseAdmin, event, context = {}) {
  try {
    await supabaseAdmin.from('auth_audit_log').insert({
      event,
      user_id: context.userId || null,
      email: context.email || null,
      phone: context.phone || null,
      ip: context.ip || null,
      user_agent: context.userAgent || null,
      metadata: context.metadata || {},
    });
  } catch (err) {
    // Audit log không được block luồng chính
    console.error('[audit-log] Failed to write:', event, err.message);
  }
}

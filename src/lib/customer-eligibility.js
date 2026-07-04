/**
 * KH cũ = đã từng có gói GPU được nạp giờ (không phải trial).
 */
export async function isReturningGpuCustomer(supabaseAdmin, userId) {
  const { count, error } = await supabaseAdmin
    .from('subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_trial', false)
    .gt('hours_total', 0);

  if (error) throw error;
  return (count ?? 0) > 0;
}

export const DEFAULT_USER_SETTINGS = {
  auto_renew_enabled: false,
  auto_renew_method: 'wallet',
  auto_renew_threshold: 10,
  auto_topup_enabled: false,
  auto_topup_threshold: 50_000,
  auto_topup_amount: 200_000,
  auto_topup_warn_enabled: true,
  theme: 'dark',
};

export const AUTO_TOPUP_THRESHOLDS = [30_000, 50_000, 100_000];
export const AUTO_TOPUP_AMOUNTS = [100_000, 200_000, 500_000];

export const DEFAULT_NOTIFICATION_SETTINGS = {
  zalo_enabled: true,
  email_enabled: true,
  event_low_hours: true,
  event_expiring: true,
  event_backup_full: true,
  event_payment_success: true,
};

export async function getOrCreateUserSettings(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (data) return data;

  const { data: created, error: insertError } = await supabaseAdmin
    .from('user_settings')
    .insert({ user_id: userId, ...DEFAULT_USER_SETTINGS })
    .select()
    .single();

  if (insertError) throw insertError;
  return created;
}

export async function getOrCreateNotificationSettings(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('user_notification_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (data) return data;

  const { data: created, error: insertError } = await supabaseAdmin
    .from('user_notification_settings')
    .insert({ user_id: userId, ...DEFAULT_NOTIFICATION_SETTINGS })
    .select()
    .single();

  if (insertError) throw insertError;
  return created;
}

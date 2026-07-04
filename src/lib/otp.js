export function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function getOtpExpiryDate(minutes = 5) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

export async function createOtpRecord(supabaseAdmin, { phone, userId }) {
  const otp = generateOtpCode();
  const expiresAt = getOtpExpiryDate(5);

  await supabaseAdmin
    .from('otp_verifications')
    .update({ verified: true })
    .eq('phone', phone)
    .eq('verified', false);

  const { error } = await supabaseAdmin.from('otp_verifications').insert({
    phone,
    otp,
    user_id: userId,
    expires_at: expiresAt,
    verified: false,
  });

  if (error) throw error;

  return otp;
}

export async function verifyOtpRecord(supabaseAdmin, { phone, otp }) {
  const { data, error } = await supabaseAdmin
    .from('otp_verifications')
    .select('*')
    .eq('phone', phone)
    .eq('verified', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { valid: false, reason: 'not_found' };
  if (new Date(data.expires_at).getTime() < Date.now()) {
    return { valid: false, reason: 'expired' };
  }
  if (data.otp !== otp) return { valid: false, reason: 'invalid' };

  await supabaseAdmin
    .from('otp_verifications')
    .update({ verified: true })
    .eq('id', data.id);

  return { valid: true, userId: data.user_id };
}

export async function createUserSession(supabaseUrl, anonKey, email, password) {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
    },
    body: JSON.stringify({ email, password }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error_description || result.msg || 'Không tạo được phiên đăng nhập');
  }

  return {
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expires_in: result.expires_in,
  };
}

export const MIN_WALLET_DEPOSIT = 50_000;

export const WALLET_DEPOSIT_QUICK_AMOUNTS = [100_000, 200_000, 500_000, 1_000_000];

export const WALLET_DEPOSIT_QUICK_OPTIONS = [
  { amount: 100_000, label: '100k' },
  { amount: 200_000, label: '200k' },
  { amount: 500_000, label: '500k' },
  { amount: 1_000_000, label: '1M' },
];

export const WALLET_BANK_INFO = {
  bankName: 'MB Bank',
  accountNumber: '888666369',
  accountName: 'Lê Thế Cường',
  expectedApprovalMinutes: 5,
};

export const WALLET_DEPOSIT_TYPES = ['deposit'];

export function formatDepositDescription(amount) {
  return `Nạp ${Number(amount).toLocaleString('vi-VN')}đ qua chuyển khoản`;
}

export function buildDepositTransferNote(transactionId) {
  const short = String(transactionId).replace(/-/g, '').slice(0, 2).toUpperCase();
  return `GD${short}`;
}

export function shortTransactionId(transactionId) {
  return String(transactionId).replace(/-/g, '').slice(0, 2).toUpperCase();
}

export function buildDepositPendingResponse(transaction, fullName) {
  const amount = Number(transaction.amount);
  const code = buildDepositTransferNote(transaction.id);
  const displayName = (fullName || 'Khach Hang').trim();
  return {
    transaction: {
      id: transaction.id,
      amount,
      status: transaction.status,
      description: transaction.description,
      created_at: transaction.created_at,
      shortId: shortTransactionId(transaction.id),
      transferCode: code,
    },
    transfer: {
      bankName: WALLET_BANK_INFO.bankName,
      accountNumber: WALLET_BANK_INFO.accountNumber,
      accountName: WALLET_BANK_INFO.accountName,
      amount,
      transferContent: `${displayName} ${code}`,
      transferCode: code,
      expectedMinutes: WALLET_BANK_INFO.expectedApprovalMinutes,
      expectedLabel: '~1–5 phút (tự động)',
    },
  };
}

export function validateWalletDepositAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < MIN_WALLET_DEPOSIT) {
    return {
      ok: false,
      error: `Số tiền nạp tối thiểu ${MIN_WALLET_DEPOSIT.toLocaleString('vi-VN')}đ.`,
    };
  }
  return { ok: true, amount: value };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {number} amount
 */
export async function createWalletDepositRequest(supabaseAdmin, userId, amount) {
  const validation = validateWalletDepositAmount(amount);
  if (!validation.ok) {
    return { error: validation.error };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('wallet_balance, full_name')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) throw profileError;

  const currentBalance = Number(profile?.wallet_balance ?? 0);
  const fullName = profile?.full_name || null;
  const now = new Date().toISOString();

  const { data: tx, error: txError } = await supabaseAdmin
    .from('wallet_transactions')
    .insert({
      user_id: userId,
      type: 'deposit',
      amount: validation.amount,
      bonus_amount: 0,
      balance_after: currentBalance,
      description: formatDepositDescription(validation.amount),
      status: 'pending_deposit',
      updated_at: now,
    })
    .select()
    .single();

  if (txError) throw txError;

  return {
    success: true,
    transaction: tx,
    pending: buildDepositPendingResponse(tx, fullName),
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} transactionId
 */
export async function approveWalletDeposit(supabaseAdmin, transactionId) {
  const { data: tx, error: fetchError } = await supabaseAdmin
    .from('wallet_transactions')
    .select('*')
    .eq('id', transactionId)
    .in('type', ['deposit', 'topup'])
    .eq('status', 'pending_deposit')
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!tx) return { error: 'Không tìm thấy yêu cầu nạp đang chờ duyệt.' };

  const amount = Number(tx.amount);
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('wallet_balance')
    .eq('id', tx.user_id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) return { error: 'Không tìm thấy tài khoản khách hàng.' };

  const newBalance = Number(profile.wallet_balance ?? 0) + amount;
  const now = new Date().toISOString();

  const { error: walletError } = await supabaseAdmin
    .from('users')
    .update({ wallet_balance: newBalance })
    .eq('id', tx.user_id);

  if (walletError) throw walletError;

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('wallet_transactions')
    .update({
      status: 'completed',
      balance_after: newBalance,
      updated_at: now,
    })
    .eq('id', transactionId)
    .select('*')
    .single();

  if (updateError) throw updateError;

  return {
    success: true,
    transaction: updated,
    userId: tx.user_id,
    amount,
    newBalance,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} transactionId
 * @param {string} [reason]
 */
export async function rejectWalletDeposit(supabaseAdmin, transactionId, reason) {
  const { data: tx, error: fetchError } = await supabaseAdmin
    .from('wallet_transactions')
    .select('*')
    .eq('id', transactionId)
    .in('type', ['deposit', 'topup'])
    .eq('status', 'pending_deposit')
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!tx) return { error: 'Không tìm thấy yêu cầu nạp đang chờ duyệt.' };

  const now = new Date().toISOString();
  const note = reason?.trim()
    ? `${tx.description ?? 'Yêu cầu nạp'} — Từ chối: ${reason.trim()}`
    : tx.description;

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('wallet_transactions')
    .update({
      status: 'rejected',
      description: note,
      updated_at: now,
    })
    .eq('id', transactionId)
    .select('*')
    .single();

  if (updateError) throw updateError;

  return {
    success: true,
    transaction: updated,
    userId: tx.user_id,
    amount: Number(tx.amount),
  };
}

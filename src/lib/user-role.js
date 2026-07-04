/**

 * Đọc role từ bảng public.users.

 * @returns {'admin' | 'user'}

 */



function getAdminEmailSet() {

  const raw = process.env.ADMIN_EMAILS ?? 'admin@gpuvietnam.com';

  return new Set(

    raw

      .split(',')

      .map((entry) => entry.trim().toLowerCase())

      .filter(Boolean),

  );

}



export function isConfiguredAdminEmail(email) {

  if (!email) return false;

  return getAdminEmailSet().has(email.trim().toLowerCase());

}



export async function getUserRoleById(supabaseAdmin, userId) {

  if (!userId) return 'user';



  const { data, error } = await supabaseAdmin

    .from('users')

    .select('role')

    .eq('id', userId)

    .maybeSingle();



  if (error) {

    console.error('[user-role] Không đọc được role theo id:', error.message);

    return 'user';

  }



  if (!data) return 'user';

  return data.role === 'admin' ? 'admin' : 'user';

}



export async function getUserRoleByEmail(supabaseAdmin, email) {

  if (!email) return 'user';



  const normalizedEmail = email.trim().toLowerCase();



  const { data, error } = await supabaseAdmin

    .from('users')

    .select('role')

    .eq('email', normalizedEmail);



  if (error) {

    console.error('[user-role] Không đọc được role theo email:', error.message);

    return 'user';

  }



  if (!data?.length) return 'user';

  if (data.some((row) => row.role === 'admin')) return 'admin';

  return 'user';

}



export function isAdminRole(role) {

  return role === 'admin';

}



async function ensureUserProfile(supabaseAdmin, userId, preferredRole = 'user') {

  const { data: existing } = await supabaseAdmin

    .from('users')

    .select('id, role')

    .eq('id', userId)

    .maybeSingle();



  if (existing) return existing.role === 'admin' ? 'admin' : 'user';



  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);

  if (authError || !authData?.user?.email) return preferredRole;



  const email = authData.user.email.trim().toLowerCase();

  let role = preferredRole;



  if (isConfiguredAdminEmail(email)) {

    role = 'admin';

  } else if ((await getUserRoleByEmail(supabaseAdmin, email)) === 'admin') {

    role = 'admin';

  }



  await supabaseAdmin.from('users').upsert(

    {

      id: userId,

      email,

      role,

      phone_verified: false,

    },

    { onConflict: 'id' },

  );



  return role;

}



/**

 * Đồng bộ public.users theo auth.users.id — gán admin nếu email khớp DB hoặc ADMIN_EMAILS.

 */

export async function syncUserRoleOnLogin(supabaseAdmin, { userId, email }) {

  if (!userId || !email) return 'user';



  const normalizedEmail = email.trim().toLowerCase();

  let role = 'user';



  if (isConfiguredAdminEmail(normalizedEmail)) {

    role = 'admin';

  } else if ((await getUserRoleByEmail(supabaseAdmin, normalizedEmail)) === 'admin') {

    role = 'admin';

  } else {

    role = await getUserRoleById(supabaseAdmin, userId);

  }



  await supabaseAdmin.from('users').upsert(

    {

      id: userId,

      email: normalizedEmail,

      role,

      phone_verified: false,

    },

    { onConflict: 'id' },

  );



  return role;

}



/**

 * Xác định role — ưu tiên admin theo email / ADMIN_EMAILS, đồng bộ profile theo auth id.

 */

export async function resolveUserRole(supabaseAdmin, { userId, email } = {}) {

  const emailCandidates = new Set();

  if (email) emailCandidates.add(email.trim().toLowerCase());



  if (userId) {

    const { data: authData } = await supabaseAdmin.auth.admin.getUserById(userId);

    const authEmail = authData?.user?.email?.trim().toLowerCase();

    if (authEmail) emailCandidates.add(authEmail);

  }



  for (const candidate of emailCandidates) {

    if (isConfiguredAdminEmail(candidate)) {

      if (userId) {

        await syncUserRoleOnLogin(supabaseAdmin, { userId, email: candidate });

      }

      return 'admin';

    }

  }



  for (const candidate of emailCandidates) {

    if ((await getUserRoleByEmail(supabaseAdmin, candidate)) === 'admin') {

      if (userId) {

        await syncUserRoleOnLogin(supabaseAdmin, { userId, email: candidate });

      }

      return 'admin';

    }

  }



  if (userId) {

    const roleById = await getUserRoleById(supabaseAdmin, userId);

    if (roleById === 'admin') return 'admin';

    return ensureUserProfile(supabaseAdmin, userId, roleById);

  }



  return 'user';

}


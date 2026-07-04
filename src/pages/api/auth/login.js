import { isValidEmail, normalizePhone } from '@/lib/phone';

import { getUserIdFromAccessToken } from '@/lib/auth-token';

import { createUserSession } from '@/lib/otp';

import { getSupabaseAdmin } from '@/lib/supabase-admin';

import { isAdminRole, resolveUserRole, syncUserRoleOnLogin } from '@/lib/user-role';



export default async function handler(req, res) {

  if (req.method !== 'POST') {

    return res.status(405).json({ error: 'Method not allowed' });

  }



  try {

    const { email, phone, password } = req.body ?? {};

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;



    if (!supabaseUrl || !anonKey) {

      return res.status(500).json({ error: 'Thiếu cấu hình Supabase.' });

    }



    let loginEmail = email?.trim().toLowerCase();

    const loginPassword = password;



    if (!loginPassword) {

      return res.status(400).json({ error: 'Vui lòng nhập mật khẩu.' });

    }



    const supabaseAdmin = getSupabaseAdmin();



    if (phone && !email) {

      const normalizedPhone = normalizePhone(phone);

      const { data: userRow } = await supabaseAdmin

        .from('users')

        .select('email')

        .eq('phone', normalizedPhone)

        .maybeSingle();



      if (!userRow?.email) {

        return res.status(400).json({ error: 'Không tìm thấy tài khoản với SĐT này.' });

      }

      loginEmail = userRow.email.trim().toLowerCase();

    }



    if (!loginEmail || !isValidEmail(loginEmail)) {

      return res.status(400).json({ error: 'Email không hợp lệ.' });

    }



    const session = await createUserSession(supabaseUrl, anonKey, loginEmail, loginPassword);

    const userId = getUserIdFromAccessToken(session.access_token);

    if (userId) {
      await syncUserRoleOnLogin(supabaseAdmin, { userId, email: loginEmail });
    }

    const role = await resolveUserRole(supabaseAdmin, { userId, email: loginEmail });

    const redirect = isAdminRole(role) ? '/admin' : '/dashboard';



    return res.status(200).json({

      session,

      email: loginEmail,

      role,

      redirect,

    });

  } catch (err) {

    return res.status(401).json({ error: 'Email/SĐT hoặc mật khẩu không đúng.' });

  }

}


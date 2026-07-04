import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';

import { isGpuComfyWorkstation } from '@/lib/workstation-env';

import { WORKSTATIONS } from '@/lib/workstations';

import { getSupabaseAdmin } from '@/lib/supabase-admin';



const ACTIVE_STATUSES = ['active', 'provisioning'];



function findWorkstation(envName) {

  return WORKSTATIONS.find((w) => w.name === envName) ?? null;

}



export default async function handler(req, res) {

  if (req.method !== 'POST') {

    return res.status(405).json({ error: 'Method not allowed' });

  }



  try {

    const user = await getAuthUserFromRequest(req);

    if (!user) return unauthorized(res);



    const { envName, envIcon, envDesc } = req.body ?? {};

    if (!envName || typeof envName !== 'string') {

      return res.status(400).json({ error: 'Thiếu tên môi trường.' });

    }



    const workstation = findWorkstation(envName);

    if (!workstation) {

      return res.status(400).json({ error: 'Môi trường không hợp lệ.' });

    }



    if (workstation.id === 6) {

      return res.status(400).json({

        error: 'Môi trường tùy chỉnh cần liên hệ Zalo để được tạo riêng.',

      });

    }



    if (!isGpuComfyWorkstation(workstation)) {

      return res.status(400).json({

        error: `${workstation.name} chưa khả dụng trên hệ thống GPU. Hiện chỉ hỗ trợ 3 môi trường ComfyUI: Character & Art, Commerce & Product, Video AI.`,

      });

    }



    const supabaseAdmin = getSupabaseAdmin();



    const { data: subscription, error: subError } = await supabaseAdmin

      .from('subscriptions')

      .select('id, server_status, env_name')

      .eq('user_id', user.id)

      .in('status', ACTIVE_STATUSES)

      .order('created_at', { ascending: false })

      .limit(1)

      .maybeSingle();



    if (subError) throw subError;

    if (!subscription) {

      return res.status(404).json({ error: 'Không tìm thấy gói active để đổi môi trường.' });

    }



    if (subscription.server_status === 'stopping') {

      return res.status(400).json({

        error: 'Máy đang tắt — vui lòng đợi hoàn tất rồi đổi môi trường.',

      });

    }



    if (subscription.server_status === 'provisioning') {

      return res.status(400).json({

        error: 'Máy đang khởi động — vui lòng đợi hoàn tất rồi đổi môi trường.',

      });

    }



    const icon = typeof envIcon === 'string' && envIcon ? envIcon : workstation.icon;

    const desc =

      typeof envDesc === 'string' && envDesc ? envDesc : workstation.desc;



    const { data: updated, error: updateError } = await supabaseAdmin

      .from('subscriptions')

      .update({

        env_name: workstation.name,

        env_icon: icon,

        env_desc: desc,

      })

      .eq('id', subscription.id)

      .select('id, env_name, env_icon, env_desc')

      .single();



    if (updateError) throw updateError;



    const machineWasRunning = subscription.server_status === 'online';



    const message = machineWasRunning

      ? 'Môi trường sẽ được áp dụng sau khi tắt và bật lại máy.'

      : `Đã chọn ${workstation.name}. Môi trường sẽ áp dụng khi bạn bật máy.`;



    return res.status(200).json({

      success: true,

      message,

      environment: updated,

      requiresRestart: machineWasRunning,

    });

  } catch (err) {

    console.error('[user/change-environment]', err);

    return res.status(500).json({ error: err.message || 'Không đổi được môi trường.' });

  }

}



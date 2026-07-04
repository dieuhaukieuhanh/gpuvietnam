-- GPUVietnam — seed lịch sử phiên GPU mẫu (SCB 3.0)
-- Chạy sau supabase/gpu-sessions.sql + supabase/scb-schema.sql (M2).
-- Gắn vào user đầu tiên trong auth.users; nếu chưa có user thì bỏ qua.
--
-- SCB 3.0: mọi row seed là terminal 'closed' (không còn 'completed' /
-- 'interrupted'). Mỗi row closed có đủ:
--   started_at, ended_at, settlement_status='settled', verified_destroyed_at.
-- duration_seconds được giữ (DEPRECATED) chỉ để tương thích reader cũ;
--   giá trị = EXTRACT(EPOCH FROM (ended_at - started_at)).

do $$
declare
  uid uuid;
  base_ts timestamptz;
begin
  select id into uid from auth.users order by created_at asc limit 1;

  if uid is null then
    raise notice 'Chưa có user — bỏ qua seed gpu_sessions.';
    return;
  end if;

  delete from public.gpu_sessions where user_id = uid;

  base_ts := now() - interval '7 days';

  -- helper: insert một row closed có đủ SCB 3.0 invariants
  -- (template, plan, billing, gpu_config, vram_avg_pct,
  --  started_offset_days, duration_seconds, output_summary)
  insert into public.gpu_sessions (
    user_id, template, plan, billing, gpu_config, status,
    vram_avg_pct, started_at, ended_at, duration_seconds,
    settlement_status, settlement_at, verified_running_at, verified_destroyed_at,
    destroy_reason, output_summary
  )
  values
    (
      uid, 'ComfyUI — Character & Art', 'Pro', 'combo1',
      'Pro · RTX 4090 (24GB)', 'closed', 72,
      base_ts + time '14:30:00',
      base_ts + time '14:30:00' + interval '4 hours 15 minutes 30 seconds',
      15330,
      'settled', base_ts + time '14:30:00' + interval '4 hours 15 minutes 30 seconds',
      base_ts + time '14:30:00' + interval '1 second',
      base_ts + time '14:30:00' + interval '4 hours 15 minutes 31 seconds',
      'user_stop', '125 ảnh · 2.3GB'
    ),
    (
      uid, 'ComfyUI — Commerce & Product', 'Pro', 'combo1',
      'Pro · RTX 4090 (24GB)', 'closed', 58,
      base_ts - interval '1 day' + time '09:15:00',
      base_ts - interval '1 day' + time '09:15:00' + interval '3 hours 15 minutes',
      11700,
      'settled', base_ts - interval '1 day' + time '09:15:00' + interval '3 hours 15 minutes',
      base_ts - interval '1 day' + time '09:15:00' + interval '1 second',
      base_ts - interval '1 day' + time '09:15:00' + interval '3 hours 15 minutes 1 second',
      'user_stop', '80 ảnh · 1.5GB'
    ),
    (
      uid, 'ComfyUI — Video AI', 'Pro', 'hourly',
      'Pro · RTX 4090 (24GB)', 'closed', 91,
      base_ts - interval '2 days' + time '20:00:00',
      base_ts - interval '2 days' + time '20:00:00' + interval '2 hours 30 minutes',
      9000,
      'settled', base_ts - interval '2 days' + time '20:00:00' + interval '2 hours 30 minutes',
      base_ts - interval '2 days' + time '20:00:00' + interval '1 second',
      base_ts - interval '2 days' + time '20:00:00' + interval '2 hours 30 minutes 1 second',
      'user_stop', '3 video · 4.1GB'
    ),
    (
      uid, 'Jupyter — ML/DL Research', 'Starter', 'combo2',
      'Starter · RTX 3090 (24GB)', 'closed', 45,
      base_ts - interval '3 days' + time '08:00:00',
      base_ts - interval '3 days' + time '08:00:00' + interval '3 hours 20 minutes',
      12000,
      'settled', base_ts - interval '3 days' + time '08:00:00' + interval '3 hours 20 minutes',
      base_ts - interval '3 days' + time '08:00:00' + interval '1 second',
      base_ts - interval '3 days' + time '08:00:00' + interval '3 hours 20 minutes 1 second',
      'user_stop', '2 models · 0.8GB'
    ),
    (
      uid, 'ComfyUI — Character & Art', 'Pro', 'combo1',
      'Pro · RTX 4090 (24GB)', 'closed', 68,
      base_ts - interval '4 days' + time '15:00:00',
      base_ts - interval '4 days' + time '15:00:00' + interval '4 hours 45 minutes',
      17100,
      'settled', base_ts - interval '4 days' + time '15:00:00' + interval '4 hours 45 minutes',
      base_ts - interval '4 days' + time '15:00:00' + interval '1 second',
      base_ts - interval '4 days' + time '15:00:00' + interval '4 hours 45 minutes 1 second',
      'user_stop', '200 ảnh · 3.1GB'
    ),
    (
      uid, 'Blender — Render & Design', 'Starter', 'hourly',
      'Starter · RTX 3090 (24GB)', 'closed', 35,
      base_ts - interval '5 days' + time '10:00:00',
      base_ts - interval '5 days' + time '10:00:00' + interval '1 hour 30 minutes',
      5400,
      'settled', base_ts - interval '5 days' + time '10:00:00' + interval '1 hour 30 minutes',
      base_ts - interval '5 days' + time '10:00:00' + interval '1 second',
      base_ts - interval '5 days' + time '10:00:00' + interval '1 hour 30 minutes 1 second',
      'user_stop', '5 cảnh · 0.5GB'
    ),
    (
      uid, 'ComfyUI — Upscale & Restore', 'Pro', 'combo1',
      'Pro · RTX 4090 (24GB)', 'closed', 62,
      base_ts - interval '6 days' + time '16:00:00',
      base_ts - interval '6 days' + time '16:00:00' + interval '2 hours 10 minutes',
      7800,
      'settled', base_ts - interval '6 days' + time '16:00:00' + interval '2 hours 10 minutes',
      base_ts - interval '6 days' + time '16:00:00' + interval '1 second',
      base_ts - interval '6 days' + time '16:00:00' + interval '2 hours 10 minutes 1 second',
      'user_stop', '45 ảnh · 0.9GB'
    );

  raise notice 'Đã seed gpu_sessions (SCB 3.0 closed/settled) cho user %', uid;
end $$;

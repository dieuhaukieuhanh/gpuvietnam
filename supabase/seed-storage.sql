-- Seed dữ liệu bộ nhớ mẫu (chạy sau supabase/storage.sql)
-- Gắn vào user đầu tiên trong auth.users; nếu chưa có user thì bỏ qua.

do $$
declare
  uid uuid;
begin
  select id into uid from auth.users order by created_at asc limit 1;

  if uid is null then
    raise notice 'Chưa có user — bỏ qua seed storage_files.';
    return;
  end if;

  delete from public.storage_files where user_id = uid;

  -- SSD (~8 GB đã dùng)
  insert into public.storage_files (user_id, file_name, file_path, file_size_bytes, storage_type, category, updated_at)
  values
    (uid, 'realvis_xl.safetensors', 'models/realvis_xl.safetensors', 2100000000, 'ssd', 'model', now() - interval '2 days'),
    (uid, 'lora_vietnam.safetensors', 'models/lora_vietnam.safetensors', 150000000, 'ssd', 'model', now() - interval '5 days'),
    (uid, 'sdxl_base.safetensors', 'models/sdxl_base.safetensors', 1950000000, 'ssd', 'model', now() - interval '1 day'),
    (uid, 'render_001.png', 'outputs/render_001.png', 8500000, 'ssd', 'output', now() - interval '3 hours'),
    (uid, 'render_batch.zip', 'outputs/render_batch.zip', 1200000000, 'ssd', 'output', now() - interval '1 day'),
    (uid, 'temp_cache.tmp', 'outputs/temp/temp_cache.tmp', 45000000, 'ssd', 'output', now() - interval '30 minutes'),
    (uid, 'video_export.mp4', 'outputs/video_export.mp4', 900000000, 'ssd', 'output', now() - interval '6 hours'),
    (uid, 'product_photo.json', 'workflows/product_photo.json', 25000, 'ssd', 'workflow', now() - interval '4 days'),
    (uid, 'ghibli_avatar.json', 'workflows/ghibli_avatar.json', 18000, 'ssd', 'workflow', now() - interval '2 days'),
    (uid, 'ComfyUI-Impact-Pack', 'custom_nodes/ComfyUI-Impact-Pack', 980000000, 'ssd', 'custom_node', now() - interval '7 days'),
    (uid, 'ComfyUI-Manager', 'custom_nodes/ComfyUI-Manager', 670000000, 'ssd', 'custom_node', now() - interval '10 days');

  -- Backup (~3 GB đã dùng)
  insert into public.storage_files (user_id, file_name, file_path, file_size_bytes, storage_type, category, created_at, updated_at)
  values
    (uid, 'backup_models_20260315.zip', 'backup/backup_models_20260315.zip', 1250000000, 'backup', 'model', now() - interval '11 days', now() - interval '11 days'),
    (uid, 'outputs_archive_mar.tar', 'backup/outputs_archive_mar.tar', 850000000, 'backup', 'output', now() - interval '8 days', now() - interval '8 days'),
    (uid, 'workflows_pack.json', 'backup/workflows_pack.json', 52000000, 'backup', 'workflow', now() - interval '5 days', now() - interval '5 days'),
    (uid, 'env_snapshot.zip', 'backup/env_snapshot.zip', 880000000, 'backup', 'custom_node', now() - interval '3 days', now() - interval '3 days');

  raise notice 'Đã seed storage_files cho user %', uid;
end $$;

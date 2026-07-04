-- Seed model hệ thống mẫu (chạy sau supabase/models.sql)

delete from public.models where category = 'system';

insert into public.models (name, type, category, user_id, file_url, thumbnail_url, size_mb)
values
  (
    'SDXL 1.0 Base',
    'checkpoint',
    'system',
    null,
    null,
    'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=200&h=200&fit=crop',
    6900
  ),
  (
    'RealVisXL v6',
    'checkpoint',
    'system',
    null,
    null,
    'https://images.unsplash.com/photo-1686191129412-3d58f7035e9d?w=200&h=200&fit=crop',
    2100
  ),
  (
    'Pony Diffusion v6',
    'checkpoint',
    'system',
    null,
    null,
    'https://images.unsplash.com/photo-1694903089439-bf28a8e2be65?w=200&h=200&fit=crop',
    6900
  ),
  (
    'Flux.1 Dev',
    'checkpoint',
    'system',
    null,
    null,
    'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=200&h=200&fit=crop',
    12000
  ),
  (
    'LoRA Người Việt Nam',
    'lora',
    'system',
    null,
    null,
    'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=200&h=200&fit=crop',
    150
  ),
  (
    'LoRA Áo dài Việt Nam',
    'lora',
    'system',
    null,
    null,
    'https://images.unsplash.com/photo-1591488320449-011701bb6704?w=200&h=200&fit=crop',
    200
  );

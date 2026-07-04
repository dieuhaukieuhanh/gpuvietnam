-- Seed workflow hệ thống mẫu (chạy sau supabase/workflows.sql)

delete from public.workflows where is_public = true;

insert into public.workflows (
  name,
  description,
  thumbnail_url,
  file_url,
  running_time_minutes,
  recommended_gpu,
  is_public,
  user_id
)
values
  (
    'Tạo ảnh sản phẩm chuyên nghiệp',
    'Workflow tạo ảnh sản phẩm studio với ánh sáng chuyên nghiệp.',
    'https://placehold.co/400x225/e5e7eb/9ca3af?text=Workflow',
    '{"last_node_id":1,"last_link_id":0,"nodes":[],"links":[],"groups":[],"config":{},"extra":{"workflow":"product-photo"},"version":0.4}',
    5,
    'RTX 3090',
    true,
    null
  ),
  (
    'Đổi background tự động',
    'Tự động tách nền và thay background cho ảnh sản phẩm hoặc chân dung.',
    'https://placehold.co/400x225/e5e7eb/9ca3af?text=Workflow',
    '{"last_node_id":1,"last_link_id":0,"nodes":[],"links":[],"groups":[],"config":{},"extra":{"workflow":"auto-background"},"version":0.4}',
    3,
    'RTX 3090',
    true,
    null
  ),
  (
    'Avatar AI phong cách Ghibli',
    'Biến ảnh chân dung thành avatar phong cách Studio Ghibli.',
    'https://placehold.co/400x225/e5e7eb/9ca3af?text=Workflow',
    '{"last_node_id":1,"last_link_id":0,"nodes":[],"links":[],"groups":[],"config":{},"extra":{"workflow":"ghibli-avatar"},"version":0.4}',
    8,
    'RTX 4090',
    true,
    null
  ),
  (
    'Upscale ảnh cũ không vỡ',
    'Phục hồi và upscale ảnh cũ, giảm nhiễu và tăng độ nét.',
    'https://placehold.co/400x225/e5e7eb/9ca3af?text=Workflow',
    '{"last_node_id":1,"last_link_id":0,"nodes":[],"links":[],"groups":[],"config":{},"extra":{"workflow":"upscale-restore"},"version":0.4}',
    2,
    'RTX 4090',
    true,
    null
  );

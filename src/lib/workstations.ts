export type Workstation = {
  id: number;
  name: string;
  desc: string;
  icon: string;
  tag: string;
  difficulty: string;
  time: string;
  gpu: string;
  color: string;
  badge: string;
  filters: string[];
};

export const WORKSTATIONS: Workstation[] = [
  {
    id: 1,
    name: 'ComfyUI — Character & Art',
    desc: 'Nhân vật nhất quán 100% — IP-Adapter + ControlNet cài sẵn.',
    icon: '👤',
    tag: 'Phổ biến nhất',
    difficulty: 'Trung bình',
    time: '~30s/ảnh',
    gpu: 'RTX 4090',
    color: 'blue',
    badge: 'RTX 4090',
    filters: ['freelancer'],
  },
  {
    id: 2,
    name: 'ComfyUI — Commerce & Product',
    desc: 'Xóa phông tự động, đổi background không méo sản phẩm.',
    icon: '📦',
    tag: 'Cho dân bán hàng',
    difficulty: 'Trung bình',
    time: '~45s/ảnh',
    gpu: 'RTX 4090',
    color: 'green',
    badge: 'RTX 4090',
    filters: ['seller', 'freelancer'],
  },
  {
    id: 3,
    name: 'ComfyUI — Video AI',
    desc: 'Chạy video AI không lo hết VRAM. 24GB VRAM.',
    icon: '🎬',
    tag: 'Xu hướng mới',
    difficulty: 'Cao',
    time: '~5ph/video',
    gpu: 'RTX 4090',
    color: 'purple',
    badge: 'RTX 4090',
    filters: ['video', 'freelancer'],
  },
  {
    id: 4,
    name: 'Jupyter — ML/DL Research',
    desc: 'Môi trường nghiên cứu AI/ML. PyTorch, TensorFlow, CUDA sẵn sàng.',
    icon: '🧪',
    tag: 'Cho sinh viên',
    difficulty: 'Cao',
    time: 'Tùy model',
    gpu: 'RTX 3090',
    color: 'green',
    badge: 'RTX 3090',
    filters: ['student'],
  },
  {
    id: 5,
    name: 'Blender — Render & Design',
    desc: 'Render 3D kiến trúc, thiết kế. Cycles GPU, HDRI pack.',
    icon: '🧊',
    tag: 'Render 3D',
    difficulty: 'Trung bình',
    time: 'Tùy cảnh',
    gpu: 'RTX 3090',
    color: 'blue',
    badge: 'RTX 3090',
    filters: ['render'],
  },
  {
    id: 6,
    name: 'Bạn tự setup tùy chỉnh?',
    desc: 'Cần môi trường riêng? Nhắn Zalo, tạo trong 24h.',
    icon: '🎯',
    tag: 'Tùy chỉnh',
    difficulty: 'Linh hoạt',
    time: 'Theo yêu cầu',
    gpu: 'Tùy chọn',
    color: 'purple',
    badge: 'Tùy chọn',
    filters: ['agency'],
  },
];

export const WORKSTATION_FILTERS = [
  { id: 'all', label: '👥 Tất cả' },
  { id: 'freelancer', label: '🎨 Freelancer AI Art' },
  { id: 'seller', label: '📦 Người bán ảnh' },
  { id: 'video', label: '🎬 Làm video AI' },
  { id: 'student', label: '🧪 Sinh viên AI' },
  { id: 'agency', label: '🏢 Agency/Team' },
  { id: 'render', label: '🧊 Render 3D' },
] as const;

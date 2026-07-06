export function initTrangChu(): void {
  if (typeof window === 'undefined') return;
  const run = new Function(`// ─── Workstation Data ────────────────────────────────────────────
        const workstations = [
            { id: 1, name: 'ComfyUI — Character & Art', desc: 'Nhân vật nhất quán 100% — IP-Adapter + ControlNet cài sẵn.', icon: '👤', tag: 'Phổ biến nhất', difficulty: 'Trung bình', time: '~30s/ảnh', gpu: 'RTX 4090', color: 'blue', badge: 'RTX 4090', filters: ['freelancer'] },
            { id: 2, name: 'ComfyUI — Commerce & Product', desc: 'Xóa phông tự động, đổi background không méo sản phẩm.', icon: '📦', tag: 'Cho dân bán hàng', difficulty: 'Trung bình', time: '~45s/ảnh', gpu: 'RTX 4090', color: 'green', badge: 'RTX 4090', filters: ['seller', 'freelancer'] },
            { id: 3, name: 'ComfyUI — Video AI', desc: 'Chạy video AI không lo hết VRAM. 24GB VRAM.', icon: '🎬', tag: 'Xu hướng mới', difficulty: 'Cao', time: '~5ph/video', gpu: 'RTX 4090', color: 'purple', badge: 'RTX 4090', filters: ['video', 'freelancer'] },
            { id: 4, name: 'Jupyter — ML/DL Research', desc: 'Môi trường nghiên cứu AI/ML. PyTorch, TensorFlow, CUDA sẵn sàng.', icon: '🧪', tag: 'Cho sinh viên', difficulty: 'Cao', time: 'Tùy model', gpu: 'RTX 3090', color: 'green', badge: 'RTX 3090', filters: ['student'] },
            { id: 5, name: 'Blender — Render & Design', desc: 'Render 3D kiến trúc, thiết kế. Cycles GPU, HDRI pack.', icon: '🧊', tag: 'Render 3D', difficulty: 'Trung bình', time: 'Tùy cảnh', gpu: 'RTX 3090', color: 'blue', badge: 'RTX 3090', filters: ['render'] },
            { id: 6, name: 'Bạn tự setup tùy chỉnh?', desc: 'Cần môi trường riêng? Nhắn Zalo, tạo trong 24h.', icon: '🎯', tag: 'Tùy chỉnh', difficulty: 'Linh hoạt', time: 'Theo yêu cầu', gpu: 'Tùy chọn', color: 'purple', badge: 'Tùy chọn', filters: ['agency'] }
        ];

        // Pricing grid is rendered in React (TrangChuPage.tsx)

        function scrollToPlan(planName) {
            scrollToSection('pricing');
            setTimeout(() => {
                const el = document.getElementById('plan-' + planName);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.style.boxShadow = '0 0 0 3px var(--accent-blue)';
                    setTimeout(() => { el.style.boxShadow = ''; }, 2000);
                }
            }, 400);
        }

        function openPackageModal(workstationName) {
            const workstation = workstations.find(w => w.name === workstationName);
            if (workstation) {
                window.location.href = \`/checkout-plan?env=\${encodeURIComponent(workstation.name)}&icon=\${encodeURIComponent(workstation.icon)}&desc=\${encodeURIComponent(workstation.desc)}\`;
            }
        }

        function closeModal() {
            document.getElementById('packageModal').classList.remove('active');
            document.body.style.overflow = '';
        }

        function selectPlanFromModal(planName) {
            closeModal();
            if (planName === 'Starter') startFreeTrial();
            else scrollToPlan(planName);
        }

        function startFreeTrial() { alert('🎁 Đăng ký dùng thử 3 giờ GPU miễn phí!\\n\\n📱 Nhắn Zalo: 0961 862 141\\n📧 Hoặc Email: hello@gpuvietnam.com\\n\\nChúng tôi sẽ tạo máy chủ GPU dùng thử cho bạn ngay lập tức.'); }
        function contactCustomWorkstation() { alert('🎯 Workstation Theo Yêu Cầu\\n\\n📱 Nhắn Zalo: 0961 862 141 mô tả nhu cầu của bạn.\\nChúng tôi sẽ tạo môi trường riêng trong 24h — miễn phí setup.'); }
        function scrollToSection(id) { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth' }); }

        // ─── FAQ ──────────────────────────────────────────────────────────
        const faqs = [
            { q: 'GPUVietnam có phải là công cụ tạo ảnh không?', a: 'Không. Chúng tôi cho thuê máy chủ GPU đã cài sẵn ComfyUI và các công cụ AI Art. Bạn nhận được một máy chủ ảo riêng, toàn quyền kiểm soát — như máy tính của chính mình, nhưng mạnh hơn gấp 10 lần.' },
            { q: 'Tôi không biết dùng ComfyUI thì có dùng được không?', a: 'Được — có video hướng dẫn tiếng Việt từng bước. Kẹt chỗ nào nhắn Zalo là có người trả lời ngay.' },
            { q: 'File của tôi có bị mất khi tắt máy không?', a: 'Gói Pro và Studio có lưu trữ cố định, file không mất. Gói Starter tự động sync về Google Drive khi kết thúc phiên.' },
            { q: 'Đội mình 3 người, dùng chung 1 tài khoản được không?', a: 'Được. Gói Studio hỗ trợ tối đa 5 người dùng cùng lúc, mỗi người có workspace riêng biệt.' },
            { q: 'Dữ liệu của tôi có được bảo mật không?', a: 'Có. Mỗi workspace được tách biệt hoàn toàn.' }
        ];

        function renderFAQ() {
            const grid = document.getElementById('faqGrid');
            if (!grid) return;
            grid.innerHTML = faqs.map(faq => \`<div class="faq-item" onclick="this.classList.toggle('open')"><h4>\${faq.q} <span style="font-size: 18px;">▾</span></h4><p>\${faq.a}</p></div>\`).join('');
        }

        const packageModal = document.getElementById('packageModal');
        if (packageModal) {
          packageModal.addEventListener('click', function(e) { if (e.target === this) closeModal(); });
        }
        document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModal(); });

        // ─── Init ─────────────────────────────────────────────────────────
        renderFAQ();`);
  run();
}

export function initCheckout1(): void {
  if (typeof window === 'undefined') return;
  const run = new Function(`// ─── Lấy thông tin từ URL ────────────────────────────────────────
        const urlParams = new URLSearchParams(window.location.search);
        const envName = urlParams.get('env') || 'ComfyUI — Character & Art';
        const envIcon = urlParams.get('icon') || '👤';
        const envDesc = urlParams.get('desc') || 'Nhân vật nhất quán 100% — IP-Adapter + ControlNet cài sẵn.';
        const preselectedPlan = urlParams.get('plan') || null;

        document.getElementById('envName').textContent = envName;
        document.getElementById('envIcon').textContent = envIcon;
        document.getElementById('envDesc').textContent = envDesc;

        // ─── Plan Data ────────────────────────────────────────────────────
        let currentBilling = 'hourly';
        let activePlan = preselectedPlan;

        const plans = [
            {
                name: 'Starter',
                icon: '✨',
                tagline: 'Khởi đầu hành trình AI Art',
                bestForAudience: [
                    { icon: '🧪', label: 'Sinh viên AI' },
                    { icon: '🎨', label: 'Freelancer mới bắt đầu' }
                ],
                bestFor: ['Sáng tạo ảnh SDXL chất lượng cao', 'Test workflow và thử model mới', 'Tạo avatar, ảnh nghệ thuật cá nhân'],
                notFor: 'Cần tốc độ cao cho video AI hoặc batch ảnh lớn (gói Pro nhanh gấp 2.5 lần)',
                gpuLabel: 'RTX 3090 — 24GB VRAM',
                pricing: {
                    hourly:  { price: '18.000đ', unit: '/giờ',  note: 'Trả theo giờ thực dùng · RTX 3090 24GB' },
                    combo1:  { price: '1.400.000đ', unit: '',   note: '100 giờ + tặng 10 giờ · Hiệu lực 45 ngày' },
                    combo2:  { price: '2.900.000đ', unit: '',   note: '200 giờ + tặng 30 giờ · Hiệu lực 120 ngày' },
                },
                features: [
                    { text: 'RTX 3090 — 24GB VRAM', included: true },
                    { text: 'ComfyUI + SDXL + Flux cài sẵn', included: true },
                    { text: 'Máy chủ ảo riêng — toàn quyền kiểm soát', included: true },
                    { text: 'File tự sync Google Drive khi tắt', included: true },
                    { text: 'Hỗ trợ Zalo khi gặp lỗi', included: true },
                    { text: 'Lưu trữ cố định', included: false },
                    { text: 'Tốc độ cao như RTX 4090', included: false },
                ],
                trust: ['24GB VRAM — đủ sức chạy SDXL, Flux mượt mà', 'Không mất file khi tắt máy — tự sync Drive'],
                cta: 'Chọn Starter',
                featured: false,
                accent: '#4F8EF7'
            },
            {
                name: 'Pro',
                icon: '🚀',
                tagline: 'Freelancer AI Art vận hành hàng ngày',
                bestForAudience: [
                    { icon: '🎨', label: 'Freelancer AI Art' },
                    { icon: '📦', label: 'Người bán ảnh' },
                    { icon: '🎬', label: 'Làm video AI' }
                ],
                bestFor: ['Flux.1 full-quality, SDXL 1024px+, upscale 4x', 'Nhất quán nhân vật (IP-Adapter, ControlNet)', 'AnimateDiff, video ngắn, LoRA inference'],
                gpuLabel: 'RTX 4090 — 24GB VRAM',
                pricing: {
                    hourly:  { price: '30.000đ', unit: '/giờ',  note: 'Trả theo giờ thực dùng · RTX 4090 24GB' },
                    combo1:  { price: '2.400.000đ', unit: '',   note: '100 giờ + tặng 10 giờ · Hiệu lực 45 ngày' },
                    combo2:  { price: '4.900.000đ', unit: '',   note: '200 giờ + tặng 30 giờ · Hiệu lực 120 ngày' },
                },
                features: [
                    { text: 'RTX 4090 — 24GB VRAM, nhanh gấp 2.5 lần — tối ưu cho video & batch ảnh lớn', included: true },
                    { text: 'Toàn bộ tính năng Starter', included: true },
                    { text: 'Lưu trữ mặc định 20GB & tùy chọn mở rộng', included: true },
                    { text: 'Đổi phiên không mất model & workflow', included: true },
                    { text: 'Upscale 4x, SUPIR, workflow phức tạp', included: true },
                    { text: 'Nhất quán nhân vật: IP-Adapter + ControlNet', included: true },
                ],
                trust: ['Nhanh hơn RTX 3090 gấp 2.5 lần — tiết kiệm thời gian, nhận nhiều đơn hơn', '24GB VRAM — Flux.1, upscale 4K không bao giờ báo hết bộ nhớ'],
                cta: 'Chọn Pro',
                featured: true,
                accent: '#4F8EF7'
            },
            {
                name: 'Studio',
                icon: '🏢',
                tagline: 'Cho studio 2–5 người và agency content AI',
                bestForAudience: [
                    { icon: '🏢', label: 'Agency/Team' },
                    { icon: '📦', label: 'Người bán ảnh số lượng lớn' },
                    { icon: '🎬', label: 'Video AI chuyên nghiệp' }
                ],
                bestFor: ['Sáng tạo & sản xuất nội dung số lượng lớn', 'Làm việc nhóm với workspace độc lập', 'Dự án video AI và batch processing nặng'],
                gpuLabel: '2x RTX 4090 — 48GB VRAM (2x24GB riêng biệt)',
                pricing: {
                    hourly:  { price: '50.000đ', unit: '/giờ',  note: 'Trả theo giờ thực dùng · 2x RTX 4090 24GB' },
                    combo1:  { price: '4.500.000đ', unit: '',   note: '100 giờ + tặng 10 giờ · Hiệu lực 45 ngày' },
                    combo2:  { price: '8.800.000đ', unit: '',   note: '200 giờ + tặng 30 giờ · Hiệu lực 120 ngày' },
                },
                features: [
                    { text: '2x RTX 4090 — mỗi người 1 GPU riêng, không chia sẻ', included: true },
                    { text: 'Nhiều người dùng cùng lúc (tối đa 5)', included: true },
                    { text: 'Workspace riêng biệt cho từng thành viên', included: true },
                    { text: 'Lưu trữ mặc định 50GB & tùy chọn mở rộng', included: true },
                    { text: 'Video AI & LoRA training sẵn sàng', included: true },
                    { text: 'Bảo mật dữ liệu', included: true },
                ],
                trust: ['Mỗi người 1 GPU riêng — không đụng VRAM, không chờ đợi', 'Đa nhiệm và chuyên dụng cho đội nhóm'],
                cta: 'Chọn Studio',
                featured: false,
                accent: '#8B5CF6'
            }
        ];

        function renderPricing() {
            const grid = document.getElementById('pricingGrid');
            if (!grid) return;
            grid.innerHTML = plans.map(plan => {
                const p = plan.pricing[currentBilling];
                const audienceHTML = plan.bestForAudience.map(a => 
                    \`<span style="display: inline-flex; align-items: center; gap: 4px; background: rgba(79, 142, 247, 0.08); padding: 3px 10px; border-radius: 14px; font-size: 11px; white-space: nowrap;">\${a.icon} \${a.label}</span>\`
                ).join(' ');

                let cardExtraClass = '';
                if (activePlan) {
                    if (plan.name === activePlan) {
                        cardExtraClass = 'highlighted';
                    } else {
                        cardExtraClass = 'dimmed';
                    }
                }

                return \`
                <div class="plan-card \${plan.featured ? 'featured' : ''} \${cardExtraClass}" id="plan-\${plan.name}">
                    \${plan.featured ? '<div class="badge">⭐ Phổ biến nhất</div>' : ''}
                    <div class="plan-icon">\${plan.icon}</div>
                    <div class="plan-name">\${plan.name}</div>
                    <div class="plan-tagline">\${plan.tagline}</div>
                    <div style="margin-bottom: 20px;">
                        <p class="plan-label">Đối tượng phù hợp</p>
                        <div style="display: flex; flex-wrap: wrap; gap: 6px;">\${audienceHTML}</div>
                    </div>
                    <div class="plan-price-row">
                        <div class="plan-price">\${p.price}<span>\${p.unit}</span></div>
                        <div class="plan-price-note">\${p.note}</div>
                    </div>
                    <div>
                        <p class="plan-label">Phù hợp để làm</p>
                        <ul class="plan-list">\${plan.bestFor.map(item => \`<li><span class="check-icon">✓</span>\${item}</li>\`).join('')}\${plan.notFor ? \`<li class="excluded"><span class="x-icon">✕</span>\${plan.notFor}</li>\` : ''}</ul>
                    </div>
                    <div class="plan-real-output"><strong>GPU:</strong> \${plan.gpuLabel}</div>
                    <div>
                        <p class="plan-label">Tính năng</p>
                        <ul class="plan-list">\${plan.features.map(f => \`<li class="\${f.included ? '' : 'excluded'}"><span class="\${f.included ? 'check-icon' : 'x-icon'}">\${f.included ? '✓' : '✕'}</span>\${f.text}</li>\`).join('')}</ul>
                    </div>
                    <div class="plan-trust">
                        <p class="plan-label" style="margin-bottom: 8px;">Tại sao yên tâm</p>
                        <ul>\${plan.trust.map(t => \`<li>\${t}</li>\`).join('')}</ul>
                    </div>
                    <button class="btn \${plan.featured ? 'btn-primary' : (plan.name === 'Studio' ? 'btn-outline-purple' : 'btn-secondary')} btn-full plan-cta" onclick="selectPlan('\${plan.name}')">
                        \${plan.cta}
                    </button>
                </div>\`;
            }).join('');

            if (activePlan) {
                document.getElementById('selectionIndicator').classList.add('show');
                document.getElementById('selectedPlanLabel').textContent = activePlan;
            }
        }

        function switchBilling(mode) {
            currentBilling = mode;
            ['hourly', 'combo1', 'combo2'].forEach(m => {
                const btn = document.getElementById('toggle' + m.charAt(0).toUpperCase() + m.slice(1));
                if (btn) btn.classList.toggle('active', mode === m);
            });
            renderPricing();
        }

        function selectPlan(planName) {
            const plan = plans.find(p => p.name === planName);
            const p = plan.pricing[currentBilling];
            
            if (activePlan && activePlan !== planName) {
                activePlan = planName;
                renderPricing();
            } else if (!activePlan) {
                activePlan = planName;
                renderPricing();
            }
            
            const billingNames = {
                'hourly': 'Theo giờ',
                'combo1': 'Combo1',
                'combo2': 'Combo2'
            };
            
            document.getElementById('transferContent').textContent = 
                \`09xxxxxxx + Gói \${planName} + \${billingNames[currentBilling]}\`;
            
            document.getElementById('paymentSection').scrollIntoView({ behavior: 'smooth' });
        }

        function copyTransferContent() {
            const content = document.getElementById('transferContent').textContent;
            navigator.clipboard.writeText(content).then(() => {
                const btn = document.querySelector('.copy-btn');
                btn.textContent = '✅ Đã sao chép!';
                setTimeout(() => { btn.textContent = '📋 Sao chép nội dung CK'; }, 2000);
            });
        }

        // ─── Xử lý Checkbox & Nút Thanh toán ──────────────────────────────
        function togglePaymentButton() {
            const checkbox = document.getElementById('paymentCheckbox');
            const button = document.getElementById('paymentButton');
            
            if (checkbox.checked) {
                button.disabled = false;
                button.classList.remove('btn-disabled');
            } else {
                button.disabled = true;
                button.classList.add('btn-disabled');
            }
        }

        function confirmPayment() {
            if (!activePlan) {
                alert('⚠️ Vui lòng chọn một gói trước khi xác nhận thanh toán.');
                return;
            }
            
            const plan = plans.find(p => p.name === activePlan) || plans[1];
            const p = plan.pricing[currentBilling];
            
            const billingNames = {
                'hourly': 'Theo giờ',
                'combo1': 'Combo1 (100h+10h)',
                'combo2': 'Combo2 (200h+30h)'
            };
            
            document.getElementById('confirmPlan').textContent = plan.name;
            document.getElementById('confirmBilling').textContent = billingNames[currentBilling];
            document.getElementById('confirmAmount').textContent = p.price + p.unit;
            document.getElementById('confirmEnv').textContent = envName;
            
            document.getElementById('confirmModal').classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        function closeConfirmModal() {
            document.getElementById('confirmModal').classList.remove('active');
            document.body.style.overflow = '';
        }

        async function submitPayment() {
            const plan = plans.find(p => p.name === activePlan) || plans[1];
            const p = plan.pricing[currentBilling];
            const billingNames = {
                'hourly': 'Theo giờ',
                'combo1': 'Combo1',
                'combo2': 'Combo2'
            };
            
            // Gửi email thông báo cho bạn (dùng Resend — thay API Key thật)
            try {
                await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer re_xxxxxxxx' // Thay bằng API Key Resend của bạn
                    },
                    body: JSON.stringify({
                        from: 'GPUVietnam <notify@gpuvietnam.com>',
                        to: 'your-email@gmail.com',  // Thay bằng email của bạn
                        subject: \`🔔 KH mới: Gói \${plan.name} - \${billingNames[currentBilling]}\`,
                        html: \`
                            <h2>Có khách hàng xác nhận thanh toán!</h2>
                            <p><strong>Gói:</strong> \${plan.name}</p>
                            <p><strong>Cách dùng:</strong> \${billingNames[currentBilling]}</p>
                            <p><strong>Số tiền:</strong> \${p.price}\${p.unit}</p>
                            <p><strong>Môi trường:</strong> \${envName}</p>
                            <p><strong>Thời gian:</strong> \${new Date().toLocaleString('vi-VN')}</p>
                            <p>Vui lòng kiểm tra tài khoản ngân hàng và kích hoạt máy.</p>
                        \`
                    })
                });
            } catch(e) {
                console.log('Email notification failed, but continuing...');
            }
            
            closeConfirmModal();
            
            alert('✅ Cảm ơn bạn!\\n\\nChúng tôi sẽ kiểm tra và kích hoạt máy trong vòng 5-10 phút.\\n\\nNếu cần hỗ trợ gấp, vui lòng nhắn Zalo: 09xxxxxxx');
            
            document.getElementById('paymentCheckbox').checked = false;
            togglePaymentButton();
        }

        // ─── Đóng popup khi bấm ra ngoài ─────────────────────────────────
        document.getElementById('confirmModal').addEventListener('click', function(e) {
            if (e.target === this) closeConfirmModal();
        });
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') closeConfirmModal();
        });

        // ─── Nếu có preselected plan, tự động chọn ─────────────────────
        if (preselectedPlan) {
            setTimeout(() => {
                selectPlan(preselectedPlan);
            }, 300);
        }

        renderPricing();`);
  run();
}

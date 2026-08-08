/**
 * @deprecated Dead legacy DOM checkout. Live flow: `Checkout1Page` + `useGpuPricingConfig`
 * (`/api/gpu-pricing` ← Admin `gpu_pricing_config`). Do not treat prices here as SoT.
 */
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

        // ─── Plan Data (stale mirror of gpu-pricing-defaults — not live SoT) ─
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
                notFor: 'Cần tốc độ cao cho video AI hoặc batch ảnh lớn — Pro nhanh hơn rõ rệt so với RTX 3090',
                gpuLabel: 'RTX 3090 — 24GB VRAM',
                pricing: {
                    hourly:  { price: '9.900đ', unit: '/giờ',  note: 'Trả theo giờ thực dùng · RTX 3090 24GB' },
                    combo1:  { price: '990.000đ', unit: '',   note: '100 giờ + tặng 10 giờ · Hiệu lực 120 ngày' },
                    combo2:  { price: '1.980.000đ', unit: '',   note: '200 giờ + tặng 30 giờ · Hiệu lực 180 ngày' },
                },
                features: [
                    { text: 'RTX 3090 — 24GB VRAM', included: true },
                    { text: 'ComfyUI + SDXL + Flux cài sẵn', included: true },
                    { text: 'Máy chủ ảo riêng — toàn quyền kiểm soát', included: true },
                    { text: 'SSD 50GB · Auto Backup 100GB (Outputs mỗi 10 phút • Workflows mỗi 20 phút)', included: true },
                    { text: 'Hỗ trợ Zalo khi gặp lỗi', included: true },
                    { text: 'Tốc độ cao như RTX 4090', included: false },
                ],
                trust: ['24GB VRAM — đủ sức chạy SDXL, Flux mượt mà', 'Không mất file — Auto Backup 100GB khi chạy phiên'],
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
                    hourly:  { price: '20.000đ', unit: '/giờ',  note: 'Trả theo giờ thực dùng · RTX 4090 24GB' },
                    combo1:  { price: '2.000.000đ', unit: '',   note: '100 giờ + tặng 10 giờ · Hiệu lực 120 ngày' },
                    combo2:  { price: '4.000.000đ', unit: '',   note: '200 giờ + tặng 30 giờ · Hiệu lực 180 ngày' },
                },
                features: [
                    { text: 'RTX 4090 — 24GB VRAM, nhanh hơn RTX 3090 rõ rệt — tối ưu cho video & batch ảnh lớn', included: true },
                    { text: 'Toàn bộ tính năng Starter', included: true },
                    { text: 'SSD 80GB · Auto Backup 150GB (Outputs mỗi 3 phút • Workflows mỗi 10 phút)', included: true },
                    { text: 'Đổi phiên không mất model & workflow', included: true },
                    { text: 'Upscale 4x, SUPIR, workflow phức tạp', included: true },
                    { text: 'Nhất quán nhân vật: IP-Adapter + ControlNet', included: true },
                ],
                trust: ['Nhanh hơn RTX 3090 rõ rệt — tiết kiệm thời gian, nhận nhiều đơn hơn', '24GB VRAM — Flux.1 và upscale 4K với headroom tốt hơn Starter'],
                cta: 'Chọn Pro',
                featured: true,
                accent: '#4F8EF7'
            },
            {
                name: 'Studio',
                icon: '🏢',
                tagline: 'RTX 5090 cho production AI nặng',
                bestForAudience: [
                    { icon: '🎬', label: 'Video AI dài / nặng' },
                    { icon: '🧠', label: 'Train LoRA / fine-tune' },
                    { icon: '📦', label: 'Batch lớn, deadline gấp' }
                ],
                bestFor: ['Video dài, resolution cao, pipeline nhiều bước', 'Train LoRA / fine-tune khi Pro bắt đầu chậm hoặc chật VRAM', 'Batch lớn — hàng trăm ảnh với tốc độ vượt RTX 4090'],
                notFor: 'Chỉ cần ảnh đơn / workflow hàng ngày — Pro đủ và tiết kiệm hơn',
                gpuLabel: 'RTX 5090 — 32GB VRAM',
                pricing: {
                    hourly:  { price: '35.000đ', unit: '/giờ',  note: 'Trả theo giờ thực dùng · RTX 5090 32GB' },
                    combo1:  { price: '3.500.000đ', unit: '',   note: '100 giờ + tặng 10 giờ · Hiệu lực 120 ngày' },
                    combo2:  { price: '7.000.000đ', unit: '',   note: '200 giờ + tặng 30 giờ · Hiệu lực 180 ngày' },
                },
                features: [
                    { text: 'RTX 5090 — 32GB VRAM, nhanh hơn Pro (RTX 4090)', included: true },
                    { text: 'SSD 120GB · Auto Backup 200GB (Outputs mỗi 1 phút • Workflows mỗi 5 phút)', included: true },
                    { text: 'Workflow nặng: video dài, multi-model, train LoRA', included: true },
                ],
                trust: ['32GB VRAM liền — dư sức cho video dài, train LoRA và batch lớn', 'Nhanh hơn Pro rõ rệt — bước tiếp khi 4090 bắt đầu chậm / chật'],
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
            
            // Gửi email thông báo cho admin qua API route server-side
            try {
                await fetch('/api/notify/payment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        plan: plan.name,
                        billing: billingNames[currentBilling],
                        email: 'khach@example.com',
                        phone: '09xxxxxxxx',
                        env: envName,
                        price: \`\${p.price}\${p.unit}\`,
                    }),
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

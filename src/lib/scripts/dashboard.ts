export function initDashboard(): void {
  if (typeof window === 'undefined') return;
  const run = new Function(`// ─── Tab Switching ──────────────────────────────────────────────
        function switchTab(tabName) {
            // Ẩn tất cả tab content
            document.querySelectorAll('.tab-content').forEach(tab => {
                tab.style.display = 'none';
            });
            // Hiện tab được chọn
            const target = document.getElementById('tab-' + tabName);
            if (target) {
                target.style.display = 'block';
            }
            // Cập nhật active state trên sidebar
            document.querySelectorAll('.sidebar-item').forEach(item => {
                item.classList.remove('active');
                if (item.dataset.tab === tabName) {
                    item.classList.add('active');
                }
            });
            // Nếu chọn dashboard, chạy lại hiệu ứng
            if (tabName === 'dashboard') {
                updatePerfValues();
            }
        }

        // Gán sự kiện click cho sidebar items
        document.querySelectorAll('.sidebar-item[data-tab]').forEach(item => {
            item.addEventListener('click', function(e) {
                e.preventDefault();
                switchTab(this.dataset.tab);
            });
        });

        // ─── Trạng thái máy chủ ──────────────────────────────────────────
        let serverState = 'online';

        function renderServerCard() {
            const badge = document.getElementById('statusBadge');
            const content = document.getElementById('serverContent');

            switch(serverState) {
                case 'offline':
                    badge.className = 'status-badge offline';
                    badge.innerHTML = '<span class="status-dot"></span> Đang tắt';
                    content.innerHTML = \`
                        <div id="stateOffline">
                            <div style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">ComfyUI — Character & Art</div>
                            <div style="text-align: center; font-size: 48px; padding: 8px 0;">🔴</div>
                            <div style="text-align: center; font-size: 14px; color: var(--text-muted); margin-bottom: 4px;">Máy đang tắt</div>
                            <div class="btn-group-server">
                                <button class="btn btn-success btn-lg" onclick="powerOn()">🔑 BẬT MÁY</button>
                            </div>
                            <div style="text-align: center; font-size: 10px; color: var(--text-muted); margin-top: 10px;">
                                ⏱️ Khởi động trong ~2-3 phút<br>
                                💡 Mẹo: Tắt máy khi không dùng để tiết kiệm giờ
                            </div>
                        </div>
                    \`;
                    break;

                case 'starting':
                    badge.className = 'status-badge starting';
                    badge.innerHTML = '<span class="status-dot"></span> Đang khởi động...';
                    content.innerHTML = \`
                        <div id="stateStarting">
                            <div style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">ComfyUI — Character & Art</div>
                            <div style="width: 80%; margin: 12px auto;">
                                <div class="progress-bar"><div class="progress-fill orange" style="width: 65%;"></div></div>
                            </div>
                            <div style="text-align: center; font-size: 13px; color: var(--accent-orange); font-weight: 500;">Đã khởi động: 1:30 / ~2-3 phút (65%)</div>
                            <div class="btn-group-server">
                                <button class="btn btn-secondary" style="opacity: 0.5; cursor: not-allowed;" disabled>⏳ Đang khởi động...</button>
                            </div>
                        </div>
                    \`;
                    setTimeout(() => {
                        serverState = 'online';
                        renderServerCard();
                    }, 3000);
                    break;

                case 'online':
                    badge.className = 'status-badge online';
                    badge.innerHTML = '<span class="status-dot"></span> Đang chạy';
                    content.innerHTML = \`
                        <div id="stateOnline">
                            <div style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">ComfyUI — Character & Art</div>
                            <div class="timer-display" id="timerDisplay">03:12:06</div>
                            <div class="timer-label" id="timerLabel">Đã hoạt động từ 14:30 — đang đếm...</div>
                            <div class="btn-group-server">
                                <button class="btn-launch">🚀 MỞ COMFYUI</button>
                                <button class="btn btn-secondary" style="padding: 0 18px;">🔄 Đổi môi trường</button>
                                <button class="btn-power-square" onclick="openShutdownModal()" title="Tắt máy">
                                    <span class="power-icon">⏻</span> TẮT
                                </button>
                            </div>
                            <div style="text-align: center; font-size: 10px; color: var(--text-muted); margin-top: 10px;">
                                ⚠️ Tự động tắt sau 30 phút không hoạt động
                            </div>
                        </div>
                    \`;
                    break;
            }
        }

        function powerOn() {
            serverState = 'starting';
            renderServerCard();
        }

        // ─── Alert ──────────────────────────────────────────────────────
        function closeAlert(id) {
            const alert = document.getElementById(id);
            if (alert) {
                alert.style.display = 'none';
            }
        }

        // ─── Modal ──────────────────────────────────────────────────────
        function openShutdownModal() {
            document.getElementById('shutdownModal').classList.add('active');
            document.body.style.overflow = 'hidden';
        }
        function closeShutdownModal() {
            document.getElementById('shutdownModal').classList.remove('active');
            document.body.style.overflow = '';
        }
        function confirmShutdown() {
            serverState = 'offline';
            renderServerCard();
            closeShutdownModal();
        }

        function openTransferModal() {
            document.getElementById('transferModal').classList.add('active');
            document.body.style.overflow = 'hidden';
        }
        function closeTransferModal() {
            document.getElementById('transferModal').classList.remove('active');
            document.body.style.overflow = '';
        }
        function startTransfer() {
            alert('🔄 Đang chuyển dữ liệu...\\n\\nTừ: SSD → Backup\\nDung lượng: 2.3GB\\n\\nQuá trình sẽ mất khoảng 1-2 phút.');
            closeTransferModal();
        }

        // ─── Performance Monitoring ──────────────────────────────────────
        function updatePerfValues() {
            const vram = 75 + Math.floor(Math.random() * 22);
            const gpu = 60 + Math.floor(Math.random() * 36);
            
            const vramEl = document.getElementById('vramValue');
            const gpuEl = document.getElementById('gpuValue');
            const vramBox = document.getElementById('perfVram');
            const gpuBox = document.getElementById('perfGpu');
            
            if (vramEl) {
                vramEl.textContent = vram + '%';
                vramEl.style.color = vram >= 90 ? 'var(--accent-red)' : 
                                      vram >= 70 ? 'var(--accent-orange)' : 'var(--accent-green)';
            }
            if (vramBox) {
                if (vram >= 90) {
                    vramBox.classList.add('alert-flash');
                } else {
                    vramBox.classList.remove('alert-flash');
                }
            }
            
            if (gpuEl) {
                gpuEl.textContent = gpu + '%';
                gpuEl.style.color = gpu >= 90 ? 'var(--accent-red)' : 
                                     gpu >= 70 ? 'var(--accent-orange)' : 'var(--accent-blue)';
            }
            if (gpuBox) {
                if (gpu >= 90) {
                    gpuBox.classList.add('alert-flash');
                } else {
                    gpuBox.classList.remove('alert-flash');
                }
            }
        }

        setInterval(updatePerfValues, 3000);
        updatePerfValues();

        // ─── Modal Close Events ─────────────────────────────────────────
        document.getElementById('transferModal').addEventListener('click', function(e) {
            if (e.target === this) closeTransferModal();
        });
        document.getElementById('shutdownModal').addEventListener('click', function(e) {
            if (e.target === this) closeShutdownModal();
        });
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeTransferModal();
                closeShutdownModal();
            }
        });`);
  run();
}

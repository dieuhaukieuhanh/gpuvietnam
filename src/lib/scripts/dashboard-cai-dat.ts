export function initDashboardCaiDat(): void {
  if (typeof window === 'undefined') return;
  const run = new Function(`let selectedAmount = 1000000;
        let selectedBonus = 30000;

        function openWalletModal() {
            document.getElementById('walletModal').classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        function closeWalletModal() {
            document.getElementById('walletModal').classList.remove('active');
            document.body.style.overflow = '';
        }

        function selectOption(el, amount, bonus) {
            document.querySelectorAll('#walletModal .option-group').forEach(opt => {
                opt.classList.remove('selected');
            });
            el.classList.add('selected');
            selectedAmount = amount;
            selectedBonus = bonus;
        }

        function confirmTopUp() {
            const total = selectedAmount + selectedBonus;
            alert('✅ Nạp tiền thành công!\\n\\nSố tiền nạp: ' + selectedAmount.toLocaleString('vi-VN') + 'đ\\nTiền tặng: ' + selectedBonus.toLocaleString('vi-VN') + 'đ\\nTổng cộng: ' + total.toLocaleString('vi-VN') + 'đ\\n\\nSố dư Ví mới: ' + (850000 + total).toLocaleString('vi-VN') + 'đ');
            closeWalletModal();
        }

        function confirmDeleteData() {
            if (confirm('⚠️ Bạn có chắc chắn muốn xóa TOÀN BỘ dữ liệu trên Backup?\\n\\nHành động này KHÔNG THỂ HOÀN TÁC.\\nDữ liệu trên SSD và tài khoản của bạn không bị ảnh hưởng.\\n\\nNhấn OK để xác nhận.')) {
                alert('✅ Dữ liệu trên Backup đã được xóa.');
            }
        }

        // Đóng modal khi bấm ra ngoài
        document.getElementById('walletModal').addEventListener('click', function(e) {
            if (e.target === this) closeWalletModal();
        });

        // Đóng modal khi bấm Escape
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeWalletModal();
            }
        });`);
  run();
}

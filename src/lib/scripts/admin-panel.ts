export function initAdminPanel(): void {
  if (typeof window === 'undefined') return;
  const run = new Function(`// ─── CLOCK ────────────────────────────────────────────────
    function updateClock() {
      const now = new Date();
      document.getElementById('clock').textContent = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    updateClock();
    setInterval(updateClock, 1000);

    // ─── NAVIGATION ──────────────────────────────────────────
    const tabs = {
      overview: renderOverview,
      customers: renderCustomers,
      sessions: renderSessions,
      billing: renderBilling,
      topup: renderTopup,
      planManagement: renderPlanManagement,
      storageManagement: renderStorageManagement,
      infra: renderInfra,
      assets: renderAssets,
      audit: renderAudit,
      config: renderConfig,
      notifications: renderNotifications,
      coupons: renderCoupons,
      finance: renderFinance
    };

    const titles = {
      overview: 'Tổng quan',
      customers: 'Khách hàng',
      sessions: 'Phiên GPU',
      billing: 'Doanh thu',
      topup: 'Nạp giờ & Duyệt yêu cầu',
      planManagement: 'Duyệt gói & Đổi gói',
      storageManagement: 'Duyệt mở rộng bộ nhớ',
      infra: 'Hạ tầng GPU',
      assets: 'Tài nguyên nguyên mềm',
      audit: 'Nhật ký hoạt động',
      config: 'Cấu hình hệ thống',
      notifications: 'Trung tâm thông báo',
      coupons: 'Mã giảm giá',
      finance: 'Báo cáo tài chính'
    };

    function navigate(tabId) {
      document.querySelectorAll('.sidebar-nav button').forEach(btn => btn.classList.remove('active'));
      document.querySelector(\`.sidebar-nav button[data-tab="\${tabId}"]\`)?.classList.add('active');
      document.getElementById('pageTitle').textContent = titles[tabId] || tabId;
      const content = document.getElementById('mainContent');
      if (tabs[tabId]) content.innerHTML = tabs[tabId]();
      else content.innerHTML = \`<p class="text-muted">Đang phát triển...</p>\`;
    }

    document.querySelectorAll('.sidebar-nav button').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (tab) navigate(tab);
      });
    });

    // ─── RENDER FUNCTIONS ──────────────────────────────────

    function renderOverview() {
      return \`
        <div class="grid-4">
          <div class="card"><div class="stat-label">Tổng khách</div><div class="stat-value text-blue">237</div><div class="stat-sub">+12 tháng này</div></div>
          <div class="card"><div class="stat-label">Đang sử dụng</div><div class="stat-value text-green">48</div><div class="stat-sub">GPU đang chạy</div></div>
          <div class="card"><div class="stat-label">Còn giờ</div><div class="stat-value text-amber">132</div><div class="stat-sub">chưa hết hạn</div></div>
          <div class="card"><div class="stat-label">Doanh thu tháng</div><div class="stat-value text-purple">568tr</div><div class="stat-sub">+8% so với tháng trước</div></div>
        </div>
        <div class="card"><p class="text-muted">📌 Chào mừng bạn quay lại! Hôm nay có 4 phiên GPU đang chạy, 3 khách sắp hết giờ cần gia hạn, 3 yêu cầu nạp giờ đang chờ duyệt.</p></div>
      \`;
    }

    function renderCustomers() {
      return \`<div class="card"><p class="text-muted">📋 Quản lý khách hàng chi tiết (đang phát triển)</p></div>\`;
    }

    function renderSessions() {
      return \`<div class="card"><p class="text-muted">⚡ Phiên GPU đang chạy và lịch sử (đang phát triển)</p></div>\`;
    }

    function renderBilling() {
      return \`<div class="card"><p class="text-muted">💰 Lịch sử giao dịch và thống kê doanh thu (đang phát triển)</p></div>\`;
    }

    // ---------- NẠP GIỜ (HOÀN CHỈNH) ----------
    function renderTopup() {
      const pendingRequests = [
        { id: 1, customer: 'Nguyễn Thành', phone: '0912xxxxxx', plan: 'Pro', billing: 'Combo1', hours: 110, amount: '2.400.000đ', note: 'CK 16/06 14:30', time: '16/06/2026 14:30' },
        { id: 2, customer: 'Lê Hương', phone: '0988xxxxxx', plan: 'Starter', billing: 'Theo giờ', hours: 10, amount: '180.000đ', note: 'CK 16/06 15:00', time: '16/06/2026 15:00' },
        { id: 3, customer: 'Hoàng Tuấn', phone: '0977xxxxxx', plan: 'Pro', billing: 'Combo2', hours: 230, amount: '4.900.000đ', note: 'CK 16/06 16:45', time: '16/06/2026 16:45' },
      ];

      const historyLogs = [
        { id: 1, customer: 'Trần Văn A', plan: 'Pro', hours: 110, amount: '2.400.000đ', admin: 'Admin', time: '15/06/2026 10:30', status: 'approved' },
        { id: 2, customer: 'Phạm Thị B', plan: 'Starter', hours: 230, amount: '2.900.000đ', admin: 'Admin', time: '15/06/2026 11:00', status: 'approved' },
        { id: 3, customer: 'Ngô Văn C', plan: 'Pro', hours: 10, amount: '300.000đ', admin: 'Support', time: '14/06/2026 09:15', status: 'rejected' },
      ];

      let pendingRows = pendingRequests.map(r => \`
        <tr>
          <td class="fw-600">#\${r.id}</td>
          <td><strong>\${r.customer}</strong><br><span class="text-dim">\${r.phone}</span></td>
          <td><span class="badge badge-blue">\${r.plan}</span></td>
          <td>\${r.billing}</td>
          <td class="fw-600">\${r.hours}h</td>
          <td class="fw-600">\${r.amount}</td>
          <td class="text-dim">\${r.note}</td>
          <td class="text-dim">\${r.time}</td>
          <td>
            <button class="btn btn-success btn-sm" onclick="approveTopup(\${r.id})" style="margin-right:4px;">✅ Duyệt</button>
            <button class="btn btn-danger btn-sm" onclick="rejectTopup(\${r.id})">❌ Từ chối</button>
          </td>
        </tr>
      \`).join('');

      let historyRows = historyLogs.map(h => \`
        <tr>
          <td class="fw-600">#\${h.id}</td>
          <td>\${h.customer}</td>
          <td><span class="badge badge-blue">\${h.plan}</span></td>
          <td class="fw-600">\${h.hours}h</td>
          <td>\${h.amount}</td>
          <td><span class="badge badge-gray">\${h.admin}</span></td>
          <td class="text-dim">\${h.time}</td>
          <td>\${h.status === 'approved' ? '<span class="badge badge-green">Đã duyệt</span>' : '<span class="badge badge-red">Từ chối</span>'}</td>
        </tr>
      \`).join('');

      return \`
        <div class="card-no-pad">
          <div style="padding:12px 20px; border-bottom:1px solid #1E1E2E; display:flex; justify-content:space-between; align-items:center;">
            <span class="fw-600 text-muted">📥 Yêu cầu nạp giờ đang chờ duyệt <span class="badge badge-amber" style="margin-left:8px;">\${pendingRequests.length} yêu cầu</span></span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Khách hàng</th><th>Gói</th><th>Loại</th><th>Giờ</th><th>Số tiền</th><th>Ghi chú</th><th>Thời gian</th><th>Hành động</th></tr></thead>
              <tbody>\${pendingRows}</tbody>
            </table>
          </div>
          \${pendingRequests.length === 0 ? '<div style="text-align:center; padding:24px; color:#8888A0;">✅ Không có yêu cầu nào đang chờ</div>' : ''}
        </div>

        <div class="card">
          <div class="stat-label" style="margin-bottom:12px;">⚡ Nạp giờ nhanh (không cần chờ duyệt)</div>
          <div class="grid-2">
            <div class="form-group">
              <label>Số điện thoại / Email KH</label>
              <input class="form-control" id="quickTopupPhone" placeholder="Nhập SĐT hoặc Email..." />
            </div>
            <div class="form-group">
              <label>Gói</label>
              <select class="form-control" id="quickTopupPlan">
                <option value="Starter">Starter (RTX 3090)</option>
                <option value="Pro" selected>Pro (RTX 4090)</option>
                <option value="Studio">Studio (RTX 5090)</option>
              </select>
            </div>
            <div class="form-group">
              <label>Hình thức</label>
              <select class="form-control" id="quickTopupBilling">
                <option value="hourly">Theo giờ</option>
                <option value="combo1" selected>Combo1 (100h+10h · 120 ngày)</option>
                <option value="combo2">Combo2 (200h+30h · 180 ngày)</option>
              </select>
            </div>
            <div class="form-group">
              <label>Số giờ (nếu Theo giờ)</label>
              <input class="form-control" type="number" id="quickTopupHours" value="10" />
            </div>
          </div>
          <div style="margin-top:8px; display:flex; gap:8px;">
            <button class="btn btn-success" onclick="quickTopup()">✅ Nạp ngay</button>
            <button class="btn" onclick="resetQuickTopup()">🔄 Reset</button>
          </div>
        </div>

        <div class="card-no-pad">
          <div style="padding:12px 20px; border-bottom:1px solid #1E1E2E;">
            <span class="fw-600 text-muted">📋 Lịch sử nạp giờ gần đây</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Khách hàng</th><th>Gói</th><th>Giờ</th><th>Số tiền</th><th>Người duyệt</th><th>Thời gian</th><th>Trạng thái</th></tr></thead>
              <tbody>\${historyRows}</tbody>
            </table>
          </div>
        </div>
      \`;
    }

    // ---------- DUYỆT GÓI & ĐỔI GÓI ----------
    function renderPlanManagement() {
      const pendingActivations = [
        { id: 1, customer: 'Nguyễn Thành', phone: '0912xxxxxx', plan: 'Pro', billing: 'Combo1', amount: '2.400.000đ', time: '16/06/2026 14:30', status: 'pending' },
        { id: 2, customer: 'Lê Hương', phone: '0988xxxxxx', plan: 'Starter', billing: 'Theo giờ', amount: '180.000đ', time: '16/06/2026 15:00', status: 'pending' },
      ];

      const planChangeRequests = [
        { id: 1, customer: 'Trần Văn A', currentPlan: 'Starter', newPlan: 'Pro', remainingHours: 80, totalHours: 110, convertedHours: 47, extraAmount: '1.382.000đ', time: '16/06/2026 11:00' },
        { id: 2, customer: 'Phạm Thị B', currentPlan: 'Pro', newPlan: 'Studio', remainingHours: 150, totalHours: 230, convertedHours: 107, extraAmount: '2.630.000đ', time: '16/06/2026 13:30' },
      ];

      let activationRows = pendingActivations.map(a => \`
        <tr>
          <td class="fw-600">#\${a.id}</td>
          <td><strong>\${a.customer}</strong><br><span class="text-dim">\${a.phone}</span></td>
          <td><span class="badge badge-blue">\${a.plan}</span></td>
          <td>\${a.billing}</td>
          <td class="fw-600">\${a.amount}</td>
          <td class="text-dim">\${a.time}</td>
          <td>
            <button class="btn btn-success btn-sm" onclick="activatePlan(\${a.id})">✅ Kích hoạt</button>
          </td>
        </tr>
      \`).join('');

      let changeRows = planChangeRequests.map(r => \`
        <tr>
          <td class="fw-600">#\${r.id}</td>
          <td>\${r.customer}</td>
          <td><span class="badge badge-gray">\${r.currentPlan}</span> → <span class="badge badge-purple">\${r.newPlan}</span></td>
          <td>\${r.remainingHours}h / \${r.totalHours}h</td>
          <td class="fw-600">\${r.convertedHours}h (quy đổi)</td>
          <td class="fw-600">\${r.extraAmount}</td>
          <td class="text-dim">\${r.time}</td>
          <td>
            <button class="btn btn-success btn-sm" onclick="approvePlanChange(\${r.id})" style="margin-right:4px;">✅ Duyệt</button>
            <button class="btn btn-danger btn-sm" onclick="rejectPlanChange(\${r.id})">❌ Từ chối</button>
          </td>
        </tr>
      \`).join('');

      return \`
        <div class="card-no-pad">
          <div style="padding:12px 20px; border-bottom:1px solid #1E1E2E; display:flex; justify-content:space-between; align-items:center;">
            <span class="fw-600 text-muted">📦 Gói chờ kích hoạt <span class="badge badge-amber" style="margin-left:8px;">\${pendingActivations.length} yêu cầu</span></span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Khách hàng</th><th>Gói</th><th>Loại</th><th>Số tiền</th><th>Thời gian</th><th>Hành động</th></tr></thead>
              <tbody>\${activationRows}</tbody>
            </table>
          </div>
          \${pendingActivations.length === 0 ? '<div style="text-align:center; padding:24px; color:#8888A0;">✅ Không có gói nào chờ kích hoạt</div>' : ''}
        </div>

        <div class="card-no-pad">
          <div style="padding:12px 20px; border-bottom:1px solid #1E1E2E; display:flex; justify-content:space-between; align-items:center;">
            <span class="fw-600 text-muted">🔄 Yêu cầu đổi gói <span class="badge badge-purple" style="margin-left:8px;">\${planChangeRequests.length} yêu cầu</span></span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Khách hàng</th><th>Đổi gói</th><th>Giờ còn lại</th><th>Giờ quy đổi</th><th>Thanh toán thêm</th><th>Thời gian</th><th>Hành động</th></tr></thead>
              <tbody>\${changeRows}</tbody>
            </table>
          </div>
          \${planChangeRequests.length === 0 ? '<div style="text-align:center; padding:24px; color:#8888A0;">✅ Không có yêu cầu đổi gói nào</div>' : ''}
        </div>

        <div class="card">
          <div class="stat-label" style="margin-bottom:12px;">⚡ Đổi gói nhanh (thủ công)</div>
          <div class="grid-2">
            <div class="form-group">
              <label>Số điện thoại / Email KH</label>
              <input class="form-control" id="quickChangePhone" placeholder="Nhập SĐT hoặc Email..." />
            </div>
            <div class="form-group">
              <label>Gói hiện tại</label>
              <select class="form-control" id="quickChangeFrom">
                <option value="Starter">Starter</option>
                <option value="Pro" selected>Pro</option>
                <option value="Studio">Studio</option>
              </select>
            </div>
            <div class="form-group">
              <label>Gói mới</label>
              <select class="form-control" id="quickChangeTo">
                <option value="Starter">Starter</option>
                <option value="Pro" selected>Pro</option>
                <option value="Studio">Studio</option>
              </select>
            </div>
            <div class="form-group">
              <label>Giờ còn lại (hiện tại)</label>
              <input class="form-control" type="number" id="quickChangeRemaining" value="80" />
            </div>
            <div class="form-group">
              <label>Tổng giờ gói cũ</label>
              <input class="form-control" type="number" id="quickChangeTotal" value="110" />
            </div>
            <div class="form-group">
              <label>Giá gói cũ (VND)</label>
              <input class="form-control" type="number" id="quickChangeOldPrice" value="2400000" />
            </div>
          </div>
          <div style="margin-top:12px;">
            <p class="text-muted" style="margin-bottom:8px;">📊 <strong>Kết quả quy đổi:</strong> <span id="conversionResult" class="text-green fw-600">—</span></p>
            <button class="btn" onclick="calculateConversion()" style="margin-right:8px;">🔄 Tính quy đổi</button>
            <button class="btn btn-success" onclick="executePlanChange()">✅ Thực hiện đổi gói</button>
          </div>
        </div>
      \`;
    }

    // ---------- DUYỆT MỞ RỘNG BỘ NHỚ ----------
    function renderStorageManagement() {
      const storageRequests = [
        { id: 1, customer: 'Nguyễn Thành', type: 'Backup +30GB', price: '50.000đ/tháng', time: '16/06/2026 10:00' },
        { id: 2, customer: 'Trần Văn A', type: 'SSD +10GB', price: '30.000đ/tháng', time: '16/06/2026 11:30' },
      ];

      const activeStorage = [
        { customer: 'Lê Hương', backup: '20GB (mặc định)', ssd: '20GB (mặc định)', upgrade: 'Backup +30GB', since: '01/06/2026' },
        { customer: 'Phạm Thị B', backup: '50GB (mặc định)', ssd: '50GB (mặc định)', upgrade: '—', since: '—' },
      ];

      let requestRows = storageRequests.map(r => \`
        <tr>
          <td class="fw-600">#\${r.id}</td>
          <td>\${r.customer}</td>
          <td><span class="badge badge-purple">\${r.type}</span></td>
          <td class="fw-600">\${r.price}</td>
          <td class="text-dim">\${r.time}</td>
          <td>
            <button class="btn btn-success btn-sm" onclick="approveStorage(\${r.id})" style="margin-right:4px;">✅ Duyệt</button>
            <button class="btn btn-danger btn-sm" onclick="rejectStorage(\${r.id})">❌ Từ chối</button>
          </td>
        </tr>
      \`).join('');

      let activeRows = activeStorage.map(a => \`
        <tr>
          <td>\${a.customer}</td>
          <td>\${a.backup}</td>
          <td>\${a.ssd}</td>
          <td><span class="badge badge-purple">\${a.upgrade}</span></td>
          <td class="text-dim">\${a.since}</td>
          <td>
            \${a.upgrade !== '—' ? \`<button class="btn btn-danger btn-sm" onclick="revokeStorage('\${a.customer}')">🗑️ Thu hồi</button>\` : '<span class="text-dim">—</span>'}
          </td>
        </tr>
      \`).join('');

      return \`
        <div class="card-no-pad">
          <div style="padding:12px 20px; border-bottom:1px solid #1E1E2E; display:flex; justify-content:space-between; align-items:center;">
            <span class="fw-600 text-muted">💾 Yêu cầu mở rộng bộ nhớ <span class="badge badge-amber" style="margin-left:8px;">\${storageRequests.length} yêu cầu</span></span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Khách hàng</th><th>Loại nâng cấp</th><th>Giá</th><th>Thời gian</th><th>Hành động</th></tr></thead>
              <tbody>\${requestRows}</tbody>
            </table>
          </div>
          \${storageRequests.length === 0 ? '<div style="text-align:center; padding:24px; color:#8888A0;">✅ Không có yêu cầu nào đang chờ</div>' : ''}
        </div>

        <div class="card-no-pad">
          <div style="padding:12px 20px; border-bottom:1px solid #1E1E2E;">
            <span class="fw-600 text-muted">📊 Bộ nhớ đang hoạt động</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Khách hàng</th><th>Backup</th><th>SSD</th><th>Nâng cấp</th><th>Từ ngày</th><th>Hành động</th></tr></thead>
              <tbody>\${activeRows}</tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="stat-label" style="margin-bottom:12px;">⚡ Nâng cấp/Hạ cấp bộ nhớ (thủ công)</div>
          <div class="grid-2">
            <div class="form-group">
              <label>Số điện thoại / Email KH</label>
              <input class="form-control" id="quickStoragePhone" placeholder="Nhập SĐT hoặc Email..." />
            </div>
            <div class="form-group">
              <label>Loại bộ nhớ</label>
              <select class="form-control" id="quickStorageType">
                <option value="backup">Backup</option>
                <option value="ssd">SSD dùng ngay</option>
              </select>
            </div>
            <div class="form-group">
              <label>Hành động</label>
              <select class="form-control" id="quickStorageAction">
                <option value="upgrade">Nâng cấp (+10GB)</option>
                <option value="upgrade30">Nâng cấp (+30GB)</option>
                <option value="upgrade100">Nâng cấp (+100GB)</option>
                <option value="downgrade">Hạ cấp (-10GB)</option>
                <option value="reset">Về mặc định</option>
              </select>
            </div>
          </div>
          <div style="margin-top:8px; display:flex; gap:8px;">
            <button class="btn btn-success" onclick="executeStorageChange()">✅ Thực hiện</button>
            <button class="btn" onclick="resetQuickStorage()">🔄 Reset</button>
          </div>
        </div>
      \`;
    }

    function renderInfra() {
      return \`<div class="card"><p class="text-muted">🖥️ Thông tin GPU từ RunPod, Vast.ai (đang phát triển)</p></div>\`;
    }

    function renderAssets() {
      return \`<div class="card"><p class="text-muted">📦 Quản lý workflow, model, thư viện (đang phát triển)</p></div>\`;
    }

    function renderAudit() {
      const logs = [
        { time: '16/06/2026 14:32', user: 'Admin', action: 'Nạp 50h cho KH Nguyễn Thành', target: 'KH001', ip: '192.168.1.1' },
        { time: '16/06/2026 13:15', user: 'Admin', action: 'Tắt GPU phiên S002 (KH Hoàng Tuấn)', target: 'S002', ip: '192.168.1.1' },
        { time: '16/06/2026 10:45', user: 'Support', action: 'Cập nhật giá gói Pro từ 800k → 850k', target: 'Config', ip: '10.0.0.5' },
        { time: '15/06/2026 22:10', user: 'Admin', action: 'Kích hoạt coupon "FLUX10" cho KH mới', target: 'Coupon', ip: '192.168.1.1' },
        { time: '15/06/2026 18:20', user: 'System', action: 'Tự động tắt instance KH Lê Hương (hết giờ)', target: 'KH003', ip: '-' },
      ];
      let rows = logs.map(l => \`
        <tr>
          <td class="mono text-dim">\${l.time}</td>
          <td><span class="badge badge-blue">\${l.user}</span></td>
          <td>\${l.action}</td>
          <td class="mono text-dim">\${l.target}</td>
          <td class="mono text-dim">\${l.ip}</td>
        </tr>
      \`).join('');
      return \`
        <div class="card-no-pad">
          <div style="padding:12px 20px; border-bottom:1px solid #1E1E2E; display:flex; justify-content:space-between;">
            <span class="fw-600 text-muted">📋 Nhật ký hoạt động (5 mẫu gần nhất)</span>
            <button class="btn" onclick="alert('Xem toàn bộ nhật ký')">Xem tất cả</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Thời gian</th><th>Người dùng</th><th>Hành động</th><th>Đối tượng</th><th>IP</th></tr></thead>
              <tbody>\${rows}</tbody>
            </table>
          </div>
        </div>
      \`;
    }

    function renderConfig() {
      return \`
        <div class="grid-2">
          <div class="card">
            <div class="stat-label">⚙️ Cấu hình gói giá</div>
            <div class="form-group"><label>Starter (VND)</label><input class="form-control" type="number" value="250000" /></div>
            <div class="form-group"><label>Pro (VND)</label><input class="form-control" type="number" value="850000" /></div>
            <div class="form-group"><label>Studio (VND)</label><input class="form-control" type="number" value="1800000" /></div>
            <button class="btn btn-success" onclick="alert('Đã lưu cấu hình giá!')">💾 Lưu thay đổi</button>
          </div>
          <div class="card">
            <div class="stat-label">🔔 Ngưỡng cảnh báo</div>
            <div class="form-group"><label>Giờ còn lại (giờ)</label><input class="form-control" type="number" value="5" /></div>
            <div class="form-group"><label>Ngày hết hạn (ngày)</label><input class="form-control" type="number" value="3" /></div>
            <div class="form-group"><label>Template mặc định</label>
              <select class="form-control"><option>ComfyUI Pro</option><option>A1111</option><option>Video AI</option></select>
            </div>
            <button class="btn btn-success" onclick="alert('Đã lưu cấu hình cảnh báo!')">💾 Lưu thay đổi</button>
          </div>
        </div>
        <div class="card">
          <div class="stat-label">🔄 Trạng thái hệ thống</div>
          <div style="display:flex; gap:20px; flex-wrap:wrap;">
            <span><span class="badge badge-green">● Hoạt động</span> Supabase</span>
            <span><span class="badge badge-green">● Hoạt động</span> RunPod API</span>
            <span><span class="badge badge-amber">▲ Đang kiểm tra</span> Vast.ai</span>
            <span><span class="badge badge-green">● Hoạt động</span> Zalo OA</span>
          </div>
        </div>
      \`;
    }

    function renderNotifications() {
      return \`
        <div class="card">
          <div class="stat-label">📨 Gửi thông báo</div>
          <div class="form-group"><label>Đối tượng</label>
            <select class="form-control"><option>Tất cả khách hàng</option><option>Khách Pro</option><option>Khách Studio</option><option>Khách sắp hết giờ</option></select>
          </div>
          <div class="form-group"><label>Tiêu đề</label><input class="form-control" placeholder="Nhập tiêu đề..." /></div>
          <div class="form-group"><label>Nội dung</label><textarea class="form-control" rows="3" placeholder="Nhập nội dung..."></textarea></div>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-primary" onclick="alert('Đã gửi thông báo!')">📤 Gửi ngay</button>
            <button class="btn" onclick="alert('Lưu làm mẫu')">💾 Lưu mẫu</button>
          </div>
        </div>
        <div class="card-no-pad">
          <div style="padding:12px 20px; border-bottom:1px solid #1E1E2E;">
            <span class="fw-600 text-muted">📋 Lịch sử gửi</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Thời gian</th><th>Đối tượng</th><th>Tiêu đề</th><th>Trạng thái</th></tr></thead>
              <tbody>
                <tr><td class="text-dim">16/06 09:30</td><td>Khách sắp hết giờ</td><td>⏳ Nhắc gia hạn gói</td><td><span class="badge badge-green">Đã gửi</span></td></tr>
                <tr><td class="text-dim">15/06 14:00</td><td>Tất cả KH</td><td>🎉 Cập nhật template mới: Flux.1</td><td><span class="badge badge-green">Đã gửi</span></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      \`;
    }

    function renderCoupons() {
      return \`
        <div class="card">
          <div class="stat-label">🎫 Tạo mã giảm giá</div>
          <div class="grid-2">
            <div class="form-group"><label>Mã</label><input class="form-control" placeholder="Ví dụ: FLUX10" /></div>
            <div class="form-group"><label>Giá trị giảm</label>
              <select class="form-control"><option>10%</option><option>15%</option><option>20%</option><option>50k VND</option><option>100k VND</option></select>
            </div>
          </div>
          <button class="btn btn-success" onclick="alert('Đã tạo mã giảm giá!')">🎫 Tạo mã</button>
        </div>
        <div class="card-no-pad">
          <div style="padding:12px 20px; border-bottom:1px solid #1E1E2E;">
            <span class="fw-600 text-muted">📋 Danh sách mã đang hoạt động</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Mã</th><th>Giảm</th><th>Áp dụng</th><th>Số lượng còn</th><th>Hết hạn</th><th>Trạng thái</th></tr></thead>
              <tbody>
                <tr><td class="fw-600">FLUX10</td><td>10%</td><td>Tất cả</td><td>8</td><td>30/07/2026</td><td><span class="badge badge-green">Active</span></td></tr>
                <tr><td class="fw-600">PRO20</td><td>20%</td><td>Pro</td><td>3</td><td>15/07/2026</td><td><span class="badge badge-green">Active</span></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      \`;
    }

    function renderFinance() {
      return \`
        <div class="grid-3">
          <div class="card"><div class="stat-label">Doanh thu tháng này</div><div class="stat-value text-green">568.2tr</div><div class="stat-sub">+8.2% so với tháng trước</div></div>
          <div class="card"><div class="stat-label">Chi phí GPU (RunPod/Vast)</div><div class="stat-value text-red">312.5tr</div><div class="stat-sub">~55% doanh thu</div></div>
          <div class="card"><div class="stat-label">Lợi nhuận ròng</div><div class="stat-value text-blue">255.7tr</div><div class="stat-sub">Margin 45%</div></div>
        </div>
        <div class="card">
          <div class="stat-label">📊 Chi tiết chi phí</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Hạng mục</th><th>Số tiền (tr)</th><th>Tỷ lệ</th></tr></thead>
              <tbody>
                <tr><td>RunPod (GPU)</td><td>280.3</td><td>49%</td></tr>
                <tr><td>Vast.ai (backup)</td><td>32.2</td><td>6%</td></tr>
                <tr><td>Lưu trữ (Storage)</td><td>12.5</td><td>2%</td></tr>
                <tr><td>Thanh toán (PayOS)</td><td>2.8</td><td>0.5%</td></tr>
                <tr><td>Chi phí khác</td><td>5.0</td><td>1%</td></tr>
              </tbody>
            </table>
          </div>
          <div style="margin-top:12px;">
            <button class="btn btn-primary" onclick="alert('Xuất báo cáo PDF')">📄 Xuất PDF</button>
            <button class="btn" onclick="alert('Xuất Excel')">📥 Xuất Excel</button>
          </div>
        </div>
      \`;
    }

    // ─── HANDLER FUNCTIONS ─────────────────────────────────

    // Nạp giờ
    function approveTopup(id) { alert('✅ Đã duyệt yêu cầu nạp giờ #' + id + '! Giờ đã được cộng vào tài khoản KH.'); }
    function rejectTopup(id) { const reason = prompt('❌ Lý do từ chối yêu cầu #' + id + '?'); if (reason) alert('❌ Đã từ chối yêu cầu #' + id + '.'); }
    function quickTopup() {
      const phone = document.getElementById('quickTopupPhone').value;
      if (!phone) { alert('⚠️ Vui lòng nhập SĐT hoặc Email KH!'); return; }
      alert('✅ Đã nạp giờ cho KH ' + phone + '!');
    }
    function resetQuickTopup() {
      document.getElementById('quickTopupPhone').value = '';
      document.getElementById('quickTopupPlan').value = 'Pro';
      document.getElementById('quickTopupBilling').value = 'combo1';
      document.getElementById('quickTopupHours').value = '10';
    }

    // Duyệt gói & Đổi gói
    function activatePlan(id) { alert('✅ Đã kích hoạt gói #' + id + '! KH có thể sử dụng ngay.'); }
    function approvePlanChange(id) { alert('✅ Đã duyệt đổi gói #' + id + '!'); }
    function rejectPlanChange(id) { alert('❌ Đã từ chối đổi gói #' + id + '.'); }
    function calculateConversion() {
      const remaining = parseFloat(document.getElementById('quickChangeRemaining').value) || 0;
      const total = parseFloat(document.getElementById('quickChangeTotal').value) || 1;
      const oldPrice = parseFloat(document.getElementById('quickChangeOldPrice').value) || 0;
      const remainingValue = (remaining / total) * oldPrice;
      document.getElementById('conversionResult').textContent = 'Giá trị còn lại: ' + remainingValue.toLocaleString('vi-VN') + ' VND';
    }
    function executePlanChange() {
      const phone = document.getElementById('quickChangePhone').value;
      if (!phone) { alert('⚠️ Vui lòng nhập SĐT hoặc Email KH!'); return; }
      alert('✅ Đã đổi gói cho KH ' + phone + '!');
    }

    // Duyệt mở rộng bộ nhớ
    function approveStorage(id) { alert('✅ Đã duyệt mở rộng bộ nhớ #' + id + '!'); }
    function rejectStorage(id) { alert('❌ Đã từ chối mở rộng bộ nhớ #' + id + '.'); }
    function revokeStorage(customer) { if (confirm('⚠️ Thu hồi toàn bộ nâng cấp bộ nhớ của ' + customer + '?')) alert('✅ Đã thu hồi nâng cấp bộ nhớ của ' + customer); }
    function executeStorageChange() {
      const phone = document.getElementById('quickStoragePhone').value;
      if (!phone) { alert('⚠️ Vui lòng nhập SĐT hoặc Email KH!'); return; }
      alert('✅ Đã thay đổi bộ nhớ cho KH ' + phone + '!');
    }
    function resetQuickStorage() {
      document.getElementById('quickStoragePhone').value = '';
      document.getElementById('quickStorageType').value = 'backup';
      document.getElementById('quickStorageAction').value = 'upgrade';
    }

    // ─── INIT ──────────────────────────────────────────────
    navigate('overview');`);
  run();
}

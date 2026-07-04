export function initQuanTriKH(): void {
  if (typeof window === 'undefined') return;
  const run = new Function(`// ─── MOCK DATA ──────────────────────────────────────────────
  const customers = [
    { id:'KH001', name:'Nguyễn Thành', email:'thanh@gmail.com', plan:'Pro', hoursLeft:18.5, totalHours:120, lastAccess:'2026-06-16 09:30', workflow:'ComfyUI', model:'SDXL', journey:'Starter→Pro', revenue:6600000, avgDaily:2.3, risk:'medium', sessionsPerWeek:5, history:['Starter','Pro'] },
    { id:'KH002', name:'Trần Minh Khoa', email:'khoa@gmail.com', plan:'Starter', hoursLeft:32, totalHours:50, lastAccess:'2026-06-15 22:15', workflow:'A1111', model:'SD 1.5', journey:'Pro→Starter', revenue:1960000, avgDaily:1.2, risk:'low', sessionsPerWeek:3, history:['Pro','Starter'] },
    { id:'KH003', name:'Lê Thị Hương', email:'huong@studio.vn', plan:'Studio', hoursLeft:0, totalHours:200, lastAccess:'2026-06-10 14:00', workflow:'Video AI', model:'AnimateDiff', journey:'Studio', revenue:10500000, avgDaily:4.7, risk:'high', sessionsPerWeek:0, history:['Studio'] },
    { id:'KH004', name:'Phạm Văn Đức', email:'duc@freelance.vn', plan:'Starter', hoursLeft:8, totalHours:20, lastAccess:'2026-06-14 08:45', workflow:'ComfyUI', model:'Flux', journey:'Starter', revenue:780000, avgDaily:0.8, risk:'high', sessionsPerWeek:2, history:['Starter'] },
    { id:'KH005', name:'Hoàng Anh Tuấn', email:'tuan@agency.vn', plan:'Pro', hoursLeft:54, totalHours:120, lastAccess:'2026-06-16 10:00', workflow:'ComfyUI', model:'SDXL', journey:'Starter→Pro', revenue:4400000, avgDaily:3.1, risk:'low', sessionsPerWeek:6, history:['Starter','Pro'] },
    { id:'KH006', name:'Nguyễn Thị Mai', email:'mai@design.vn', plan:'Starter', hoursLeft:12, totalHours:50, lastAccess:'2026-06-15 16:20', workflow:'A1111', model:'ReActor', journey:'Starter', revenue:1960000, avgDaily:1.6, risk:'medium', sessionsPerWeek:4, history:['Starter'] },
    { id:'KH007', name:'Trịnh Văn An', email:'an@creator.com', plan:'Pro', hoursLeft:2, totalHours:120, lastAccess:'2026-06-16 07:00', workflow:'ComfyUI', model:'ControlNet', journey:'Pro', revenue:2200000, avgDaily:4.2, risk:'high', sessionsPerWeek:7, history:['Pro'] },
    { id:'KH008', name:'Vũ Thị Lan', email:'lan@studio.vn', plan:'Studio', hoursLeft:120, totalHours:200, lastAccess:'2026-06-15 13:10', workflow:'Blender', model:'Cycles', journey:'Starter→Pro→Studio', revenue:10500000, avgDaily:2.8, risk:'low', sessionsPerWeek:4, history:['Starter','Pro','Studio'] },
    { id:'KH009', name:'Đỗ Minh Tuấn', email:'tuan.do@ai.com', plan:'Pro', hoursLeft:95, totalHours:120, lastAccess:'2026-06-14 20:30', workflow:'ComfyUI', model:'Flux', journey:'Pro', revenue:4400000, avgDaily:1.9, risk:'low', sessionsPerWeek:3, history:['Pro'] },
    { id:'KH010', name:'Phan Thị Ngọc', email:'ngoc@design.vn', plan:'Starter', hoursLeft:0, totalHours:50, lastAccess:'2026-06-01 09:00', workflow:'A1111', model:'SD 1.5', journey:'Starter', revenue:980000, avgDaily:0.3, risk:'high', sessionsPerWeek:1, history:['Starter'] },
    { id:'KH011', name:'Lý Quốc Huy', email:'huy@agency.vn', plan:'Pro', hoursLeft:45, totalHours:120, lastAccess:'2026-06-16 11:45', workflow:'Video AI', model:'RIFE', journey:'Starter→Pro', revenue:4400000, avgDaily:2.5, risk:'medium', sessionsPerWeek:5, history:['Starter','Pro'] },
    { id:'KH012', name:'Ngô Thị Thanh', email:'thanh@freelance.vn', plan:'Studio', hoursLeft:10, totalHours:200, lastAccess:'2026-06-15 18:00', workflow:'ComfyUI', model:'SDXL', journey:'Pro→Studio', revenue:10500000, avgDaily:3.8, risk:'high', sessionsPerWeek:6, history:['Pro','Studio'] },
  ];

  // ─── HELPER ──────────────────────────────────────────────────
  function getRiskBadge(risk) {
    const map = {
      low: '<span class="risk-low">● Thấp</span>',
      medium: '<span class="risk-medium">● Trung</span>',
      high: '<span class="risk-high">● Cao</span>'
    };
    return map[risk] || risk;
  }

  function getStatus(c) {
    if (c.hoursLeft <= 0) return 'expired';
    if (c.hoursLeft > 0 && c.plan) return 'hasHours';
    return 'active';
  }

  function getProgressColor(hoursLeft, total) {
    const pct = total > 0 ? (hoursLeft / total) * 100 : 0;
    if (pct > 30) return '';
    if (pct > 10) return 'amber';
    return 'red';
  }

  function renderRow(c) {
    const status = getStatus(c);
    const progColor = getProgressColor(c.hoursLeft, c.totalHours);
    const pct = c.totalHours > 0 ? Math.round((c.hoursLeft / c.totalHours) * 100) : 0;
    return \`
      <tr>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="width:28px; height:28px; border-radius:50%; background:linear-gradient(135deg,#4F8EF7,#8B5CF6); color:#fff; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; flex-shrink:0;">\${c.name.split(' ').pop().charAt(0)}</div>
            <div>
              <div style="font-weight:500;">\${c.name}</div>
              <div style="font-size:11px; color:#8888A0;">\${c.email}</div>
            </div>
          </div>
        </td>
        <td><span class="badge badge-\${c.plan === 'Starter' ? 'blue' : c.plan === 'Pro' ? 'purple' : 'green'}">\${c.plan}</span></td>
        <td>
          <div style="display:flex; align-items:center; gap:6px;">
            <div class="progress"><div class="progress-bar \${progColor}" style="width:\${Math.min(100, pct)}%;"></div></div>
            <span class="mono" style="font-size:13px;">\${c.hoursLeft}h</span>
          </div>
        </td>
        <td style="font-size:12px; color:#8888A0;">\${c.lastAccess}</td>
        <td><span class="badge badge-blue">\${c.workflow}</span></td>
        <td><span class="badge badge-purple">\${c.model}</span></td>
        <td style="font-size:12px; color:#8888A0;">\${c.journey}</td>
        <td class="mono text-green">\${c.revenue.toLocaleString('vi-VN')}đ</td>
        <td class="mono">\${c.avgDaily.toFixed(1)}h</td>
        <td>\${getRiskBadge(c.risk)}</td>
        <td class="mono">\${c.sessionsPerWeek}</td>
        <td style="font-size:11px; color:#8888A0;">\${c.history.join(' → ')}</td>
      </tr>
    \`;
  }

  // ─── FILTER & RENDER ────────────────────────────────────────
  function applyFilters() {
    const statusFilter = document.getElementById('filterStatus').value;
    const planFilter = document.getElementById('filterPlan').value;
    const templateFilter = document.getElementById('filterTemplate').value;
    const regionFilter = document.getElementById('filterRegion').value;
    const search = document.getElementById('searchInput').value.toLowerCase();

    const filtered = customers.filter(c => {
      // status
      if (statusFilter === 'active' && getStatus(c) !== 'active') return false;
      if (statusFilter === 'hasHours' && getStatus(c) !== 'hasHours') return false;
      if (statusFilter === 'expired' && getStatus(c) !== 'expired') return false;
      // plan
      if (planFilter !== 'all' && c.plan !== planFilter) return false;
      // template (matching workflow)
      if (templateFilter !== 'all' && c.workflow !== templateFilter) return false;
      // region (giả định region dựa trên id chẵn/lẻ cho demo)
      const region = (parseInt(c.id.slice(-2)) % 3 === 0) ? 'Singapore' : (parseInt(c.id.slice(-2)) % 3 === 1) ? 'Japan' : 'US';
      if (regionFilter !== 'all' && region !== regionFilter) return false;
      // search
      if (search && !c.name.toLowerCase().includes(search) && !c.email.toLowerCase().includes(search)) return false;
      return true;
    });

    // Render
    const tbody = document.getElementById('tableBody');
    if (filtered.length === 0) {
      tbody.innerHTML = \`<tr><td colspan="12" style="text-align:center; padding:30px; color:#8888A0;">Không tìm thấy khách hàng phù hợp</td></tr>\`;
    } else {
      tbody.innerHTML = filtered.map(c => renderRow(c)).join('');
    }
    document.getElementById('rowCount').textContent = \`Hiển thị \${filtered.length} / \${customers.length}\`;
  }

  // ─── SORT ────────────────────────────────────────────────────
  let sortCol = 0;
  let sortAsc = true;

  function sortTable(col) {
    if (sortCol === col) sortAsc = !sortAsc;
    else { sortCol = col; sortAsc = true; }
    const tbody = document.getElementById('tableBody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    // Lấy dữ liệu từ dòng hiện tại (đã lọc)
    const data = rows.map(row => {
      const cells = row.querySelectorAll('td');
      return {
        row,
        values: Array.from(cells).map(td => td.textContent.trim())
      };
    });
    // Sắp xếp
    data.sort((a, b) => {
      let va = a.values[col] || '';
      let vb = b.values[col] || '';
      // Chuyển số nếu có
      const numA = parseFloat(va.replace(/[^0-9.]/g,''));
      const numB = parseFloat(vb.replace(/[^0-9.]/g,''));
      if (!isNaN(numA) && !isNaN(numB)) {
        return sortAsc ? numA - numB : numB - numA;
      }
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    tbody.innerHTML = data.map(d => d.row.outerHTML).join('');
  }

  // ─── INIT ────────────────────────────────────────────────────
  window.onload = function() {
    applyFilters();
  };`);
  run();
}

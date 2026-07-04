import Head from 'next/head';
import { useEffect } from 'react';
import { initQuanTriKH } from '@/lib/scripts/quan-tri-kh';
import { styles } from '@/styles/pages/quan-tri-kh.styles';


export default function QuanTriKHPage() {

  useEffect(() => {
    initQuanTriKH();
  }, []);
  return (
    <>
      <Head>
        <title>GPU Vietnam – Phân tích khách hàng</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>
      <>
        <div className="container">
        
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <h1 style={{ fontFamily: '\'Space Grotesk\',sans-serif', fontWeight: '600', fontSize: '22px' }}>📊 Phân tích khách hàng</h1>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button className="btn btn-success" onClick={() => { if (typeof window !== 'undefined') (0, eval)("alert('Xuất Excel (demo)')"); }}>📥 Xuất Excel</button>
              <button className="btn" onClick={() => { if (typeof window !== 'undefined') (0, eval)("alert('Làm mới dữ liệu')"); }}>⟳ Làm mới</button>
            </div>
          </div>
        
          
          <div className="grid-4" style={{ marginBottom: '20px' }}>
            <div className="card">
              <div className="stat-label">Tổng khách hàng</div>
              <div className="stat-value text-blue">237</div>
              <div className="stat-sub">+12 trong tháng này</div>
            </div>
            <div className="card">
              <div className="stat-label">Đang sử dụng</div>
              <div className="stat-value text-green">48</div>
              <div className="stat-sub">có GPU đang chạy</div>
            </div>
            <div className="card">
              <div className="stat-label">Còn giờ</div>
              <div className="stat-value text-amber">132</div>
              <div className="stat-sub">chưa hết hạn</div>
            </div>
            <div className="card">
              <div className="stat-label">Doanh thu bình quân/KH</div>
              <div className="stat-value text-purple">2.4tr</div>
              <div className="stat-sub">tổng 568tr</div>
            </div>
          </div>
        
          
          <div className="grid-3" style={{ marginBottom: '20px' }}>
            <div className="card">
              <div className="stat-label">Tỷ lệ tái gia hạn (Retention)</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '4px' }}>
                <span className="stat-value text-green">86%</span>
                <span className="text-dim" style={{ fontSize: '13px' }}>(+3% so với tháng trước)</span>
              </div>
              <div className="stat-sub">KH quay lại sau khi hết gói</div>
            </div>
            <div className="card">
              <div className="stat-label">Giờ cao điểm (Peak hour)</div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '4px' }}>
                <span><span className="badge badge-amber">🌅 Sáng</span> 30%</span>
                <span><span className="badge badge-blue">☀️ Chiều</span> 45%</span>
                <span><span className="badge badge-purple">🌙 Tối</span> 25%</span>
              </div>
              <div className="stat-sub">Khách dùng nhiều nhất khung 14h-17h</div>
            </div>
            <div className="card">
              <div className="stat-label">GPU ưa chuộng</div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '4px' }}>
                <span><span className="badge badge-green">🇸🇬 SG</span> 52%</span>
                <span><span className="badge badge-blue">🇯🇵 JP</span> 28%</span>
                <span><span className="badge badge-purple">🇺🇸 US</span> 20%</span>
              </div>
              <div className="stat-sub">Template: ComfyUI (68%), A1111 (22%)</div>
            </div>
          </div>
        
          
          <div className="card" style={{ padding: '12px 20px' }}>
            <div className="filter-bar">
              <div className="filter-group">
                <label>Trạng thái</label>
                <select id="filterStatus" onChange={() => { if (typeof window !== 'undefined') (0, eval)("applyFilters()"); }}>
                  <option value="all">Tất cả</option>
                  <option value="active">Đang sử dụng</option>
                  <option value="hasHours">Còn giờ</option>
                  <option value="expired">Hết giờ</option>
                </select>
              </div>
              <div className="filter-group">
                <label>Gói</label>
                <select id="filterPlan" onChange={() => { if (typeof window !== 'undefined') (0, eval)("applyFilters()"); }}>
                  <option value="all">Tất cả</option>
                  <option value="Starter">Starter</option>
                  <option value="Pro">Pro</option>
                  <option value="Studio">Studio</option>
                </select>
              </div>
              <div className="filter-group">
                <label>Template</label>
                <select id="filterTemplate" onChange={() => { if (typeof window !== 'undefined') (0, eval)("applyFilters()"); }}>
                  <option value="all">Tất cả</option>
                  <option value="ComfyUI">ComfyUI</option>
                  <option value="A1111">A1111</option>
                  <option value="Video AI">Video AI</option>
                  <option value="Blender">Blender</option>
                </select>
              </div>
              <div className="filter-group">
                <label>Region</label>
                <select id="filterRegion" onChange={() => { if (typeof window !== 'undefined') (0, eval)("applyFilters()"); }}>
                  <option value="all">Tất cả</option>
                  <option value="Singapore">Singapore</option>
                  <option value="Japan">Japan</option>
                  <option value="US">US</option>
                </select>
              </div>
              <div className="filter-group" style={{ flex: '1', justifyContent: 'flex-end' }}>
                <input type="text" id="searchInput" placeholder="🔍 Tìm tên, email..." onInput={() => { if (typeof window !== 'undefined') (0, eval)("applyFilters()"); }} />
              </div>
            </div>
          </div>
        
          
          <div className="card-no-pad">
            <div style={{ padding: '12px 20px', borderBottom: '1px solid #1E1E2E', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: '600', color: '#8888A0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Danh sách khách hàng</span>
              <span style={{ fontSize: '12px', color: '#44445A' }} id="rowCount">Hiển thị 12 / 237</span>
            </div>
            <div className="table-wrap">
              <table id="customerTable">
                <thead>
                  <tr>
                    <th onClick={() => { if (typeof window !== 'undefined') (0, eval)("sortTable(0)"); }}>KH</th>
                    <th onClick={() => { if (typeof window !== 'undefined') (0, eval)("sortTable(1)"); }}>Gói</th>
                    <th onClick={() => { if (typeof window !== 'undefined') (0, eval)("sortTable(2)"); }}>Giờ còn</th>
                    <th onClick={() => { if (typeof window !== 'undefined') (0, eval)("sortTable(3)"); }}>Lần cuối</th>
                    <th onClick={() => { if (typeof window !== 'undefined') (0, eval)("sortTable(4)"); }}>Workflow</th>
                    <th onClick={() => { if (typeof window !== 'undefined') (0, eval)("sortTable(5)"); }}>Model</th>
                    <th onClick={() => { if (typeof window !== 'undefined') (0, eval)("sortTable(6)"); }}>Hành trình</th>
                    <th onClick={() => { if (typeof window !== 'undefined') (0, eval)("sortTable(7)"); }}>Doanh thu</th>
                    <th onClick={() => { if (typeof window !== 'undefined') (0, eval)("sortTable(8)"); }}>Giờ TB/ngày</th>
                    <th onClick={() => { if (typeof window !== 'undefined') (0, eval)("sortTable(9)"); }}>Churn Risk</th>
                    <th onClick={() => { if (typeof window !== 'undefined') (0, eval)("sortTable(10)"); }}>Phiên/tuần</th>
                    <th>Lịch sử gói</th>
                  </tr>
                </thead>
                <tbody id="tableBody">
                  
                </tbody>
              </table>
            </div>
          </div>
        
          
          <div style={{ marginTop: '30px', borderTop: '1px solid #1E1E2E', paddingTop: '16px', display: 'flex', justifyContent: 'space-between', color: '#44445A', fontSize: '12px' }}>
            <span>GPU Vietnam Admin · Phân tích khách hàng</span>
            <span>Cập nhật: 16/06/2026 15:20:11</span>
          </div>
        </div>
      </>
    </>
  );
}

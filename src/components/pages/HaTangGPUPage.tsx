import Head from 'next/head';
import { styles } from '@/styles/pages/ha-tang-gpu.styles';


export default function HaTangGPUPage() {
  return (
    <>
      <Head>
        <title>GPU Vietnam – Hạ tầng (Preview)</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>
      <>
        <div className="container">
            
            <h1 style={{ fontFamily: '\'Space Grotesk\',sans-serif', fontWeight: '600', fontSize: '20px', marginBottom: '24px' }}>Hạ tầng GPU</h1>
        
            
            <div className="grid-4">
              <div className="card">
                <div className="stat-label">Tổng GPU</div>
                <div className="stat-value color-blue">43</div>
                <div className="stat-sub">trên tất cả nhà cung cấp</div>
              </div>
              <div className="card">
                <div className="stat-label">GPU khả dụng</div>
                <div className="stat-value color-green">20</div>
                <div className="stat-sub">đang idle (46%)</div>
              </div>
              <div className="card">
                <div className="stat-label">Uptime TB 7d</div>
                <div className="stat-value color-purple">98.4%</div>
                <div className="stat-sub">độ ổn định</div>
              </div>
              <div className="card">
                <div className="stat-label">Giá đầu vào TB</div>
                <div className="stat-value color-amber">$0.75</div>
                <div className="stat-sub">mỗi giờ</div>
              </div>
            </div>
        
            
            <div className="alert" style={{ marginBottom: '20px' }}>
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
              </svg>
              <div>
                <div style={{ fontWeight: '600' }}>Có 2 nhà cung cấp đang ở trạng thái cảnh báo / nguy kịch</div>
                <div style={{ fontSize: '12px', color: '#EF4444AA' }}>Kiểm tra ngay để tránh ảnh hưởng đến khách hàng.</div>
              </div>
            </div>
        
            
            <div className="card-no-pad" style={{ marginBottom: '20px' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #1E1E2E', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#8888A0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Chi tiết từng loại GPU</span>
                <button className="btn-refresh">⟳ Làm mới</button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Nhà cung cấp</th>
                      <th>Region</th>
                      <th>GPU</th>
                      <th>Tổng</th>
                      <th>Idle</th>
                      <th>Giá/h (USD)</th>
                      <th>Uptime 7d</th>
                      <th>Latency</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><span className="fw-600">RunPod</span> <span style={{ marginLeft: '6px', fontSize: '10px', color: '#8888A0' }}>★ chính</span></td>
                      <td className="color-sub">Singapore</td>
                      <td className="mono">RTX 4090</td>
                      <td>8</td>
                      <td><span className="color-green">3</span></td>
                      <td className="mono color-amber">$0.82</td>
                      <td><span className="color-green">99.8%</span></td>
                      <td className="mono color-sub">48ms</td>
                      <td><span className="badge badge-healthy"><span className="badge-dot"></span>Tốt</span></td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">RunPod</span> <span style={{ marginLeft: '6px', fontSize: '10px', color: '#8888A0' }}>★ chính</span></td>
                      <td className="color-sub">Japan</td>
                      <td className="mono">RTX 4090</td>
                      <td>5</td>
                      <td><span className="color-green">1</span></td>
                      <td className="mono color-amber">$0.85</td>
                      <td><span className="color-green">99.5%</span></td>
                      <td className="mono color-sub">72ms</td>
                      <td><span className="badge badge-healthy"><span className="badge-dot"></span>Tốt</span></td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">RunPod</span> <span style={{ marginLeft: '6px', fontSize: '10px', color: '#8888A0' }}>★ chính</span></td>
                      <td className="color-sub">US West</td>
                      <td className="mono">RTX 4090</td>
                      <td>12</td>
                      <td><span className="color-green">6</span></td>
                      <td className="mono color-amber">$0.79</td>
                      <td><span className="color-amber">98.9%</span></td>
                      <td className="mono color-sub">180ms</td>
                      <td><span className="badge badge-healthy"><span className="badge-dot"></span>Tốt</span></td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">RunPod</span> <span style={{ marginLeft: '6px', fontSize: '10px', color: '#8888A0' }}>★ chính</span></td>
                      <td className="color-sub">Singapore</td>
                      <td className="mono">RTX 3090</td>
                      <td>6</td>
                      <td><span className="color-green">4</span></td>
                      <td className="mono color-amber">$0.52</td>
                      <td><span className="color-green">99.1%</span></td>
                      <td className="mono color-sub">50ms</td>
                      <td><span className="badge badge-healthy"><span className="badge-dot"></span>Tốt</span></td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">Vast.ai</span></td>
                      <td className="color-sub">Singapore</td>
                      <td className="mono">RTX 4090</td>
                      <td>3</td>
                      <td><span className="color-green">1</span></td>
                      <td className="mono color-amber">$0.76</td>
                      <td><span className="color-amber">97.2%</span></td>
                      <td className="mono color-sub">55ms</td>
                      <td><span className="badge badge-warning"><span className="badge-dot"></span>Cảnh báo</span></td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">Vast.ai</span></td>
                      <td className="color-sub">Japan</td>
                      <td className="mono">RTX 4090</td>
                      <td>2</td>
                      <td><span className="color-red">0</span> <span style={{ fontSize: '10px', color: '#EF4444', marginLeft: '6px' }}>⚠ hết</span></td>
                      <td className="mono color-amber">$0.78</td>
                      <td><span className="color-red">96.0%</span></td>
                      <td className="mono color-sub">75ms</td>
                      <td><span className="badge badge-critical"><span className="badge-dot"></span>Nguy kịch</span></td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">Vast.ai</span></td>
                      <td className="color-sub">US East</td>
                      <td className="mono">RTX 4090</td>
                      <td>7</td>
                      <td><span className="color-green">5</span></td>
                      <td className="mono color-amber">$0.74</td>
                      <td><span className="color-green">98.5%</span></td>
                      <td className="mono color-sub">195ms</td>
                      <td><span className="badge badge-healthy"><span className="badge-dot"></span>Tốt</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
        
            
            <div className="grid-2">
              <div className="card">
                <div className="stat-label">💡 Giá bán tham khảo</div>
                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '8px' }}>
                  <div><div style={{ fontSize: '11px', color: '#8888A0' }}>RTX 3090</div><div style={{ fontWeight: '600' }}>~250k VND/h</div></div>
                  <div><div style={{ fontSize: '11px', color: '#8888A0' }}>RTX 4090</div><div style={{ fontWeight: '600' }}>~400k VND/h</div></div>
                </div>
                <div style={{ fontSize: '12px', color: '#44445A', marginTop: '6px' }}>Dựa trên giá gói hiện tại, có thể điều chỉnh theo giá đầu vào.</div>
              </div>
              <div className="card">
                <div className="stat-label">⚡ Gợi ý hành động</div>
                <ul className="suggestion-list" style={{ marginTop: '8px' }}>
                  <li><span className="check">✓</span> Ưu tiên dùng RunPod Singapore (giá tốt, latency thấp)</li>
                  <li><span className="warn">⚠</span> Vast.ai Japan đang hết GPU, cần bổ sung</li>
                  <li><span className="info">ℹ</span> Cân nhắc tăng giá gói nếu giá vốn tăng &gt;10%</li>
                </ul>
              </div>
            </div>
        
            
            <div style={{ marginTop: '40px', borderTop: '1px solid #1E1E2E', paddingTop: '20px', display: 'flex', justifyContent: 'space-between', color: '#44445A', fontSize: '12px' }}>
              <span>GPU Vietnam Admin · Hạ tầng</span>
              <span>Dữ liệu cập nhật: 16/06/2026 14:32:21</span>
            </div>
          </div>
      </>
    </>
  );
}

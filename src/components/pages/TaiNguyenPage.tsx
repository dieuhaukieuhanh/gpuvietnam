import Head from 'next/head';
import { useEffect } from 'react';
import { initTaiNguyen } from '@/lib/scripts/tai-nguyen';
import { styles } from '@/styles/pages/tai-nguyen.styles';


export default function TaiNguyenPage() {

  useEffect(() => {
    initTaiNguyen();
  }, []);
  return (
    <>
      <Head>
        <title>GPU Vietnam – Tài nguyên nguyên mềm</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>
      <>
        <div className="container">
        
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <h1 style={{ fontFamily: '\'Space Grotesk\',sans-serif', fontWeight: '600', fontSize: '22px' }}>📦 Tài nguyên nguyên mềm</h1>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button className="badge badge-blue" style={{ cursor: 'default', padding: '6px 14px', fontSize: '12px' }}>💾 Tổng storage: 342 GB</button>
              <button className="badge badge-amber" style={{ cursor: 'default', padding: '6px 14px', fontSize: '12px' }}>💰 Chi phí lưu trữ: ~$12.30/ngày</button>
            </div>
          </div>
        
          
          <div className="tabs">
            <button className="tab-btn active" onClick={() => { if (typeof window !== 'undefined') (0, eval)("switchTab('overview')"); }}>📊 Tổng quan</button>
            <button className="tab-btn" onClick={() => { if (typeof window !== 'undefined') (0, eval)("switchTab('workflows')"); }}>⚙️ Workflows</button>
            <button className="tab-btn" onClick={() => { if (typeof window !== 'undefined') (0, eval)("switchTab('models')"); }}>🧠 Models</button>
            <button className="tab-btn" onClick={() => { if (typeof window !== 'undefined') (0, eval)("switchTab('libraries')"); }}>📚 Thư viện & Gói</button>
          </div>
        
          
          <div id="tab-overview" className="tab-content active">
            
            <div className="grid-4">
              <div className="card">
                <div className="stat-label">Tổng Workflows</div>
                <div className="stat-value text-blue">24</div>
                <div className="stat-sub">12 Official · 12 Custom</div>
              </div>
              <div className="card">
                <div className="stat-label">Tổng Models</div>
                <div className="stat-value text-purple">47</div>
                <div className="stat-sub">Base: 12 · LoRA: 21 · ControlNet: 14</div>
              </div>
              <div className="card">
                <div className="stat-label">Thư viện / Gói</div>
                <div className="stat-value text-green">38</div>
                <div className="stat-sub">Python: 29 · System: 9</div>
              </div>
              <div className="card">
                <div className="stat-label">Tỷ lệ lỗi TB</div>
                <div className="stat-value text-amber">4.2%</div>
                <div className="stat-sub">Workflow hay lỗi nhất: Video AI (12%)</div>
              </div>
            </div>
        
            
            <div className="grid-2">
              <div className="card">
                <div className="stat-label" style={{ marginBottom: '12px' }}>📌 Phân loại theo nhóm khách hàng</div>
                <div className="matrix">
                  <div className="matrix-row">
                    <span className="matrix-label">Starter</span>
                    <div className="matrix-bar">
                      <div className="matrix-seg" style={{ width: '60%', background: '#4F8EF7' }}>60% A1111</div>
                      <div className="matrix-seg" style={{ width: '30%', background: '#8B5CF6' }}>30% Comfy</div>
                      <div className="matrix-seg" style={{ width: '10%', background: '#44445A' }}>10% Video</div>
                    </div>
                  </div>
                  <div className="matrix-row">
                    <span className="matrix-label">Pro</span>
                    <div className="matrix-bar">
                      <div className="matrix-seg" style={{ width: '70%', background: '#8B5CF6' }}>70% Comfy</div>
                      <div className="matrix-seg" style={{ width: '20%', background: '#4F8EF7' }}>20% A1111</div>
                      <div className="matrix-seg" style={{ width: '10%', background: '#22C55E' }}>10% Video</div>
                    </div>
                  </div>
                  <div className="matrix-row">
                    <span className="matrix-label">Studio</span>
                    <div className="matrix-bar">
                      <div className="matrix-seg" style={{ width: '50%', background: '#22C55E' }}>50% Video</div>
                      <div className="matrix-seg" style={{ width: '35%', background: '#8B5CF6' }}>35% Comfy</div>
                      <div className="matrix-seg" style={{ width: '15%', background: '#F59E0B' }}>15% Blender</div>
                    </div>
                  </div>
                </div>
                <div className="stat-sub" style={{ marginTop: '10px' }}>Model phổ biến nhất: <span className="badge badge-purple">Flux.1</span> (dùng 68% Pro/Studio)</div>
              </div>
        
              
              <div className="card">
                <div className="stat-label" style={{ marginBottom: '12px' }}>💡 Gợi ý tối ưu</div>
                <ul style={{ listStyle: 'none', padding: '0', margin: '0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <li style={{ display: 'flex', gap: '10px', alignItems: 'center', background: '#16161F', padding: '8px 12px', borderRadius: '8px' }}>
                    <span className="badge badge-red">⚡ VRAM</span>
                    <span style={{ fontSize: '13px' }}><strong>Flux.1</strong> cần ≥ 24GB → Chỉ dành cho Pro/Studio</span>
                  </li>
                  <li style={{ display: 'flex', gap: '10px', alignItems: 'center', background: '#16161F', padding: '8px 12px', borderRadius: '8px' }}>
                    <span className="badge badge-amber">📦 Storage</span>
                    <span style={{ fontSize: '13px' }}><strong>SDXL</strong> + LoRAs chiếm 87GB → Cân nhắc nén</span>
                  </li>
                  <li style={{ display: 'flex', gap: '10px', alignItems: 'center', background: '#16161F', padding: '8px 12px', borderRadius: '8px' }}>
                    <span className="badge badge-blue">🔄 Lỗi</span>
                    <span style={{ fontSize: '13px' }}><strong>AnimateDiff</strong> crash 15% → Cần cập nhật node</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        
          
          <div id="tab-workflows" className="tab-content">
            <div className="card-no-pad">
              <div style={{ padding: '12px 20px', borderBottom: '1px solid #1E1E2E', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#8888A0', textTransform: 'uppercase' }}>Danh sách Workflow</span>
                <span style={{ fontSize: '12px', color: '#44445A' }}>Hiển thị 12 / 24</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tên Workflow</th>
                      <th>Loại</th>
                      <th>VRAM (GB)</th>
                      <th>Storage</th>
                      <th>Nhóm KH dùng</th>
                      <th>Tỷ lệ lỗi</th>
                      <th>Lần cập nhật</th>
                      <th>Nguồn</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><span className="fw-600">ComfyUI Pro (SDXL)</span></td>
                      <td><span className="badge badge-purple">Image</span></td>
                      <td className="mono">12-18</td>
                      <td className="mono text-dim">2.4 GB</td>
                      <td><span className="badge badge-blue">Pro</span> <span className="badge badge-green">Studio</span></td>
                      <td><span className="badge badge-green">1.2%</span></td>
                      <td className="text-dim">15/06/2026</td>
                      <td><span className="badge badge-blue">Official</span></td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">Flux.1 Workflow</span></td>
                      <td><span className="badge badge-purple">Image</span></td>
                      <td className="mono text-red">24+</td>
                      <td className="mono text-dim">3.8 GB</td>
                      <td><span className="badge badge-green">Studio</span></td>
                      <td><span className="badge badge-amber">4.5%</span></td>
                      <td className="text-dim">10/06/2026</td>
                      <td><span className="badge badge-blue">Official</span></td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">Video AI (AnimateDiff)</span></td>
                      <td><span className="badge badge-amber">Video</span></td>
                      <td className="mono">16-20</td>
                      <td className="mono text-dim">5.1 GB</td>
                      <td><span className="badge badge-green">Studio</span></td>
                      <td><span className="badge badge-red">12.0%</span></td>
                      <td className="text-dim">01/06/2026</td>
                      <td><span className="badge badge-blue">Official</span></td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">A1111 Base (SD 1.5)</span></td>
                      <td><span className="badge badge-purple">Image</span></td>
                      <td className="mono">6-10</td>
                      <td className="mono text-dim">1.8 GB</td>
                      <td><span className="badge badge-blue">Pro</span> <span className="badge badge-gray">Starter</span></td>
                      <td><span className="badge badge-green">0.8%</span></td>
                      <td className="text-dim">12/06/2026</td>
                      <td><span className="badge badge-blue">Official</span></td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">Blender Cycles GPU</span></td>
                      <td><span className="badge badge-amber">3D</span></td>
                      <td className="mono">12-24</td>
                      <td className="mono text-dim">8.2 GB</td>
                      <td><span className="badge badge-green">Studio</span></td>
                      <td><span className="badge badge-amber">5.3%</span></td>
                      <td className="text-dim">05/06/2026</td>
                      <td><span className="badge badge-blue">Official</span></td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">Custom - Style Transfer</span></td>
                      <td><span className="badge badge-purple">Image</span></td>
                      <td className="mono">10</td>
                      <td className="mono text-dim">0.9 GB</td>
                      <td><span className="badge badge-gray">Starter</span></td>
                      <td><span className="badge badge-green">0.0%</span></td>
                      <td className="text-dim">08/06/2026</td>
                      <td><span className="badge badge-amber">Custom</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        
          
          <div id="tab-models" className="tab-content">
            <div className="card-no-pad">
              <div style={{ padding: '12px 20px', borderBottom: '1px solid #1E1E2E', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#8888A0', textTransform: 'uppercase' }}>Danh sách Models</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span className="badge badge-purple">Base: 12</span>
                  <span className="badge badge-blue">LoRA: 21</span>
                  <span className="badge badge-amber">ControlNet: 14</span>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tên Model</th>
                      <th>Loại</th>
                      <th>Kích thước</th>
                      <th>VRAM yêu cầu</th>
                      <th>Lượt dùng (tháng)</th>
                      <th>Phổ biến nhóm</th>
                      <th>Lần cập nhật</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><span className="fw-600">Flux.1 (Dev)</span></td>
                      <td><span className="badge badge-purple">Base</span></td>
                      <td className="mono text-dim">12.5 GB</td>
                      <td className="mono text-red">24 GB</td>
                      <td className="mono text-green">2,430</td>
                      <td><span className="badge badge-green">Studio</span></td>
                      <td className="text-dim">01/06/2026</td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">SDXL 1.0</span></td>
                      <td><span className="badge badge-purple">Base</span></td>
                      <td className="mono text-dim">6.9 GB</td>
                      <td className="mono">12 GB</td>
                      <td className="mono text-green">5,210</td>
                      <td><span className="badge badge-blue">Pro</span></td>
                      <td className="text-dim">20/05/2026</td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">SD 1.5 (Pruned)</span></td>
                      <td><span className="badge badge-purple">Base</span></td>
                      <td className="mono text-dim">1.9 GB</td>
                      <td className="mono">6 GB</td>
                      <td className="mono text-green">3,870</td>
                      <td><span className="badge badge-gray">Starter</span></td>
                      <td className="text-dim">15/05/2026</td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">ControlNet (Canny)</span></td>
                      <td><span className="badge badge-amber">ControlNet</span></td>
                      <td className="mono text-dim">1.4 GB</td>
                      <td className="mono">8 GB</td>
                      <td className="mono text-green">1,820</td>
                      <td><span className="badge badge-blue">Pro</span></td>
                      <td className="text-dim">10/06/2026</td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">IP-Adapter (SDXL)</span></td>
                      <td><span className="badge badge-blue">LoRA</span></td>
                      <td className="mono text-dim">0.7 GB</td>
                      <td className="mono">10 GB</td>
                      <td className="mono text-green">980</td>
                      <td><span className="badge badge-green">Studio</span></td>
                      <td className="text-dim">05/06/2026</td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">Real-ESRGAN (Video)</span></td>
                      <td><span className="badge badge-amber">Upscale</span></td>
                      <td className="mono text-dim">2.1 GB</td>
                      <td className="mono">12 GB</td>
                      <td className="mono text-green">650</td>
                      <td><span className="badge badge-green">Studio</span></td>
                      <td className="text-dim">25/05/2026</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        
          
          <div id="tab-libraries" className="tab-content">
            <div className="card-no-pad">
              <div style={{ padding: '12px 20px', borderBottom: '1px solid #1E1E2E', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#8888A0', textTransform: 'uppercase' }}>Thư viện & Gói phần mềm</span>
                <span style={{ fontSize: '12px', color: '#44445A' }}>Tổng: 38 gói</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tên thư viện</th>
                      <th>Phiên bản</th>
                      <th>Loại</th>
                      <th>Dung lượng</th>
                      <th>Workflow liên quan</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><span className="fw-600">PyTorch</span></td>
                      <td className="mono">2.3.0+cu121</td>
                      <td><span className="badge badge-blue">Python</span></td>
                      <td className="mono text-dim">2.8 GB</td>
                      <td>Tất cả</td>
                      <td><span className="badge badge-green">✓ Ổn định</span></td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">Xformers</span></td>
                      <td className="mono">0.0.26</td>
                      <td><span className="badge badge-blue">Python</span></td>
                      <td className="mono text-dim">0.8 GB</td>
                      <td>ComfyUI, A1111</td>
                      <td><span className="badge badge-green">✓ Ổn định</span></td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">TensorRT</span></td>
                      <td className="mono">10.2.0</td>
                      <td><span className="badge badge-amber">System</span></td>
                      <td className="mono text-dim">1.2 GB</td>
                      <td>Flux, SDXL</td>
                      <td><span className="badge badge-amber">⚠ Cần test</span></td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">FFmpeg</span></td>
                      <td className="mono">6.1.1</td>
                      <td><span className="badge badge-amber">System</span></td>
                      <td className="mono text-dim">0.4 GB</td>
                      <td>Video AI, Blender</td>
                      <td><span className="badge badge-green">✓ Ổn định</span></td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">CUDA Toolkit</span></td>
                      <td className="mono">12.4</td>
                      <td><span className="badge badge-amber">System</span></td>
                      <td className="mono text-dim">3.1 GB</td>
                      <td>Tất cả</td>
                      <td><span className="badge badge-green">✓ Ổn định</span></td>
                    </tr>
                    <tr>
                      <td><span className="fw-600">OpenCV (Headless)</span></td>
                      <td className="mono">4.9.0</td>
                      <td><span className="badge badge-blue">Python</span></td>
                      <td className="mono text-dim">0.6 GB</td>
                      <td>Video AI</td>
                      <td><span className="badge badge-red">✕ Xung đột</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            
            <div className="card" style={{ marginTop: '12px' }}>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="stat-label" style={{ marginBottom: '0' }}>🛠️ Gói đang xung đột:</span>
                <span className="badge badge-red">OpenCV 4.9.0</span>
                <span className="text-dim">→ Gây lỗi với <strong>TorchVision 0.18</strong>. Cần downgrade xuống 4.8.1</span>
                <button className="badge badge-blue" style={{ cursor: 'pointer', padding: '4px 12px' }} onClick={() => { if (typeof window !== 'undefined') (0, eval)("alert('Đã gửi yêu cầu fix lỗi xung đột!')"); }}>🔧 Fix tự động</button>
              </div>
            </div>
          </div>
        
          
          <div style={{ marginTop: '30px', borderTop: '1px solid #1E1E2E', paddingTop: '16px', display: 'flex', justifyContent: 'space-between', color: '#44445A', fontSize: '12px' }}>
            <span>GPU Vietnam Admin · Tài nguyên nguyên mềm</span>
            <span>Cập nhật: 16/06/2026 16:10:22</span>
          </div>
        </div>
      </>
    </>
  );
}

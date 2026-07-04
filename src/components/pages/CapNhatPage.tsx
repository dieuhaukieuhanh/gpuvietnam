import Head from 'next/head';
import { styles } from '@/styles/pages/cap-nhat-nen-tang.styles';


export default function CapNhatPage() {
  return (
    <>
      <Head>
        <title>GPUVietnam – Cập nhật nền tảng</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>
      <>
        <aside className="sidebar">
                <a href="#" className="sidebar-logo">
                    <span className="logo-icon">⚡</span>
                    <span>GPUVietnam</span>
                </a>
                <nav className="sidebar-nav">
                    <a href="#" className="sidebar-item">
                        <span className="icon">🎛️</span> <span>Dashboard</span>
                    </a>
                    <div className="sidebar-divider"></div>
                    <a href="#" className="sidebar-item">
                        <span className="icon">📁</span> <span>Workflow</span>
                    </a>
                    <a href="#" className="sidebar-item">
                        <span className="icon">🧩</span> <span>Model & LoRA</span>
                    </a>
                    <a href="#" className="sidebar-item">
                        <span className="icon">💾</span> <span>Bộ nhớ</span>
                    </a>
                    <a href="#" className="sidebar-item">
                        <span className="icon">📜</span> <span>Lịch sử</span>
                    </a>
                    <div className="sidebar-divider"></div>
                    <a href="#" className="sidebar-item">
                        <span className="icon">⚙️</span> <span>Cài đặt</span>
                    </a>
                    <a href="#" className="sidebar-item">
                        <span className="icon">❓</span> <span>Hỗ trợ</span>
                    </a>
                    <div className="sidebar-divider"></div>
                    <a href="#" className="sidebar-item logout">
                        <span className="icon">🚪</span> <span>Đăng xuất</span>
                    </a>
                </nav>
            </aside>
        
            
            <header className="header">
                <div className="header-left">
                    Xin chào, <strong>Linh</strong>
                </div>
                <div className="header-right">
                    <button className="btn btn-accent">⚡ Nạp giờ</button>
                </div>
            </header>
        
            
            <main className="main-content">
                <h1 className="page-title">📢 Cập nhật nền tảng</h1>
                <p className="page-subtitle">Những thay đổi, cải tiến và tính năng mới trên GPUVietnam</p>
        
                
                <div className="timeline">
        
                    
                    <div className="timeline-month">
                        <div className="timeline-marker">6</div>
                        <div className="timeline-date">Tháng 6, 2026</div>
                        <div className="update-list">
        
                            <div className="update-item">
                                <div className="update-icon feature">✨</div>
                                <div className="update-content">
                                    <span className="update-tag feature">Tính năng mới</span>
                                    <div className="update-title">Trợ lý Cá nhân — Trợ lý AI tích hợp sẵn trong môi trường làm việc</div>
                                    <div className="update-desc">Trợ lý AI giúp bạn xử lý lỗi, gợi ý workflow và tối ưu hiệu suất. Luôn sẵn sàng khi bạn cần, tự động tạm dừng khi bạn đang xử lý tác vụ nặng để đảm bảo hiệu suất tốt nhất.</div>
                                </div>
                            </div>
        
                            <div className="update-item">
                                <div className="update-icon feature">✨</div>
                                <div className="update-content">
                                    <span className="update-tag feature">Tính năng mới</span>
                                    <div className="update-title">Tab Model & LoRA — Quản lý model và LoRA trực quan</div>
                                    <div className="update-desc">Dễ dàng xem, tải lên và quản lý toàn bộ model và LoRA của bạn trong một giao diện duy nhất. Phân biệt rõ ràng giữa model hệ thống và model cá nhân.</div>
                                </div>
                            </div>
        
                            <div className="update-item">
                                <div className="update-icon feature">✨</div>
                                <div className="update-content">
                                    <span className="update-tag feature">Tính năng mới</span>
                                    <div className="update-title">Hệ thống Backup — Dữ liệu an toàn, không lo mất khi tắt máy</div>
                                    <div className="update-desc">Dữ liệu của bạn được tự động sao lưu định kỳ. Có thể truy cập Backup ngay cả khi máy tắt. Dữ liệu được lưu trữ an toàn ngay cả sau khi hết hạn gói.</div>
                                </div>
                            </div>
        
                            <div className="update-item">
                                <div className="update-icon improve">🔧</div>
                                <div className="update-content">
                                    <span className="update-tag improve">Cải tiến</span>
                                    <div className="update-title">Tăng dung lượng Backup mặc định cho gói Pro lên 20GB</div>
                                    <div className="update-desc">Gói Pro giờ đây có 20GB Backup mặc định, gấp đôi so với trước đây. Gói Studio được tăng lên 50GB.</div>
                                </div>
                            </div>
        
                            <div className="update-item">
                                <div className="update-icon improve">🔧</div>
                                <div className="update-content">
                                    <span className="update-tag improve">Cải tiến</span>
                                    <div className="update-title">Tối ưu tốc độ khởi động máy</div>
                                    <div className="update-desc">Thời gian khởi động máy giảm 30% nhờ tối ưu hóa quy trình khởi tạo môi trường. Giờ đây bạn chỉ mất khoảng 2 phút để bắt đầu làm việc.</div>
                                </div>
                            </div>
        
                            <div className="update-item">
                                <div className="update-icon model">🎨</div>
                                <div className="update-content">
                                    <span className="update-tag model">Model mới</span>
                                    <div className="update-title">Flux.1 Dev — Model tạo ảnh chất lượng cao nhất hiện nay</div>
                                    <div className="update-desc">Flux.1 Dev được tích hợp sẵn trên tất cả các gói. Tạo ảnh với chất lượng vượt trội, đặc biệt là ảnh chân dung và sản phẩm thương mại.</div>
                                </div>
                            </div>
        
                            <div className="update-item">
                                <div className="update-icon model">🎨</div>
                                <div className="update-content">
                                    <span className="update-tag model">Model mới</span>
                                    <div className="update-title">LoRA Người Việt Nam v2 — Tạo ảnh người Việt chân thực hơn</div>
                                    <div className="update-desc">Phiên bản mới của LoRA Người Việt Nam với độ chính xác cao hơn, giúp tạo ra những bức ảnh người Việt tự nhiên và chân thực hơn.</div>
                                </div>
                            </div>
        
                            <div className="update-item">
                                <div className="update-icon fix">🛠️</div>
                                <div className="update-content">
                                    <span className="update-tag fix">Sửa lỗi</span>
                                    <div className="update-title">Khắc phục lỗi mất kết nối khi render video dài</div>
                                    <div className="update-desc">Đã sửa lỗi khiến một số phiên render video AI bị ngắt kết nối sau 10 phút. Giờ đây bạn có thể render video dài mà không lo bị gián đoạn.</div>
                                </div>
                            </div>
        
                        </div>
                    </div>
        
                    
                    <div className="timeline-month">
                        <div className="timeline-marker">5</div>
                        <div className="timeline-date">Tháng 5, 2026</div>
                        <div className="update-list">
        
                            <div className="update-item">
                                <div className="update-icon feature">✨</div>
                                <div className="update-content">
                                    <span className="update-tag feature">Tính năng mới</span>
                                    <div className="update-title">Ra mắt gói Studio — 2x RTX 4090, 48GB VRAM</div>
                                    <div className="update-desc">Gói Studio được thiết kế dành riêng cho Agency và Studio chuyên nghiệp. Với 2 GPU riêng biệt, nhiều người có thể làm việc cùng lúc mà không ảnh hưởng đến hiệu suất.</div>
                                </div>
                            </div>
        
                            <div className="update-item">
                                <div className="update-icon feature">✨</div>
                                <div className="update-content">
                                    <span className="update-tag feature">Tính năng mới</span>
                                    <div className="update-title">Template "Commerce & Product" — Tạo ảnh sản phẩm chuyên nghiệp</div>
                                    <div className="update-desc">Template mới với đầy đủ công cụ xóa phông tự động, IC-Light relight, và workflow tối ưu cho ảnh sản phẩm thương mại.</div>
                                </div>
                            </div>
        
                            <div className="update-item">
                                <div className="update-icon improve">🔧</div>
                                <div className="update-content">
                                    <span className="update-tag improve">Cải tiến</span>
                                    <div className="update-title">Cập nhật giao diện Dashboard — Trực quan và dễ sử dụng hơn</div>
                                    <div className="update-desc">Dashboard được thiết kế lại với bố cục dạng lưới thẻ (card grid), giúp bạn dễ dàng theo dõi thông tin máy chủ, hiệu suất và bộ nhớ trong một cái nhìn duy nhất.</div>
                                </div>
                            </div>
        
                        </div>
                    </div>
        
                    
                    <div className="timeline-month">
                        <div className="timeline-marker">4</div>
                        <div className="timeline-date">Tháng 4, 2026</div>
                        <div className="update-list">
        
                            <div className="update-item">
                                <div className="update-icon feature">✨</div>
                                <div className="update-content">
                                    <span className="update-tag feature">Tính năng mới</span>
                                    <div className="update-title">GPUVietnam chính thức hoạt động</div>
                                    <div className="update-desc">Ra mắt nền tảng với 3 gói dịch vụ (Starter, Pro, Studio), 6 template môi trường làm việc được thiết lập sẵn, và hệ thống thanh toán nội địa linh hoạt.</div>
                                </div>
                            </div>
        
                        </div>
                    </div>
        
                </div>
        
                
                <div className="subscribe-box">
                    <h3>📧 Nhận thông báo khi có cập nhật mới</h3>
                    <p>Đăng ký nhận thông báo qua Email hoặc Zalo mỗi khi có tính năng mới, model mới hoặc cải tiến quan trọng.</p>
                    <div className="subscribe-form">
                        <input type="email" className="subscribe-input" placeholder="Nhập email của bạn..." />
                        <button className="btn btn-primary">Đăng ký</button>
                    </div>
                </div>
        
                
                <div className="footer">
                    <p>© 2026 GPUVietnam. Tất cả quyền được bảo lưu. | <a href="#">Trang chủ</a> | <a href="#">Dashboard</a> | <a href="#">Hỗ trợ</a></p>
                </div>
        
            </main>
      </>
    </>
  );
}

import Head from 'next/head';
import PublicHeader from '@/components/layout/PublicHeader';
import { routes } from '@/lib/routes';
import { styles } from '@/styles/pages/about-us.styles';


export default function AboutUsPage() {
  return (
    <>
      <Head>
        <title>Về GPUVietnam — Nền tảng đắc lực cho sức mạnh sáng tạo của bạn</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>
      <>
        <PublicHeader activeHref={routes.about} />
        
            
            <main className="page-content">
                <div className="container">
        
                    
                    <h1 className="page-title">
                        Về <span className="highlight">GPUVietnam</span>
                    </h1>
        
                    
                    <div className="intro-section">
                        <div className="belief">
                            <p>GPUVietnam ra đời với một niềm tin: <strong>Sức mạnh sáng tạo không nên bị giới hạn bởi chi phí hạ tầng đắt đỏ, hay những rào cản kỹ thuật phức tạp.</strong></p>
                        </div>
                    </div>
        
                    
                    <div className="story-section">
                        <h2>Chúng tôi là ai?</h2>
                        <p>
                            Chúng tôi là một hạ tầng tích hợp, được thiết kế là một nền tảng chuyên dụng cho sáng tạo và sản xuất các nội dung từ AI. Nền tảng của chúng tôi được tối ưu là môi trường làm việc và tăng năng suất sản xuất nội dung cho các chuyên gia, đội ngũ AI Art, Studio và Agency.
                        </p>
                        <p>
                            GPUVietnam là trạm làm việc trên mây — nơi mọi ý tưởng sáng tạo đều có thể được hiện thực hóa ngay lập tức, với hiệu suất cao nhất.
                        </p>
        
                        <h2>Sự thấu hiểu của chúng tôi</h2>
                        <p>
                            Chúng tôi thấu hiểu nhu cầu và những đặc thù nghề nghiệp rất riêng trong lĩnh vực sáng tạo nội dung số. Những nhà sáng tạo chuyên nghiệp cần nhiều hơn một cỗ máy mạnh mẽ.
                        </p>
                        <p>
                            Một môi trường làm việc được chuẩn bị sẵn sàng, một quy trình được tinh giản đến mức tối đa bên trong một cỗ máy mạnh mẽ và tin cậy — để bạn toàn tâm toàn ý cho công việc sáng tạo, đưa sản phẩm đến với khách hàng một cách nhanh chóng nhất, đồng thời phục vụ được nhu cầu ngày càng lớn với yêu cầu cao hơn trong lĩnh vực nội dung số.
                        </p>
                    </div>
        
                    
                    <h2 style={{ fontSize: '24px', fontFamily: '\'Space Grotesk\', sans-serif', fontWeight: '700', marginBottom: '20px', textAlign: 'center' }}>Giá trị cốt lõi của chúng tôi</h2>
                    <div className="values-grid">
                        <div className="value-card">
                            <div className="value-icon">⚡</div>
                            <h3>Đơn giản</h3>
                            <p>Mọi thứ đã được thiết lập sẵn. Bạn chỉ việc chọn nhu cầu và bắt đầu sáng tạo.</p>
                        </div>
                        <div className="value-card">
                            <div className="value-icon">🔧</div>
                            <h3>Chuyên biệt</h3>
                            <p>Được thiết kế riêng cho AI Art, Studio và Agency — không phải một dịch vụ chung chung.</p>
                        </div>
                        <div className="value-card">
                            <div className="value-icon">🤝</div>
                            <h3>Đồng hành</h3>
                            <p>Thấu hiểu nghề nghiệp của bạn, chúng tôi là đối tác tin cậy trên hành trình sáng tạo.</p>
                        </div>
                    </div>
        
                    
                    <div className="closing-section">
                        <h2>Đơn giản, mạnh mẽ, sẵn sàng</h2>
                        <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            Tại GPUVietnam, chúng tôi làm mọi thứ trở nên đơn giản đối với nhà sáng tạo. Bạn chọn nhu cầu, chúng tôi cung cấp công cụ và sức mạnh. Mọi thứ đã được thiết lập sẵn — bạn chỉ việc bắt đầu.
                        </p>
                        <p className="tagline">GPUVietnam — Nền tảng đắc lực cho sức mạnh sáng tạo của bạn.</p>
                    </div>
        
                </div>
            </main>
        
            
            <footer className="footer">
                <div className="container">
                    <div className="footer-links">
                        <a href="#">Trang chủ</a>
                        <a href="#">Bảng giá</a>
                        <a href="#">Cập nhật</a>
                        <a href="#">Về chúng tôi</a>
                        <a href="#">Hỗ trợ</a>
                        <a href="#">Chính sách bảo mật</a>
                    </div>
                    <p className="copyright">© 2026 GPUVietnam. Tất cả quyền được bảo lưu. | cskh@gpuvietnam.com</p>
                </div>
            </footer>
      </>
    </>
  );
}

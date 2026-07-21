import Head from 'next/head';
import PublicHeader from '@/components/layout/PublicHeader';
import { styles } from '@/styles/pages/chinh-sach-bao-mat.styles';


export default function ChinhSachPage() {
  return (
    <>
      <Head>
        <title>Chính sách Bảo mật — GPUVietnam</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>
      <>
        <PublicHeader />
        
            
            <main className="main-content">
                <div className="container">
                    <h1 className="page-title">🔒 Chính sách Bảo mật</h1>
                    <p className="page-subtitle">Cập nhật lần cuối: 06/2026</p>
        
                    <p style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: '1.8', marginBottom: '36px' }}>
                        GPUVietnam ("chúng tôi", "nền tảng") cam kết bảo vệ quyền riêng tư và dữ liệu của bạn ("khách hàng", "người dùng"). Chính sách này giải thích cách chúng tôi thu thập, sử dụng và bảo vệ thông tin của bạn khi bạn sử dụng dịch vụ tại GPUVietnam.
                    </p>
        
                    
                    <div className="section">
                        <h2><span className="num">1</span> Thông tin chúng tôi thu thập</h2>
                        <table className="info-table">
                            <thead>
                                <tr>
                                    <th>Loại thông tin</th>
                                    <th>Mục đích thu thập</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>Thông tin tài khoản</td>
                                    <td>Họ tên, email, số điện thoại — dùng để tạo và quản lý tài khoản, xác thực người dùng, hỗ trợ khách hàng, gửi thông báo về dịch vụ.</td>
                                </tr>
                                <tr>
                                    <td>Dữ liệu sử dụng</td>
                                    <td>Lịch sử phiên làm việc, thời gian sử dụng, gói dịch vụ đã đăng ký — dùng để vận hành dịch vụ, tính toán chi phí, cải thiện trải nghiệm người dùng.</td>
                                </tr>
                                <tr>
                                    <td>Dữ liệu sáng tạo</td>
                                    <td>Model, LoRA, workflow và output (ảnh, video) bạn tạo ra trên nền tảng. <strong>Đây là tài sản sáng tạo của bạn.</strong> Chúng tôi lưu trữ để phục vụ quá trình làm việc của bạn và thực hiện sao lưu theo yêu cầu.</td>
                                </tr>
                                <tr>
                                    <td>Thông tin thanh toán</td>
                                    <td>Lịch sử giao dịch, số dư Ví Nạp Trước — dùng để xử lý thanh toán, đối soát, và quản lý tài chính.</td>
                                </tr>
                                <tr>
                                    <td>Dữ liệu kỹ thuật</td>
                                    <td>Địa chỉ IP, loại trình duyệt, nhật ký truy cập — dùng để bảo mật hệ thống, chẩn đoán lỗi, và ngăn chặn gian lận.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
        
                    
                    <div className="section">
                        <h2><span className="num">2</span> Cách chúng tôi sử dụng thông tin</h2>
                        <p>Chúng tôi chỉ sử dụng thông tin của bạn cho các mục đích sau:</p>
                        <ul>
                            <li>Cung cấp, vận hành và duy trì dịch vụ.</li>
                            <li>Xác thực tài khoản và ngăn chặn lạm dụng khuyến mại.</li>
                            <li>Gửi thông báo quan trọng về tài khoản, gói dịch vụ, và các bản cập nhật nền tảng.</li>
                            <li>Phân tích xu hướng sử dụng để cải thiện chất lượng dịch vụ.</li>
                            <li>Tuân thủ các nghĩa vụ pháp lý khi được yêu cầu.</li>
                        </ul>
                        <div className="highlight-box">
                            <p>🔐 <strong>Cam kết:</strong> Chúng tôi <strong>không</strong> bán, cho thuê, hoặc chia sẻ dữ liệu cá nhân và dữ liệu sáng tạo của bạn với bất kỳ bên thứ ba nào vì mục đích thương mại.</p>
                        </div>
                    </div>
        
                    
                    <div className="section">
                        <h2><span className="num">3</span> Dữ liệu sáng tạo của bạn</h2>
                        <p>Chúng tôi hiểu rằng model, LoRA, workflow và output là thành quả lao động của bạn.</p>
                        <ul>
                            <li><strong>Quyền sở hữu:</strong> Bạn giữ toàn bộ quyền sở hữu đối với mọi dữ liệu sáng tạo mà bạn tạo ra hoặc tải lên nền tảng.</li>
                            <li><strong>Tính riêng tư:</strong> Mỗi khách hàng có máy/phiên làm việc riêng. Khách khác — kể cả cùng loại gói — không thể truy cập dữ liệu của bạn trừ khi bạn chủ động chia sẻ.</li>
                            <li><strong>Sao lưu và lưu trữ:</strong> Dữ liệu của bạn được sao lưu định kỳ để đảm bảo an toàn. Thời gian lưu trữ sau khi hết hạn gói được quy định rõ ràng: Starter 7 ngày, Pro 30 ngày, Studio 90 ngày.</li>
                        </ul>
                    </div>
        
                    
                    <div className="section">
                        <h2><span className="num">4</span> Bảo mật dữ liệu</h2>
                        <p>Chúng tôi áp dụng các biện pháp kỹ thuật và tổ chức phù hợp để bảo vệ thông tin của bạn khỏi truy cập trái phép, mất mát, hoặc thay đổi. Các biện pháp này bao gồm:</p>
                        <ul>
                            <li>Mã hóa dữ liệu trên đường truyền.</li>
                            <li>Phân quyền truy cập nghiêm ngặt trong đội ngũ vận hành.</li>
                            <li>Giám sát hệ thống 24/7 để phát hiện và ngăn chặn các hành vi xâm nhập.</li>
                            <li>Sao lưu dữ liệu định kỳ để đảm bảo khả năng khôi phục.</li>
                        </ul>
                    </div>
        
                    
                    <div className="section">
                        <h2><span className="num">5</span> Lưu trữ và xóa dữ liệu</h2>
                        <ul>
                            <li>Chúng tôi lưu trữ thông tin tài khoản của bạn trong suốt thời gian bạn sử dụng dịch vụ.</li>
                            <li>Khi gói dịch vụ hết hạn, dữ liệu sáng tạo của bạn sẽ được giữ lại theo chính sách: <strong>Starter 7 ngày, Pro 30 ngày, Studio 90 ngày</strong>. Trước khi dữ liệu bị xóa, chúng tôi sẽ gửi thông báo để bạn có cơ hội gia hạn và giữ lại dữ liệu.</li>
                            <li>Bạn có thể yêu cầu xóa toàn bộ dữ liệu của mình bất cứ lúc nào bằng cách liên hệ với chúng tôi qua Zalo hoặc Email.</li>
                        </ul>
                    </div>
        
                    
                    <div className="section">
                        <h2><span className="num">6</span> Quyền của bạn</h2>
                        <p>Bạn có quyền:</p>
                        <ul>
                            <li>Truy cập và chỉnh sửa thông tin cá nhân của mình trong Tab Cài đặt.</li>
                            <li>Yêu cầu chúng tôi xóa toàn bộ hoặc một phần dữ liệu của bạn.</li>
                            <li>Từ chối nhận thông báo tiếp thị (bạn vẫn sẽ nhận được thông báo quan trọng về tài khoản).</li>
                            <li>Yêu cầu chúng tôi cung cấp bản sao dữ liệu của bạn.</li>
                        </ul>
                    </div>
        
                    
                    <div className="section">
                        <h2><span className="num">7</span> Thay đổi chính sách</h2>
                        <p>Chúng tôi có thể cập nhật Chính sách Bảo mật này theo thời gian. Mọi thay đổi sẽ được thông báo qua email hoặc trên trang Cập nhật nền tảng. Việc bạn tiếp tục sử dụng dịch vụ sau khi có thay đổi đồng nghĩa với việc bạn chấp nhận chính sách mới.</p>
                    </div>
        
                    
                    <div className="contact-box">
                        <h3>📬 Liên hệ</h3>
                        <p>Nếu bạn có bất kỳ câu hỏi nào về Chính sách Bảo mật này, vui lòng liên hệ với chúng tôi:</p>
                        <div className="contact-info">
                            <span>📱 <strong>Zalo:</strong> 09xxxxxxx</span>
                            <span>📧 <strong>Email:</strong> hello@gpuvietnam.com</span>
                        </div>
                    </div>
        
                    
                    <p className="closing-tagline">GPUVietnam — Tôn trọng quyền riêng tư của bạn, bảo vệ thành quả sáng tạo của bạn.</p>
        
                </div>
            </main>
        
            
            <footer className="footer">
                <div className="container">
                    <div className="footer-links">
                        <a href="#">Trang chủ</a>
                        <a href="#">Bảng giá</a>
                        <a href="#">Cập nhật</a>
                        <a href="#">Về chúng tôi</a>
                        <a href="#">Chính sách bảo mật</a>
                        <a href="#">Hỗ trợ</a>
                    </div>
                    <p className="copyright">© 2026 GPUVietnam. Tất cả quyền được bảo lưu. | hello@gpuvietnam.com</p>
                </div>
            </footer>
      </>
    </>
  );
}

import Head from 'next/head';
import PublicHeader from '@/components/layout/PublicHeader';
import { styles } from '@/styles/pages/dieu-khoan-dich-vu.styles';


export default function DieuKhoanPage() {
  return (
    <>
      <Head>
        <title>Điều khoản Dịch vụ — GPUVietnam</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>
      <>
        <PublicHeader />
        
            
            <main className="main-content">
                <div className="container">
                    <h1 className="page-title">📋 Điều khoản Dịch vụ</h1>
                    <p className="page-subtitle">Cập nhật lần cuối: 06/2026</p>
        
                    <p style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: '1.8', marginBottom: '36px' }}>
                        Chào mừng bạn đến với GPUVietnam. Bằng cách truy cập hoặc sử dụng dịch vụ của chúng tôi, bạn đồng ý tuân thủ các Điều khoản Dịch vụ này. Vui lòng đọc kỹ trước khi sử dụng.
                    </p>
        
                    
                    <div className="section">
                        <h2><span className="num">1</span> Chấp nhận Điều khoản</h2>
                        <p>Bằng cách đăng ký tài khoản hoặc sử dụng bất kỳ dịch vụ nào của GPUVietnam, bạn xác nhận rằng bạn đã đọc, hiểu và đồng ý bị ràng buộc bởi các Điều khoản này. Nếu bạn không đồng ý, vui lòng không sử dụng dịch vụ.</p>
                    </div>
        
                    
                    <div className="section">
                        <h2><span className="num">2</span> Mô tả Dịch vụ</h2>
                        <p>GPUVietnam cung cấp một nền tảng hạ tầng tích hợp, được thiết kế chuyên biệt cho sáng tạo và sản xuất nội dung bằng AI. Dịch vụ của chúng tôi bao gồm môi trường làm việc được thiết lập sẵn, sức mạnh tính toán GPU, lưu trữ và sao lưu dữ liệu.</p>
                    </div>
        
                    
                    <div className="section">
                        <h2><span className="num">3</span> Tài khoản Người dùng</h2>
                        <table className="info-table">
                            <tbody>
                                <tr>
                                    <td>3.1 Đăng ký</td>
                                    <td>Bạn phải cung cấp thông tin chính xác, đầy đủ khi đăng ký tài khoản. Mỗi cá nhân chỉ được sở hữu một tài khoản duy nhất.</td>
                                </tr>
                                <tr>
                                    <td>3.2 Bảo mật</td>
                                    <td>Bạn chịu trách nhiệm bảo mật mật khẩu và mọi hoạt động diễn ra dưới tài khoản của mình. Vui lòng thông báo ngay cho chúng tôi nếu phát hiện truy cập trái phép.</td>
                                </tr>
                                <tr>
                                    <td>3.3 Chia sẻ tài khoản</td>
                                    <td>Mỗi tài khoản dành cho một người dùng. Không chia sẻ đăng nhập cho nhiều người dùng cùng lúc. Gói Studio là máy RTX 5090 cho một phiên làm việc nặng — không phải gói nhiều thành viên / nhiều môi trường song song.</td>
                                </tr>
                                <tr>
                                    <td>3.4 Xác thực</td>
                                    <td>Chúng tôi có quyền yêu cầu xác thực danh tính qua số điện thoại hoặc email để ngăn chặn gian lận và lạm dụng.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
        
                    
                    <div className="section">
                        <h2><span className="num">4</span> Thanh toán, Hoàn tiền và Gia hạn</h2>
                        <table className="info-table">
                            <tbody>
                                <tr>
                                    <td>4.1 Giá cả</td>
                                    <td>Tất cả giá được niêm yết bằng Đồng Việt Nam (VNĐ). Chúng tôi có quyền điều chỉnh giá và sẽ thông báo trước ít nhất 7 ngày.</td>
                                </tr>
                                <tr>
                                    <td>4.2 Ví Nạp Trước</td>
                                    <td>Bạn có thể nạp tiền vào Ví Nạp Trước để sử dụng cho các dịch vụ. Số tiền tặng thêm (chiết khấu) không được hoàn lại.</td>
                                </tr>
                                <tr>
                                    <td>4.3 Hoàn tiền</td>
                                    <td>Bạn có thể yêu cầu hoàn trả số tiền gốc chưa sử dụng trong Ví Nạp Trước. Tiền tặng thêm sẽ không được hoàn. Thời gian xử lý hoàn tiền từ 5-10 ngày làm việc.</td>
                                </tr>
                                <tr>
                                    <td>4.4 Gia hạn tự động</td>
                                    <td>Nếu bạn bật tính năng Gia hạn Tự động, gói dịch vụ sẽ được tự động gia hạn từ số dư Ví Nạp Trước khi đến hạn. Bạn có thể tắt tính năng này bất cứ lúc nào.</td>
                                </tr>
                                <tr>
                                    <td>4.5 Hết hạn gói</td>
                                    <td>Khi gói dịch vụ hết hạn, dữ liệu của bạn sẽ được lưu trữ theo chính sách: Starter 7 ngày, Pro 30 ngày, Studio 90 ngày. Sau thời gian này, dữ liệu sẽ bị xóa vĩnh viễn.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
        
                    
                    <div className="section">
                        <h2><span className="num">5</span> Sử dụng Hợp lý và Các Hành vi bị Nghiêm cấm</h2>
                        <p>Đây là điều khoản quan trọng để bảo vệ nền tảng khỏi các hoạt động có hại. Dịch vụ của chúng tôi được thiết kế cho sáng tạo nội dung AI Art, Studio và Agency. Mọi mục đích sử dụng khác phải được thông báo và chấp thuận.</p>
        
                        
                        <div className="danger-box">
                            <h3>🚫 A. Hoạt động gây hại đến danh tiếng và hạ tầng mạng</h3>
                            <div className="prohibited-list">
                                <div className="prohibited-item">
                                    <div className="prohibited-icon">🚫</div>
                                    <div className="prohibited-content">
                                        <h4>Chạy IP ồ ạt, MMO, SEO spam</h4>
                                        <p>Sử dụng GPU để tạo hàng loạt tài khoản ảo, chạy bot, spam, hoặc bất kỳ hoạt động MMO (Make Money Online) nào gây ảnh hưởng đến địa chỉ IP của nền tảng, có nguy cơ đưa GPUVietnam vào danh sách đen (blacklist) của Google và các tổ chức quốc tế.</p>
                                    </div>
                                </div>
                                <div className="prohibited-item">
                                    <div className="prohibited-icon">📧</div>
                                    <div className="prohibited-content">
                                        <h4>Gửi thư rác (Spam)</h4>
                                        <p>Sử dụng dịch vụ để gửi email spam, tin nhắn spam, bình luận spam dưới mọi hình thức.</p>
                                    </div>
                                </div>
                                <div className="prohibited-item">
                                    <div className="prohibited-icon">🖥️</div>
                                    <div className="prohibited-content">
                                        <h4>Tấn công mạng</h4>
                                        <p>Sử dụng GPU để thực hiện tấn công DDoS, brute-force, hoặc bất kỳ hoạt động xâm nhập trái phép nào.</p>
                                    </div>
                                </div>
                                <div className="prohibited-item">
                                    <div className="prohibited-icon">🦠</div>
                                    <div className="prohibited-content">
                                        <h4>Lưu trữ/phát tán nội dung độc hại</h4>
                                        <p>Tải lên, lưu trữ hoặc phát tán virus, trojan, ransomware hoặc bất kỳ phần mềm độc hại nào.</p>
                                    </div>
                                </div>
                                <div className="prohibited-item">
                                    <div className="prohibited-icon">©️</div>
                                    <div className="prohibited-content">
                                        <h4>Vi phạm bản quyền</h4>
                                        <p>Sử dụng dịch vụ để tạo, lưu trữ hoặc phân phối nội dung vi phạm bản quyền, thương hiệu hoặc quyền sở hữu trí tuệ của bên thứ ba.</p>
                                    </div>
                                </div>
                                <div className="prohibited-item">
                                    <div className="prohibited-icon">⛏️</div>
                                    <div className="prohibited-content">
                                        <h4>Hoạt động khai thác tiền mã hóa</h4>
                                        <p>Sử dụng GPU để đào (mining) tiền mã hóa dưới mọi hình thức.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
        
                        
                        <div className="danger-box">
                            <h3>⚖️ B. Hoạt động gây rủi ro pháp lý</h3>
                            <div className="prohibited-list">
                                <div className="prohibited-item">
                                    <div className="prohibited-icon">🔞</div>
                                    <div className="prohibited-content">
                                        <h4>Tạo nội dung bất hợp pháp</h4>
                                        <p>Sử dụng AI để tạo nội dung vi phạm pháp luật Việt Nam, bao gồm nhưng không giới hạn: nội dung khiêu dâm trẻ em, nội dung khủng bố, nội dung kích động thù địch, nội dung lừa đảo.</p>
                                    </div>
                                </div>
                                <div className="prohibited-item">
                                    <div className="prohibited-icon">🎭</div>
                                    <div className="prohibited-content">
                                        <h4>Mạo danh</h4>
                                        <p>Sử dụng dịch vụ để mạo danh cá nhân, tổ chức hoặc cơ quan nhà nước.</p>
                                    </div>
                                </div>
                                <div className="prohibited-item">
                                    <div className="prohibited-icon">💸</div>
                                    <div className="prohibited-content">
                                        <h4>Rửa tiền</h4>
                                        <p>Sử dụng Ví Nạp Trước hoặc bất kỳ dịch vụ thanh toán nào của GPUVietnam cho mục đích rửa tiền hoặc tài trợ khủng bố.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
        
                        
                        <div className="warning-box">
                            <h3>⚠️ C. Hoạt động gây ảnh hưởng đến chất lượng dịch vụ</h3>
                            <div className="prohibited-list">
                                <div className="prohibited-item">
                                    <div className="prohibited-icon">📊</div>
                                    <div className="prohibited-content">
                                        <h4>Lạm dụng tài nguyên</h4>
                                        <p>Cố ý chiếm dụng GPU ở mức tối đa liên tục gây ảnh hưởng đến khả năng cung cấp dịch vụ cho khách hàng khác.</p>
                                    </div>
                                </div>
                                <div className="prohibited-item">
                                    <div className="prohibited-icon">🔓</div>
                                    <div className="prohibited-content">
                                        <h4>Vượt qua giới hạn kỹ thuật</h4>
                                        <p>Cố gắng vượt qua các giới hạn về bảo mật, tài nguyên hoặc truy cập mà chúng tôi thiết lập.</p>
                                    </div>
                                </div>
                                <div className="prohibited-item">
                                    <div className="prohibited-icon">🐛</div>
                                    <div className="prohibited-content">
                                        <h4>Khai thác lỗ hổng</h4>
                                        <p>Khai thác các lỗi hoặc lỗ hổng kỹ thuật của nền tảng để trục lợi.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
        
                    
                    <div className="section">
                        <h2><span className="num">6</span> Giới hạn Trách nhiệm</h2>
                        <table className="info-table">
                            <tbody>
                                <tr>
                                    <td>6.1 Dịch vụ "như hiện trạng"</td>
                                    <td>Dịch vụ được cung cấp trên cơ sở "như hiện trạng". Chúng tôi nỗ lực duy trì uptime nhưng không đảm bảo dịch vụ không bị gián đoạn.</td>
                                </tr>
                                <tr>
                                    <td>6.2 Mất dữ liệu</td>
                                    <td>Chúng tôi không chịu trách nhiệm về mất mát dữ liệu do các sự kiện ngoài tầm kiểm soát (thiên tai, tấn công mạng quy mô lớn). Tuy nhiên, chúng tôi cam kết thực hiện sao lưu định kỳ và hỗ trợ khôi phục trong khả năng tối đa.</td>
                                </tr>
                                <tr>
                                    <td>6.3 Thiệt hại gián tiếp</td>
                                    <td>GPUVietnam không chịu trách nhiệm về các thiệt hại gián tiếp, ngẫu nhiên hoặc hệ quả phát sinh từ việc sử dụng dịch vụ.</td>
                                </tr>
                                <tr>
                                    <td>6.4 Tổng trách nhiệm</td>
                                    <td>Tổng trách nhiệm của GPUVietnam đối với bất kỳ khiếu nại nào sẽ không vượt quá số tiền bạn đã thanh toán trong 3 tháng gần nhất.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
        
                    
                    <div className="section">
                        <h2><span className="num">7</span> Sở hữu Trí tuệ</h2>
                        <table className="info-table">
                            <tbody>
                                <tr>
                                    <td>7.1 Nội dung của bạn</td>
                                    <td>Bạn giữ toàn bộ quyền sở hữu đối với output (ảnh, video) và tài liệu bạn tạo ra trên nền tảng.</td>
                                </tr>
                                <tr>
                                    <td>7.2 Nền tảng</td>
                                    <td>GPUVietnam giữ toàn bộ quyền sở hữu đối với nền tảng, bao gồm code, thiết kế, logo và thương hiệu.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
        
                    
                    <div className="section">
                        <h2><span className="num">8</span> Chấm dứt Dịch vụ</h2>
                        <table className="info-table">
                            <tbody>
                                <tr>
                                    <td>8.1 Chấm dứt bởi bạn</td>
                                    <td>Bạn có thể ngừng sử dụng dịch vụ bất cứ lúc nào.</td>
                                </tr>
                                <tr>
                                    <td>8.2 Chấm dứt bởi chúng tôi</td>
                                    <td>Chúng tôi có quyền tạm ngừng hoặc chấm dứt tài khoản của bạn ngay lập tức nếu bạn vi phạm các Điều khoản này, đặc biệt là các hành vi bị nghiêm cấm tại Mục 5.</td>
                                </tr>
                                <tr>
                                    <td>8.3 Hoàn tiền khi chấm dứt</td>
                                    <td>Nếu tài khoản bị chấm dứt do vi phạm, bạn sẽ không được hoàn trả bất kỳ khoản phí nào đã thanh toán.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
        
                    
                    <div className="section">
                        <h2><span className="num">9</span> Thay đổi Điều khoản</h2>
                        <p>Chúng tôi có quyền cập nhật Điều khoản Dịch vụ này theo thời gian. Mọi thay đổi sẽ được thông báo qua email hoặc trên trang Cập nhật nền tảng ít nhất 7 ngày trước khi có hiệu lực. Việc bạn tiếp tục sử dụng dịch vụ sau khi thay đổi có hiệu lực đồng nghĩa với việc bạn chấp nhận điều khoản mới.</p>
                    </div>
        
                    
                    <div className="contact-box">
                        <h3>📬 Liên hệ</h3>
                        <p>Nếu bạn có bất kỳ câu hỏi nào về Điều khoản Dịch vụ, vui lòng liên hệ với chúng tôi:</p>
                        <div className="contact-info">
                            <span>📱 <strong>Zalo:</strong> 09xxxxxxx</span>
                            <span>📧 <strong>Email:</strong> cskh@gpuvietnam.com</span>
                        </div>
                    </div>
        
                    
                    <p className="closing-tagline">GPUVietnam — Sáng tạo có trách nhiệm, đồng hành bền vững.</p>
        
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
                        <a href="#">Điều khoản dịch vụ</a>
                        <a href="#">Hỗ trợ</a>
                    </div>
                    <p className="copyright">© 2026 GPUVietnam. Tất cả quyền được bảo lưu. | cskh@gpuvietnam.com</p>
                </div>
            </footer>
      </>
    </>
  );
}

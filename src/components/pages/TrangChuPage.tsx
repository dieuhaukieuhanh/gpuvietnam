import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import PublicHeader from '@/components/layout/PublicHeader';
import HomePricingSection from '@/components/pricing/HomePricingSection';
import WorkstationCard from '@/components/workstations/WorkstationCard';
import { useAuth } from '@/contexts/AuthContext';
import { useActivePlanGate } from '@/hooks/useActivePlanGate';
import { usePageStyles } from '@/hooks/usePageStyles';
import { useTrialWorkstationModal } from '@/hooks/useTrialWorkstationModal';
import { routes } from '@/lib/routes';
import { initTrangChu } from '@/lib/scripts/trang-chu';
import { WORKSTATION_FILTERS, WORKSTATIONS, type Workstation } from '@/lib/workstations';
import { styles } from '@/styles/pages/trang-chu.styles';

function contactCustomWorkstation() {
  alert(
    '🎯 Workstation Theo Yêu Cầu\n\n📱 Nhắn Zalo: 0961 862 141 mô tả nhu cầu của bạn.\nChúng tôi sẽ tạo môi trường riêng trong 24h — miễn phí setup.',
  );
}

function TrialCtaSection({
  isLoggedIn,
  onFreeWorkspaceClick,
}: {
  isLoggedIn: boolean;
  onFreeWorkspaceClick: () => void;
}) {
  return (
    <section className="cta-section">
      <div className="container">
        <h3>Bạn đã sẵn sàng trải nghiệm hạ tầng chuyên dụng cho AI Art ▪ Studio?</h3>
        <p>Dùng thử 3 giờ miễn phí. Không cần thanh toán trước. Hủy bất cứ lúc nào.</p>
        {isLoggedIn ? (
          <button type="button" className="btn btn-primary btn-lg" onClick={onFreeWorkspaceClick}>
            🏠 Vào phòng làm việc miễn phí
          </button>
        ) : (
          <Link href={`${routes.register}?trial=true`} className="btn btn-primary btn-lg">
            🏠 Vào phòng làm việc miễn phí
          </Link>
        )}
      </div>
    </section>
  );
}

export default function TrangChuPage() {
  const router = useRouter();
  const { session } = useAuth();
  const { hasActivePlan, loaded: planGateLoaded, redirectIfActivePlan } = useActivePlanGate();
  const [currentFilter, setCurrentFilter] = useState('all');
  const [showWorkstationModal, setShowWorkstationModal] = useState(false);
  const { openTrialModal, trialModal } = useTrialWorkstationModal();
  const planCheckDone = planGateLoaded;
  const planCtaState = session && hasActivePlan ? 'active' : 'trial';

  usePageStyles(styles, 'trang-chu');

  useEffect(() => {
    initTrangChu();
  }, []);

  useEffect(() => {
    if (!showWorkstationModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowWorkstationModal(false);
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showWorkstationModal]);

  const openActivateModal = useCallback(async () => {
    if (await redirectIfActivePlan()) return;
    setShowWorkstationModal(true);
  }, [redirectIfActivePlan]);

  const closeWorkstationModal = useCallback(() => {
    setShowWorkstationModal(false);
  }, []);

  const goToCheckoutPlan = useCallback(
    async (name: string, icon: string, desc: string) => {
      if (await redirectIfActivePlan()) return;
      const query = `env=${encodeURIComponent(name)}&icon=${encodeURIComponent(icon)}&desc=${encodeURIComponent(desc)}`;
      router.push(`${routes.checkoutPlan}?${query}`);
    },
    [redirectIfActivePlan, router],
  );

  const handleWorkstationClick = useCallback(
    (workstation: Workstation) => {
      if (workstation.id === 6) {
        contactCustomWorkstation();
        return;
      }
      goToCheckoutPlan(workstation.name, workstation.icon, workstation.desc);
    },
    [goToCheckoutPlan],
  );

  const handleModalWorkstationSelect = useCallback(
    (workstation: Workstation) => {
      if (workstation.id === 6) {
        closeWorkstationModal();
        contactCustomWorkstation();
        return;
      }

      closeWorkstationModal();
      goToCheckoutPlan(workstation.name, workstation.icon, workstation.desc);
    },
    [closeWorkstationModal, goToCheckoutPlan],
  );

  const visibleWorkstations = WORKSTATIONS.filter(
    (w) => currentFilter === 'all' || w.filters.includes(currentFilter),
  );

  return (
    <>
      <Head>
        <title>GPUVietnam – GPU Mạnh Cho AI Art | ComfyUI Cài Sẵn</title>
      </Head>
      <style data-page="trang-chu" dangerouslySetInnerHTML={{ __html: styles }} />
      <>
        <PublicHeader onTrialClick={openTrialModal} />
        
            <section className="hero">
                <div className="container">
                    <div className="hero-eyebrow-wrap"><p className="hero-eyebrow">Hạ tầng GPU tích hợp ComfyUI • SDXL • Flux</p></div>
                    <h1>
                        <span className="hero-headline-lead">Sẵn sàng sáng tạo & sản xuất nội dung</span>
                        <span className="hero-headline-brand">
                          <span className="gradient-text">AI Art</span>
                          <span className="h1-dot-sep" aria-hidden="true"></span>
                          <span className="gradient-text">Studio</span>
                        </span>
                    </h1>
                    <div className="hero-buttons">
                        <button
                          type="button"
                          className="btn btn-primary btn-lg"
                          onClick={openActivateModal}
                        >
                          Kích hoạt chỉ 2 phút
                        </button>
                    </div>
                    <p className="subtitle-strong">
                        Thuê theo giờ hoặc Combo linh hoạt
                    </p>
                </div>
            </section>
        
            
            <section className="section section-dark" id="infrastructure">
                <div className="container">
                    <h2 className="section-title">⚡ Hạ Tầng GPU Mạnh Mẽ</h2>
                    <p className="section-subtitle">Bạn nhận được một máy chủ ảo riêng & Tích hợp chuyên dụng cho AI Art ▪ Studio</p>
                    <div className="infra-grid">
                        <div className="infra-card">
                            <div className="infra-icon">🖥️</div>
                            <h4>GPU Chuyên Dụng</h4>
                            <p className="gpu-list">RTX 3090 • RTX 4090 • 2x RTX 4090</p>
                            <p>24GB - 48GB VRAM, CUDA 12.x, driver Studio mới nhất</p>
                        </div>
                        <div className="infra-card">
                            <div className="infra-icon">⚙️</div>
                            <h4>Môi Trường Cài Sẵn</h4>
                            <p className="gpu-list">ComfyUI • A1111 • Jupyter</p>
                            <p>Model SDXL, Flux, Pony + LoRA Việt hóa đã sẵn sàng</p>
                        </div>
                        <div className="infra-card">
                            <div className="infra-icon">💾</div>
                            <h4>Lưu Trữ Bền Vững</h4>
                            <p className="gpu-list">20GB - 50GB Riêng</p>
                            <p>Tắt máy — Luồng công việc được lưu lại, dữ liệu an toàn, backup tự động</p>
                        </div>
                    </div>
                    <p className="infra-note">💡 Bạn luôn có thể cài đặt thêm plugin, upload model, chạy workflow riêng - Sử dụng cấu hình đã thiết lập, tùy chỉnh xuyên suốt quá trình sử dụng</p>
                </div>
            </section>
        
            
            <section className="section" id="workstations">
                <div className="container">
                    <h2 className="section-title">Chọn Nhu Cầu Làm Việc Của Bạn</h2>
                    <p className="section-subtitle">Chọn môi trường bạn muốn bắt đầu để khởi tạo máy</p>
                    <div className="filter-bar" id="filterBar">
                        {WORKSTATION_FILTERS.map((filter) => (
                          <button
                            key={filter.id}
                            type="button"
                            className={`filter-btn${currentFilter === filter.id ? ' active' : ''}`}
                            data-filter={filter.id}
                            onClick={() => setCurrentFilter(filter.id)}
                          >
                            {filter.label}
                          </button>
                        ))}
                    </div>
                    <div className="workstation-grid" id="workstationGrid">
                      {visibleWorkstations.length === 0 ? (
                        <div className="no-results">
                          <p>😅 Chưa có môi trường nào phù hợp với bộ lọc này.</p>
                          <p className="sub">
                            Nhắn Zalo, chúng tôi tạo môi trường riêng cho bạn trong 24h.
                          </p>
                        </div>
                      ) : (
                        visibleWorkstations.map((workstation) => (
                          <WorkstationCard
                            key={workstation.id}
                            workstation={workstation}
                            onSelect={handleWorkstationClick}
                          />
                        ))
                      )}
                    </div>
                    <div style={{ textAlign: 'center', marginTop: '28px' }}>
                        <button type="button" className="btn btn-outline" onClick={() => setCurrentFilter('all')}>Xem tất cả nhu cầu →</button>
                    </div>
                </div>
            </section>
        
            
            <HomePricingSection onStarterTrial={openTrialModal} />
        
            <section className="section" id="how-it-works">
                <div className="container">
                    <h2 className="section-title">Bắt Đầu Trong 3 Bước</h2>
                    <p className="section-subtitle">Đơn giản hơn bạn nghĩ</p>
                    <div className="steps">
                        <div className="step">
                            <div className="step-number">1</div>
                            <h4>Chọn Môi Trường</h4>
                            <p>Chọn môi trường làm việc được cài sẵn: Character, Commerce, Video, Blender, hoặc Jupyter</p>
                        </div>
                        <div className="step">
                            <div className="step-number">2</div>
                            <h4>Chọn Gói Hạ Tầng & Thanh Toán</h4>
                            <p>Đăng ký gói và thanh toán chuyển khoản ngân hàng</p>
                        </div>
                        <div className="step">
                            <div className="step-number">3</div>
                            <h4>Nhận Máy & Sáng Tạo</h4>
                            <p>Máy chủ GPU tự động khởi tạo trong 2 phút, môi trường đã mở sẵn — bạn chỉ việc làm việc</p>
                        </div>
                    </div>
                </div>
            </section>
        
            <section className="section section-dark" id="faq">
                <div className="container">
                    <h2 className="section-title">Câu Hỏi Thường Gặp</h2>
                    <p className="section-subtitle">Mọi thắc mắc của bạn đều được giải đáp</p>
                    <div className="faq-grid" id="faqGrid"></div>
                </div>
            </section>
        
            {planCheckDone &&
              (planCtaState === 'active' ? (
                <section className="cta-section-workspace">
                  <div className="container">
                    <div className="cta-section-workspace-icon" aria-hidden>
                      🏠
                    </div>
                    <h3>Vào phòng làm việc của bạn</h3>
                    <p>Máy chủ đang sẵn sàng — mở Dashboard để bắt đầu phiên mới.</p>
                    <Link href={routes.dashboard} className="btn btn-dashboard-go btn-lg">
                      🚀 Vào Dashboard
                    </Link>
                  </div>
                </section>
              ) : (
                <TrialCtaSection
                  isLoggedIn={Boolean(session)}
                  onFreeWorkspaceClick={openTrialModal}
                />
              ))}
        
            <footer className="footer">
                <div className="container">
                    <div className="footer-links">
                        <a href="#infrastructure">Hạ tầng</a>
                        <a href="#workstations">Nhu cầu</a>
                        <a href="#pricing">Bảng giá</a>
                        <a href="#how-it-works">Cách hoạt động</a>
                        <a href="#faq">FAQ</a>
                        <a href="#">Blog</a>
                        <a href="#">Liên hệ</a>
                        <a href="#">Chính sách bảo mật</a>
                    </div>
                    <p className="copyright">© 2026 GPUVietnam. Tất cả quyền được bảo lưu. | hello@gpuvietnam.com | Zalo: 0961 862 141</p>
                </div>
            </footer>

            <div
              className={`modal-overlay${showWorkstationModal ? ' active' : ''}`}
              id="activateWorkstationModal"
              onClick={(e) => {
                if (e.target === e.currentTarget) closeWorkstationModal();
              }}
            >
              <div className="modal modal-workstation">
                <button
                  type="button"
                  className="close-btn"
                  aria-label="Đóng"
                  onClick={closeWorkstationModal}
                >
                  ✕
                </button>
                <div className="modal-workstation-header">
                  <h3>🖥️ Chọn môi trường làm việc</h3>
                  <p>Chọn nhu cầu phù hợp để bắt đầu kích hoạt GPU trong 2 phút</p>
                </div>
                <div className="modal-workstation-grid">
                  {WORKSTATIONS.filter((w) => w.id !== 6).map((workstation) => (
                    <WorkstationCard
                      key={workstation.id}
                      workstation={workstation}
                      onSelect={handleModalWorkstationSelect}
                    />
                  ))}
                </div>
              </div>
            </div>

            {trialModal}

            <div className="modal-overlay" id="packageModal">
                <div className="modal">
                    <button className="close-btn" onClick={() => { if (typeof window !== 'undefined') (0, eval)("closeModal()"); }}>✕</button>
                    <h3>🖥️ Bạn sắp khởi tạo:</h3>
                    <p className="workstation-name" id="modalWorkstationName">ComfyUI — Character & Art</p>
                    <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginBottom: '14px' }}>Chọn gói GPU cho máy chủ của bạn:</p>
                    <div className="options">
                        <div className="option recommended" onClick={() => { if (typeof window !== 'undefined') (0, eval)("selectPlanFromModal('Pro')"); }}>
                            <h4>⭐ GỢI Ý TỐT NHẤT</h4>
                            <p style={{ fontSize: '12.5px' }}>Gói Pro</p>
                            <p className="price-sm">2.400.000đ<span style={{ fontSize: '11px' }}>/combo</span></p>
                            <p className="spec">RTX 4090 • 110 giờ</p>
                        </div>
                        <div className="option" onClick={() => { if (typeof window !== 'undefined') (0, eval)("selectPlanFromModal('Starter')"); }}>
                            <h4>💰 TIẾT KIỆM</h4>
                            <p style={{ fontSize: '12.5px' }}>Gói Starter</p>
                            <p className="price-sm">1.400.000đ<span style={{ fontSize: '11px' }}>/combo</span></p>
                            <p className="spec">RTX 3090 • 110 giờ</p>
                        </div>
                    </div>
                    <a
                      href="#"
                      className="trial-link"
                      onClick={(e) => {
                        e.preventDefault();
                        openTrialModal();
                      }}
                    >
                      💡 Mới dùng lần đầu? Dùng thử 3 giờ GPU miễn phí →
                    </a>
                </div>
            </div>
      </>
    </>
  );
}

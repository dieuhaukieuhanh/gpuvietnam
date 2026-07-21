import { useCallback, useEffect, useState } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';

type SocialShareButtonsProps = {
  /** Access token để fetch ảnh output mới nhất. Nếu không có token, chỉ share text. */
  accessToken?: string;
  /** Dòng mô tả mặc định khi share. */
  shareDescription?: string;
  /** Nếu có sẵn URL ảnh, dùng trực tiếp (không cần fetch). */
  imageUrlOverride?: string | null;
  /** Compact mode: chỉ hiển thị icon, không label. */
  compact?: boolean;
};

const SITE_URL = 'https://gpuvietnam.com';
const FACEBOOK_SHARE_URL = 'https://www.facebook.com/sharer/sharer.php';
const DEFAULT_DESCRIPTION =
  'Vừa tạo ra tác phẩm này chỉ trong vài phút trên GPUVietnam. Trải nghiệm ngay tại: https://gpuvietnam.com';
const HASHTAGS = '%23GPUVietnam %23AIArt %23ComfyUI';

function buildFacebookShareUrl(imageUrl?: string | null, description?: string): string {
  const params = new URLSearchParams();
  params.set('hashtag', HASHTAGS);

  if (imageUrl) {
    params.set('u', imageUrl);
  } else {
    params.set('u', SITE_URL);
  }

  const quote = description || DEFAULT_DESCRIPTION;
  params.set('quote', quote);

  return `${FACEBOOK_SHARE_URL}?${params.toString()}`;
}

function openFacebookShare(imageUrl?: string | null, description?: string) {
  const url = buildFacebookShareUrl(imageUrl, description);
  window.open(url, '_blank', 'width=626,height=436,noopener,noreferrer');
}

function copyToClipboard(text: string): boolean {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
      return true;
    }
  } catch { /* fallback */ }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  } catch { return false; }
}

function openZaloShare(imageUrl?: string | null, description?: string) {
  const text = description || 'Vừa tạo ra tác phẩm này trên GPUVietnam. Xem ngay!';
  const shareText = `${text} #GPUVietnam #AIArt #ComfyUI`;
  const sharePayload = `${shareText}
${imageUrl ? imageUrl : SITE_URL}`;

  const isMobileUA =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    typeof window !== 'undefined';

  if (isMobileUA) {
    const encodedText = encodeURIComponent(shareText);
    const zaloUrl = imageUrl
      ? `https://zalo.me/share?url=${encodeURIComponent(imageUrl)}&title=${encodedText}`
      : `https://zalo.me/share?url=${encodeURIComponent(SITE_URL)}&title=${encodedText}`;

    const startTime = Date.now();
    window.location.href = zaloUrl;

    setTimeout(() => {
      if (Date.now() - startTime < 500) {
        window.open(zaloUrl, '_blank', 'noopener,noreferrer');
      }
    }, 350);
  } else {
    // Desktop / PC: copy nội dung vào clipboard rồi mở thẳng Zalo Web
    copyToClipboard(sharePayload);
    window.open('https://chat.zalo.me', '_blank', 'noopener,noreferrer');
  }
}

export default function SocialShareButtons({
  accessToken,
  shareDescription,
  imageUrlOverride,
  compact = false,
}: SocialShareButtonsProps) {
  const [latestImageUrl, setLatestImageUrl] = useState<string | null>(imageUrlOverride ?? null);
  const [imageFetched, setImageFetched] = useState(Boolean(imageUrlOverride));
  const isMobileHook = useIsMobile();
  const isMobile = isMobileHook?.isMobile ?? false;

  const fetchLatestImage = useCallback(async () => {
    if (imageUrlOverride !== undefined || !accessToken) {
      setImageFetched(true);
      return;
    }

    try {
      const res = await fetch('/api/machines/recent-outputs?limit=1', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await res.json()) as { images?: Array<{ url: string }> };
      if (res.ok && data.images && data.images.length > 0) {
        setLatestImageUrl(data.images[0].url);
      }
    } catch {
      // Không có ảnh — vẫn share được với text
    } finally {
      setImageFetched(true);
    }
  }, [accessToken, imageUrlOverride]);

  useEffect(() => {
    void fetchLatestImage();
  }, [fetchLatestImage]);

  // Khi imageUrlOverride thay đổi, cập nhật
  useEffect(() => {
    if (imageUrlOverride !== undefined) {
      setLatestImageUrl(imageUrlOverride);
      setImageFetched(true);
    }
  }, [imageUrlOverride]);

  if (!imageFetched) {
    return null; // Đang fetch ảnh — chưa render nút
  }

  const imageUrl = latestImageUrl;

  return (
    <div
      className="social-share-buttons"
      style={{
        display: 'inline-flex',
        gap: compact ? 4 : 8,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <button
        type="button"
        className="btn-social-share btn-facebook-share"
        title="Chia sẻ lên Facebook"
        onClick={() => openFacebookShare(imageUrl, shareDescription)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: compact ? '4px 8px' : '6px 12px',
          fontSize: compact ? 11 : 12,
          fontWeight: 600,
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          backgroundColor: '#1877F2',
          color: '#fff',
          whiteSpace: 'nowrap',
          lineHeight: 1.4,
        }}
      >
        <span style={{ fontSize: compact ? 13 : 14 }}>📤</span>
        {!compact && <span>Chia sẻ tác phẩm</span>}
      </button>

      <button
        type="button"
        className="btn-social-share btn-zalo-share"
        title="Chia sẻ qua Zalo"
        onClick={() => openZaloShare(imageUrl, shareDescription)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: compact ? '4px 8px' : '6px 12px',
          fontSize: compact ? 11 : 12,
          fontWeight: 600,
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          backgroundColor: '#0068FF',
          color: '#fff',
          whiteSpace: 'nowrap',
          lineHeight: 1.4,
        }}
      >
        <span style={{ fontSize: compact ? 13 : 14 }}>💬</span>
        {!compact && <span>Chia sẻ qua Zalo</span>}
      </button>

      <style jsx>{`
        .btn-social-share:hover {
          filter: brightness(1.12);
          transform: translateY(-1px);
          transition: all 0.15s ease;
        }
        .btn-social-share:active {
          filter: brightness(0.95);
          transform: translateY(0);
        }
      `}</style>
    </div>
  );
}
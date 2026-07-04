import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

type RecentImage = {
  id: string;
  filename: string;
  url: string;
};

type DashboardRecentImagesMobileProps = {
  machineRunning: boolean;
};

export default function DashboardRecentImagesMobile({ machineRunning }: DashboardRecentImagesMobileProps) {
  const { session } = useAuth();
  const [images, setImages] = useState<RecentImage[]>([]);
  const [loading, setLoading] = useState(false);

  const loadImages = useCallback(async () => {
    const token = session?.access_token;
    if (!token || !machineRunning) {
      setImages([]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/machines/recent-outputs?limit=6', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { images?: RecentImage[] };
      if (res.ok) {
        setImages(data.images ?? []);
      }
    } catch {
      setImages([]);
    } finally {
      setLoading(false);
    }
  }, [machineRunning, session?.access_token]);

  useEffect(() => {
    void loadImages();
    if (!machineRunning) return undefined;
    const id = window.setInterval(() => void loadImages(), 30_000);
    return () => window.clearInterval(id);
  }, [loadImages, machineRunning]);

  return (
    <div className="card dashboard-recent-images-mobile">
      <div className="card-header">
        <span className="card-title">🖼️ Ảnh vừa tạo</span>
      </div>
      {loading && images.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Đang tải ảnh...</p>
      ) : images.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {machineRunning ? 'Chưa có ảnh output trong phiên này.' : 'Bật máy để xem ảnh vừa tạo.'}
        </p>
      ) : (
        <div className="dashboard-recent-images-grid">
          {images.map((image) => (
            <div key={image.id} className="dashboard-recent-image-item">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt={image.filename} loading="lazy" />
              <a
                href={image.url}
                download={image.filename}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-sm btn-secondary dashboard-recent-image-download"
              >
                📥 Tải về
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

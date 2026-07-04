import { useEffect, useState } from 'react';

export const MOBILE_MAX_PX = 767;
export const TABLET_MAX_PX = 1023;

function readViewport() {
  if (typeof window === 'undefined') {
    return { isMobile: false, isTablet: false };
  }
  const width = window.innerWidth;
  return {
    isMobile: width <= MOBILE_MAX_PX,
    isTablet: width > MOBILE_MAX_PX && width <= TABLET_MAX_PX,
  };
}

export function useIsMobile() {
  const [viewport, setViewport] = useState({ isMobile: false, isTablet: false });

  useEffect(() => {
    const handleResize = () => {
      setViewport(readViewport());
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return viewport;
}

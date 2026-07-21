import { useLayoutEffect } from 'react';

const PAGE_STYLE_ID = 'gpuvietnam-page-styles';

export function usePageStyles(css: string, pageId: string) {
  useLayoutEffect(() => {
    let el = document.getElementById(PAGE_STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = PAGE_STYLE_ID;
      document.head.prepend(el);
    }
    el.dataset.page = pageId;
    el.textContent = css;

    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('display');
    document.body.style.removeProperty('min-height');
  }, [css, pageId]);
}
import { useState, useEffect } from 'react';

/**
 * Hook to reactively listen to CSS media query changes.
 * Uses window.matchMedia with full event listener cleanup.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQueryList = window.matchMedia(query);
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);

    setMatches(mediaQueryList.matches);

    if (mediaQueryList.addEventListener) {
      mediaQueryList.addEventListener('change', listener);
      return () => mediaQueryList.removeEventListener('change', listener);
    } else {
      // Fallback for older Safari/browsers
      mediaQueryList.addListener(listener);
      return () => mediaQueryList.removeListener(listener);
    }
  }, [query]);

  return matches;
}

/**
 * Convenient helper to check if current viewport is mobile (< cutoff, default 768px).
 */
export function useIsMobile(cutoff: number = 768): boolean {
  return useMediaQuery(`(max-width: ${cutoff - 1}px)`);
}

/**
 * Convenient helper to check if current viewport is tablet or smaller (< 1024px).
 */
export function useIsTabletOrMobile(): boolean {
  return useMediaQuery('(max-width: 1023px)');
}

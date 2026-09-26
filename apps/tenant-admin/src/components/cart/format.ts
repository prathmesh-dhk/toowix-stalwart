export function formatPaise(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100);
}

/** Full-page cart lives at /cart (with returnTo query param to return to previous page). */
export function goToCart(returnTo?: string): void {
  const current = returnTo || (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '');
  const url = current && current !== '/cart' ? `/cart?returnTo=${encodeURIComponent(current)}` : '/cart';
  if (typeof window !== 'undefined') {
    window.history.pushState({ returnTo: current }, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

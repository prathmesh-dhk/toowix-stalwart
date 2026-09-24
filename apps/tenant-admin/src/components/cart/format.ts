export function formatPaise(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100);
}

/** Full-page cart lives at /cart (the app uses history-based routing, see App.tsx). */
export function goToCart(): void {
  window.history.pushState({}, '', '/cart');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

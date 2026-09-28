/**
 * Converts an ISO timestamp into a short, human-friendly relative string
 * ("2m ago", "3h ago", "yesterday", "5d ago"), falling back to a locale
 * date once it's more than a week old. Pair with `formatFullTimestamp`
 * for a native `title` tooltip carrying the exact UTC time.
 */
export function formatRelativeTime(iso: string | Date, now: Date = new Date()): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '—';

  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);

  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.round(diffHr / 24);
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Exact UTC timestamp for a `title` tooltip alongside `formatRelativeTime`. */
export function formatFullTimestamp(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '';
  return `${date.toISOString().replace('T', ' ').replace('Z', ' UTC')}`;
}

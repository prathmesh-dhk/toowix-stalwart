/**
 * Canonical form of an email used as a registration identity.
 *
 * The permanent post-deletion block is keyed on this, so trivially different spellings of
 * the same mailbox can't be used to register again. Deliberately conservative: it only
 * collapses variants that are guaranteed (or near-universally used) to reach the same inbox.
 *  - case and surrounding whitespace
 *  - `+tag` sub-addressing on the local part (owner+x@acme.com → owner@acme.com)
 *  - Gmail's dot-insensitivity and the googlemail.com alias
 */
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

export function normalizeRegistrationEmail(email: string): string {
  const cleaned = (email || '').normalize('NFKC').trim().toLowerCase();
  const at = cleaned.lastIndexOf('@');
  if (at <= 0) return cleaned;

  let local = cleaned.slice(0, at);
  let domain = cleaned.slice(at + 1);

  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);

  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }

  return `${local}@${domain}`;
}

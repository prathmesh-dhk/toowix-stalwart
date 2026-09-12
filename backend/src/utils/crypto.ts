import crypto from 'crypto';

/**
 * AES-256-GCM encrypt/decrypt for tenant-supplied secrets that must never be
 * stored in plaintext (currently: GoDaddy DNS API credentials).
 *
 * Deliberately does NOT fall back to JWT_SECRET or any other shared secret if
 * GODADDY_CREDENTIAL_ENCRYPTION_KEY is unset — that pattern exists elsewhere
 * in this codebase (backup.service.ts) for a lower-stakes secret class, but a
 * third-party DNS-management credential warrants its own key with no silent
 * fallback, so a missing key fails loudly instead of using a guessable default.
 */
const SALT = 'toowix-godaddy-credential-key-salt';
const ALGORITHM = 'aes-256-gcm';

function deriveKey(): Buffer {
  const secret = process.env.GODADDY_CREDENTIAL_ENCRYPTION_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
      return crypto.scryptSync('toowix-test-only-godaddy-key', SALT, 32);
    }
    throw new Error(
      'GODADDY_CREDENTIAL_ENCRYPTION_KEY is not set. Refusing to encrypt/decrypt GoDaddy credentials without a dedicated key.'
    );
  }
  return crypto.scryptSync(secret, SALT, 32);
}

export interface EncryptedEnvelope {
  iv: string;
  tag: string;
  data: string;
}

export function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const envelope: EncryptedEnvelope = {
    iv: iv.toString('hex'),
    tag: authTag.toString('hex'),
    data: encrypted.toString('base64'),
  };
  return JSON.stringify(envelope);
}

export function decrypt(ciphertext: string): string {
  const envelope: EncryptedEnvelope = JSON.parse(ciphertext);
  const key = deriveKey();
  const iv = Buffer.from(envelope.iv, 'hex');
  const authTag = Buffer.from(envelope.tag, 'hex');
  const data = Buffer.from(envelope.data, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

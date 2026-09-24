import crypto from 'crypto';
import { config } from '../config';

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
const IV_LENGTH = 12; // 96 bits for GCM

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

/**
 * Derives a 32-byte key from config.jwtSecret or an explicit ENCRYPTION_KEY.
 * Used for staged cart mailbox credentials.
 */
function getCartEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || config.jwtSecret;
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Output format: iv:authTag:ciphertext (hex-encoded)
 */
export function encryptCredential(plaintext: string): string {
  if (!plaintext) return '';
  const key = getCartEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a ciphertext string produced by encryptCredential.
 */
export function decryptCredential(encryptedText: string): string {
  if (!encryptedText) return '';
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted credential format');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getCartEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

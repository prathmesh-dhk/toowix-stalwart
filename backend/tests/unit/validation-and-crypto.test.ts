import { describe, it, expect } from 'vitest';
import { generateSecret, generateSync, verifySync } from 'otplib';
import { hashPassword, verifyPassword, generateOidcToken, verifyOidcToken } from '../../src/auth/service';
import { maskEmailAddress } from '../../src/api/auth.routes';

describe('Unit Tests: Cryptography, Tokens & Data Masking', () => {
  describe('Password Hashing & Verification', () => {
    it('should securely hash password with Argon2 and verify correctly', async () => {
      const password = 'CorrectHorseBatteryStaple2026!';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).toMatch(/^\$argon2id\$/);

      const isValid = await verifyPassword(hash, password);
      expect(isValid).toBe(true);

      const isInvalid = await verifyPassword(hash, 'WrongPassword123!');
      expect(isInvalid).toBe(false);
    });

    it('should generate different salts for identical passwords', async () => {
      const password = 'SharedPassword2026!';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2);
      expect(await verifyPassword(hash1, password)).toBe(true);
      expect(await verifyPassword(hash2, password)).toBe(true);
    });
  });

  describe('JWT OIDC Token Generation & Verification', () => {
    it('should generate valid JWT containing role and tenant claims', () => {
      const user = {
        id: 'usr-12345',
        email: 'admin@acme.com',
        role: 'TENANT_ADMIN' as const,
        tenantId: 'tenant-999',
        twoFactorEnabled: true,
      };

      const token = generateOidcToken(user);
      expect(token).toBeDefined();

      const decoded = verifyOidcToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.sub).toBe(user.id);
      expect(decoded?.email).toBe(user.email);
      expect(decoded?.roles).toContain('TENANT_ADMIN');
      expect(decoded?.tenant_id).toBe('tenant-999');
      expect(decoded?.iss).toBe('toowix-auth');
      expect(decoded?.aud).toBe('toowix-api');
    });

    it('should reject tampered or invalid JWT tokens', () => {
      const validToken = generateOidcToken({
        id: 'usr-123',
        email: 'test@toowix.com',
        role: 'SUPER_ADMIN',
        tenantId: null,
        twoFactorEnabled: true,
      });

      const tamperedToken = validToken.slice(0, -5) + 'abcde';
      const decoded = verifyOidcToken(tamperedToken);
      expect(decoded).toBeNull();
    });
  });

  describe('TOTP Two-Factor Authenticator Utilities', () => {
    it('should generate valid 6-digit TOTP code and verify against secret', () => {
      const secret = generateSecret();
      const code = generateSync({ secret });

      expect(code).toMatch(/^\d{6}$/);
      const result = verifySync({ token: code, secret });
      expect(result.valid).toBe(true);
    });

    it('should reject incorrect 6-digit TOTP codes', () => {
      const secret = generateSecret();
      const result = verifySync({ token: '000000', secret });
      expect(result.valid).toBe(false);
    });
  });

  describe('Email Masking for Censored Recovery Previews', () => {
    it('should mask standard email addresses with first 2 and last 2 characters', () => {
      expect(maskEmailAddress('alexander@example.com')).toBe('al***er@example.com');
      expect(maskEmailAddress('admin@toowix.com')).toBe('ad***n@toowix.com');
      expect(maskEmailAddress('tony.stark@avengers.org')).toBe('to***rk@avengers.org');
    });

    it('should gracefully handle short local parts', () => {
      expect(maskEmailAddress('me@domain.com')).toBe('m***@domain.com');
      expect(maskEmailAddress('a@domain.com')).toBe('a***@domain.com');
    });

    it('should handle invalid or empty inputs safely', () => {
      expect(maskEmailAddress('')).toBe('***');
      expect(maskEmailAddress('invalid-no-at')).toBe('***');
    });
  });
});

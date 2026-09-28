import { describe, it, expect } from 'vitest';
import { isValidMailDomain } from '../../src/utils/domain-validator';

describe('Unit Tests: Domain Validation Matching Stalwart Rules', () => {
  it('rejects random or non-public domains (e.g. hjsadha.asdsd)', () => {
    expect(isValidMailDomain('hjsadha.asdsd')).toBe(false);
    expect(isValidMailDomain('asdasd.asd')).toBe(false);
    expect(isValidMailDomain('random.invalidtld')).toBe(false);
    expect(isValidMailDomain('mybrand.faketld')).toBe(false);
    expect(isValidMailDomain('domain.123')).toBe(false);
  });

  it('rejects malformed domain strings', () => {
    expect(isValidMailDomain('')).toBe(false);
    expect(isValidMailDomain('nodots')).toBe(false);
    expect(isValidMailDomain('double..dot.com')).toBe(false);
    expect(isValidMailDomain('-leadingdash.com')).toBe(false);
    expect(isValidMailDomain('trailingdash-.com')).toBe(false);
  });

  it('accepts valid public domain names with ICANN TLDs', () => {
    expect(isValidMailDomain('acme.com')).toBe(true);
    expect(isValidMailDomain('company.co.uk')).toBe(true);
    expect(isValidMailDomain('tech.io')).toBe(true);
    expect(isValidMailDomain('brand.org')).toBe(true);
    expect(isValidMailDomain('modern.xyz')).toBe(true);
    expect(isValidMailDomain('app.ai')).toBe(true);
    expect(isValidMailDomain('sub.domain.net')).toBe(true);
  });

  it('accepts standard RFC special-use test domains supported by Stalwart', () => {
    expect(isValidMailDomain('toowix.test')).toBe(true);
    expect(isValidMailDomain('local.internal')).toBe(true);
    expect(isValidMailDomain('test.localhost')).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { resolveIpLocation } from '../src/utils/geo';

describe('Geo Location Utility (resolveIpLocation)', () => {
  it('should resolve loopback addresses as Localhost', async () => {
    expect((await resolveIpLocation('127.0.0.1')).location).toBe('Localhost');
    expect((await resolveIpLocation('::1')).location).toBe('Localhost');
    expect((await resolveIpLocation('localhost')).location).toBe('Localhost');
    expect((await resolveIpLocation('')).location).toBe('Localhost');
    expect((await resolveIpLocation('unknown')).location).toBe('Localhost');
  });

  it('should resolve private IPv4 subnets as Private Network', async () => {
    expect((await resolveIpLocation('10.0.0.1')).location).toBe('Private Network');
    expect((await resolveIpLocation('192.168.1.100')).location).toBe('Private Network');
    expect((await resolveIpLocation('172.16.0.5')).location).toBe('Private Network');
    expect((await resolveIpLocation('172.31.255.255')).location).toBe('Private Network');
    expect((await resolveIpLocation('169.254.1.1')).location).toBe('Private Network');
  });

  it('should resolve private IPv6 subnets as Private Network', async () => {
    expect((await resolveIpLocation('fc00::1')).location).toBe('Private Network');
    expect((await resolveIpLocation('fd12:3456:789a::1')).location).toBe('Private Network');
    expect((await resolveIpLocation('fe80::1')).location).toBe('Private Network');
  });

  it('should handle public IP lookup gracefully with cache', async () => {
    // 8.8.8.8 (Google DNS)
    const result = await resolveIpLocation('8.8.8.8');
    expect(result).toBeDefined();
    expect(typeof result.location).toBe('string');
    expect(result.location.length).toBeGreaterThan(0);

    // Should return cached result on second call
    const cachedResult = await resolveIpLocation('8.8.8.8');
    expect(cachedResult.location).toBe(result.location);
  });
});

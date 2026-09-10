export interface GeoLocationResult {
  location: string;
  countryCode?: string;
  city?: string;
  country?: string;
}

const geoCache = new Map<string, GeoLocationResult>();

/**
 * Determines if an IP address is a private, loopback, or internal address.
 */
export function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  const clean = ip.replace(/^::ffff:/, '').trim().toLowerCase();

  // Loopback and unspecified
  if (clean === '127.0.0.1' || clean === '::1' || clean === 'localhost' || clean === '0.0.0.0' || clean === 'unknown') {
    return true;
  }

  // IPv4 Private ranges
  // 10.0.0.0/8
  if (/^10\./.test(clean)) return true;
  // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(clean)) return true;
  // 192.168.0.0/16
  if (/^192\.168\./.test(clean)) return true;
  // 169.254.0.0/16 (Link-local)
  if (/^169\.254\./.test(clean)) return true;

  // IPv6 ULA (fc00::/7 -> fc00.. to fdff..) & Link-local (fe80::/10)
  if (/^(fc|fd)[0-9a-f]{0,2}:/i.test(clean) || /^(fe80|fe90|fea0|feb0):/i.test(clean) || clean.startsWith('fe80::') || clean.startsWith('fc00::')) {
    return true;
  }

  return false;
}

/**
 * Resolves an IP address to a human-readable geographic location (City, Country).
 * Returns 'Localhost' for loopback addresses and 'Private Network' for LAN IPs.
 * For public IPs, queries a fast geo-lookup service with local in-memory caching.
 */
export async function resolveIpLocation(ip?: string): Promise<GeoLocationResult> {
  if (!ip) {
    return { location: 'Localhost' };
  }

  const clean = ip.replace(/^::ffff:/, '').trim();

  if (clean === '127.0.0.1' || clean === '::1' || clean === 'localhost' || clean === 'unknown' || clean === '0.0.0.0') {
    return { location: 'Localhost', country: 'Local Network' };
  }

  if (isPrivateIp(clean)) {
    return { location: 'Private Network', country: 'Local Network' };
  }

  // Check in-memory cache
  if (geoCache.has(clean)) {
    return geoCache.get(clean)!;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    // Using ip-api.com (free, reliable, JSON format, no API key needed for non-commercial/dev)
    const res = await fetch(`http://ip-api.com/json/${clean}?fields=status,country,countryCode,regionName,city`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data: any = await res.json();
      if (data.status === 'success') {
        const parts = [data.city, data.regionName || data.country].filter(Boolean);
        const location = parts.length > 0 ? parts.join(', ') : data.country || 'Unknown Location';
        const result: GeoLocationResult = {
          location,
          countryCode: data.countryCode || undefined,
          city: data.city || undefined,
          country: data.country || undefined,
        };
        geoCache.set(clean, result);
        return result;
      }
    }
  } catch {
    // Non-blocking: fail gracefully to Unknown Location
  }

  const fallback: GeoLocationResult = { location: 'Unknown Location' };
  geoCache.set(clean, fallback);
  return fallback;
}

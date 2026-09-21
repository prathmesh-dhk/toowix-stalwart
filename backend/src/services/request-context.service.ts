import net from 'net';
import { Request } from 'express';
import { cleanIpAddress, parseUserAgent } from './session.service';
import { resolveIpLocation } from '../utils/geo';
import type { RequestContext } from './organisation-deletion.service';

/** Extracts the version that belongs to the browser name parseUserAgent reported. */
export function parseBrowserVersion(ua: string, browser: string): string {
  const patterns: Record<string, RegExp> = {
    'Microsoft Edge': /Edg\/([\d.]+)/i,
    'Google Chrome': /Chrome\/([\d.]+)/i,
    'Mozilla Firefox': /Firefox\/([\d.]+)/i,
    // Safari reports its own version as "Version/x", not "Safari/605.1.15" (that is the WebKit build).
    'Apple Safari': /Version\/([\d.]+)/i,
    Opera: /(?:OPR|Opera)\/([\d.]+)/i,
  };
  const pattern = patterns[browser];
  return (pattern && ua.match(pattern)?.[1]) || '';
}

/**
 * Snapshot of who is calling and from where, for the deletion audit trail:
 * public IP (v4/v6), approximate geo-location, device / OS / browser + version, and session.
 * Never throws — an unresolvable geo lookup degrades to "Unknown Location".
 */
export async function captureRequestContext(req: Request): Promise<RequestContext> {
  const ip = cleanIpAddress(req.ip || req.socket?.remoteAddress);
  const userAgent = req.get('user-agent') || '';
  const parsed = parseUserAgent(userAgent);
  const family = net.isIP(ip);
  const geo = await resolveIpLocation(ip).catch(() => ({ location: 'Unknown Location' } as { location: string; countryCode?: string }));

  return {
    ip,
    ipVersion: family === 4 ? 4 : family === 6 ? 6 : null,
    location: geo.location,
    countryCode: geo.countryCode ?? null,
    deviceType: parsed.deviceType,
    os: parsed.os,
    browser: parsed.browser,
    browserVersion: parseBrowserVersion(userAgent, parsed.browser),
    sessionId: req.sessionId ?? null,
  };
}

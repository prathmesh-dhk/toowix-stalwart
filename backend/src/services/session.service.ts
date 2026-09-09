import { Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AdminSessionModel, IAdminSession, DeviceType } from '../db/models/AdminSession';
import { AuditLogModel } from '../db/models/AuditLog';

export interface ParsedUserAgent {
  deviceType: DeviceType;
  browser: string;
  os: string;
}

export function parseUserAgent(ua: string = ''): ParsedUserAgent {
  if (!ua || typeof ua !== 'string') {
    return { deviceType: 'unknown', browser: 'Unknown Browser', os: 'Unknown OS' };
  }

  // Device Type Detection
  let deviceType: DeviceType = 'desktop';
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) {
    deviceType = 'tablet';
  } else if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) {
    deviceType = 'mobile';
  }

  // OS Detection
  let os = 'Unknown OS';
  if (/Windows NT 10\.0/i.test(ua)) os = 'Windows 10/11';
  else if (/Windows NT 6\.3/i.test(ua)) os = 'Windows 8.1';
  else if (/Windows NT 6\.1/i.test(ua)) os = 'Windows 7';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Linux/i.test(ua)) os = 'Linux';

  // Browser Detection
  let browser = 'Unknown Browser';
  if (/Edg\//i.test(ua)) browser = 'Microsoft Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Google Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Mozilla Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Apple Safari';
  else if (/OPR\/|Opera\//i.test(ua)) browser = 'Opera';

  return { deviceType, browser, os };
}

export function cleanIpAddress(ip?: string): string {
  if (!ip) return '127.0.0.1';
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return '127.0.0.1';
  return ip.replace(/^::ffff:/, '');
}

export interface SessionResponseItem {
  sessionId: string;
  deviceType: DeviceType;
  browser: string;
  os: string;
  ipAddress: string;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export class SessionService {
  /**
   * Create and record a new active session
   */
  async createSession(
    userId: string | Types.ObjectId,
    userAgent?: string,
    ipAddress?: string,
    rememberMe: boolean = false
  ): Promise<IAdminSession> {
    const rawUa = userAgent || 'Unknown User-Agent';
    const parsed = parseUserAgent(rawUa);
    const cleanedIp = cleanIpAddress(ipAddress || '127.0.0.1');
    const sessionId = uuidv4();
    const durationMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + durationMs);

    const session = await AdminSessionModel.create({
      userId: new Types.ObjectId(userId.toString()),
      sessionId,
      userAgent: rawUa,
      deviceType: parsed.deviceType,
      browser: parsed.browser,
      os: parsed.os,
      ipAddress: cleanedIp,
      lastActiveAt: new Date(),
      expiresAt,
      isRevoked: false,
    });

    try {
      await AuditLogModel.create({
        actorId: userId.toString(),
        actorRole: 'ADMIN',
        actorIp: cleanedIp,
        action: 'AUTH_SESSION_CREATED',
        resource: 'session',
        resourceId: sessionId,
        status: 'SUCCESS',
        metadata: {
          browser: parsed.browser,
          os: parsed.os,
          deviceType: parsed.deviceType,
          ip: cleanedIp,
          rememberMe,
        },
        timestamp: new Date(),
      });
    } catch {
      // Non-blocking audit failure
    }

    return session;
  }

  /**
   * Validates if a session exists, is unexpired, and is not revoked.
   * Throttles updating `lastActiveAt` to avoid high DB write frequency.
   */
  async isSessionActive(sessionId: string): Promise<boolean> {
    if (!sessionId) return false;

    const session = await AdminSessionModel.findOne({ sessionId });
    if (!session) return false;
    if (session.isRevoked) return false;
    if (session.expiresAt.getTime() < Date.now()) return false;

    // Update lastActiveAt if more than 2 minutes elapsed since last update
    if (Date.now() - session.lastActiveAt.getTime() > 2 * 60 * 1000) {
      session.lastActiveAt = new Date();
      await session.save().catch(() => {});
    }

    return true;
  }

  /**
   * List all currently active unrevoked sessions for a user
   */
  async listUserSessions(
    userId: string | Types.ObjectId,
    currentSessionId?: string
  ): Promise<SessionResponseItem[]> {
    const sessions = await AdminSessionModel.find({
      userId: new Types.ObjectId(userId.toString()),
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    }).sort({ lastActiveAt: -1 });

    return sessions.map((s) => ({
      sessionId: s.sessionId,
      deviceType: s.deviceType,
      browser: s.browser,
      os: s.os,
      ipAddress: s.ipAddress,
      lastActiveAt: s.lastActiveAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      isCurrent: s.sessionId === currentSessionId,
    }));
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(
    userId: string | Types.ObjectId,
    sessionId: string,
    actorEmail?: string
  ): Promise<boolean> {
    const session = await AdminSessionModel.findOne({
      userId: new Types.ObjectId(userId.toString()),
      sessionId,
    });

    if (!session) return false;

    session.isRevoked = true;
    await session.save();

    try {
      await AuditLogModel.create({
        actorId: userId.toString(),
        actorRole: 'ADMIN',
        actorEmail,
        actorIp: session.ipAddress,
        action: 'AUTH_SESSION_REVOKED',
        resource: 'session',
        resourceId: sessionId,
        status: 'SUCCESS',
        metadata: {
          revokedSessionId: sessionId,
          browser: session.browser,
          os: session.os,
          actorEmail,
        },
        timestamp: new Date(),
      });
    } catch {
      // Non-blocking
    }

    return true;
  }

  /**
   * Revoke all other sessions for this user, keeping the current session active
   */
  async revokeOtherSessions(
    userId: string | Types.ObjectId,
    currentSessionId: string,
    actorEmail?: string
  ): Promise<number> {
    const result = await AdminSessionModel.updateMany(
      {
        userId: new Types.ObjectId(userId.toString()),
        sessionId: { $ne: currentSessionId },
        isRevoked: false,
      },
      {
        $set: { isRevoked: true },
      }
    );

    try {
      await AuditLogModel.create({
        actorId: userId.toString(),
        actorRole: 'ADMIN',
        actorEmail,
        actorIp: '127.0.0.1',
        action: 'AUTH_SESSIONS_REVOKED_OTHERS',
        resource: 'session',
        resourceId: currentSessionId,
        status: 'SUCCESS',
        metadata: {
          currentSessionId,
          revokedCount: result.modifiedCount,
          actorEmail,
        },
        timestamp: new Date(),
      });
    } catch {
      // Non-blocking
    }

    return result.modifiedCount;
  }
}

export const sessionService = new SessionService();

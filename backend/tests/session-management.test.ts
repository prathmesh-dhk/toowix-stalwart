import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { app } from '../src/app';
import { AdminUserModel } from '../src/db/models/AdminUser';
import { AdminSessionModel } from '../src/db/models/AdminSession';
import { hashPassword, generateOidcToken } from '../src/auth/service';
import { resetRateLimitStore } from '../src/auth/middleware';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  resetRateLimitStore();
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

describe('Session & Device Management (Phase 9)', () => {
  it('should create an AdminSession on login and bind sid to token', async () => {
    const passwordHash = await hashPassword('SuperAdmin123!');
    const admin = await AdminUserModel.create({
      email: 'admin@toowix.com',
      passwordHash,
      role: 'SUPER_ADMIN',
      status: 'active',
      twoFactorEnabled: false,
    });

    const res = await request(app)
      .post('/api/auth/super-admin/login')
      .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36')
      .send({
        email: 'admin@toowix.com',
        password: 'SuperAdmin123!',
      });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();

    const session = await AdminSessionModel.findOne({ userId: admin._id });
    expect(session).toBeTruthy();
    expect(session?.deviceType).toBe('desktop');
    expect(session?.os).toContain('Windows');
    expect(session?.browser).toBe('Google Chrome');
    expect(session?.isRevoked).toBe(false);
  });

  it('should list active sessions with isCurrent true for the requesting token', async () => {
    const passwordHash = await hashPassword('SuperAdmin123!');
    const admin = await AdminUserModel.create({
      email: 'admin@toowix.com',
      passwordHash,
      role: 'SUPER_ADMIN',
      status: 'active',
      twoFactorEnabled: false,
    });

    // Session 1: Windows Chrome
    const login1 = await request(app)
      .post('/api/auth/super-admin/login')
      .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36')
      .send({ email: 'admin@toowix.com', password: 'SuperAdmin123!' });

    // Session 2: iPhone Safari
    const login2 = await request(app)
      .post('/api/auth/super-admin/login')
      .set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')
      .send({ email: 'admin@toowix.com', password: 'SuperAdmin123!' });

    const token2 = login2.body.token;

    // List sessions from Session 2
    const listRes = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${token2}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.sessions).toHaveLength(2);

    const currentSession = listRes.body.sessions.find((s: any) => s.isCurrent);
    expect(currentSession).toBeDefined();
    expect(currentSession.deviceType).toBe('mobile');
    expect(currentSession.browser).toContain('Safari');
    expect(currentSession.os).toBe('iOS');

    const otherSession = listRes.body.sessions.find((s: any) => !s.isCurrent);
    expect(otherSession).toBeDefined();
    expect(otherSession.deviceType).toBe('desktop');
    expect(otherSession.browser).toContain('Chrome');
  });

  it('should revoke a specific session and return 401 SESSION_REVOKED for that token', async () => {
    const passwordHash = await hashPassword('SuperAdmin123!');
    const admin = await AdminUserModel.create({
      email: 'admin@toowix.com',
      passwordHash,
      role: 'SUPER_ADMIN',
      status: 'active',
      twoFactorEnabled: false,
    });

    const login1 = await request(app)
      .post('/api/auth/super-admin/login')
      .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36')
      .send({ email: 'admin@toowix.com', password: 'SuperAdmin123!' });

    const login2 = await request(app)
      .post('/api/auth/super-admin/login')
      .set('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Firefox/120.0')
      .send({ email: 'admin@toowix.com', password: 'SuperAdmin123!' });

    const token1 = login1.body.token;
    const token2 = login2.body.token;

    // From session 1, list sessions to get session 2's id
    const listRes = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${token1}`);

    const session2Id = listRes.body.sessions.find((s: any) => !s.isCurrent).sessionId;

    // Revoke session 2 from session 1
    const revokeRes = await request(app)
      .delete(`/api/auth/sessions/${session2Id}`)
      .set('Authorization', `Bearer ${token1}`);

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.success).toBe(true);

    // Now try to access protected endpoint using session 2's token
    const testSession2 = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${token2}`);

    expect(testSession2.status).toBe(401);
    expect(testSession2.body.error).toBe('SESSION_REVOKED');

    // Session 1 remains active
    const testSession1 = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${token1}`);

    expect(testSession1.status).toBe(200);
    expect(testSession1.body.sessions).toHaveLength(1);
  });

  it('should revoke all other sessions when revoke-others is called', async () => {
    const passwordHash = await hashPassword('SuperAdmin123!');
    const admin = await AdminUserModel.create({
      email: 'admin@toowix.com',
      passwordHash,
      role: 'SUPER_ADMIN',
      status: 'active',
      twoFactorEnabled: false,
    });

    const login1 = await request(app)
      .post('/api/auth/super-admin/login')
      .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0')
      .send({ email: 'admin@toowix.com', password: 'SuperAdmin123!' });

    const login2 = await request(app)
      .post('/api/auth/super-admin/login')
      .set('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15')
      .send({ email: 'admin@toowix.com', password: 'SuperAdmin123!' });

    const login3 = await request(app)
      .post('/api/auth/super-admin/login')
      .set('User-Agent', 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile')
      .send({ email: 'admin@toowix.com', password: 'SuperAdmin123!' });

    const token1 = login1.body.token;
    const token2 = login2.body.token;
    const token3 = login3.body.token;

    // From session 1, revoke all other sessions
    const revokeOthersRes = await request(app)
      .post('/api/auth/sessions/revoke-others')
      .set('Authorization', `Bearer ${token1}`);

    expect(revokeOthersRes.status).toBe(200);
    expect(revokeOthersRes.body.revokedCount).toBe(2);

    // Tokens 2 & 3 should be revoked
    const check2 = await request(app).get('/api/auth/sessions').set('Authorization', `Bearer ${token2}`);
    expect(check2.status).toBe(401);
    expect(check2.body.error).toBe('SESSION_REVOKED');

    const check3 = await request(app).get('/api/auth/sessions').set('Authorization', `Bearer ${token3}`);
    expect(check3.status).toBe(401);
    expect(check3.body.error).toBe('SESSION_REVOKED');

    // Token 1 remains active
    const check1 = await request(app).get('/api/auth/sessions').set('Authorization', `Bearer ${token1}`);
    expect(check1.status).toBe(200);
    expect(check1.body.sessions).toHaveLength(1);
    expect(check1.body.sessions[0].isCurrent).toBe(true);
  });

  it('should support backward compatibility for tokens without sid', async () => {
    const passwordHash = await hashPassword('SuperAdmin123!');
    const admin = await AdminUserModel.create({
      email: 'admin@toowix.com',
      passwordHash,
      role: 'SUPER_ADMIN',
      status: 'active',
      twoFactorEnabled: false,
    });

    // Generate token directly without sid
    const legacyToken = generateOidcToken({
      id: admin._id.toString(),
      email: admin.email,
      role: admin.role,
      tenantId: null,
      twoFactorEnabled: false,
    });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${legacyToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('admin@toowix.com');
  });
});

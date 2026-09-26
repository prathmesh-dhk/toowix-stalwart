import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { AdminUserModel } from '../src/db/models';
import { generateOidcToken } from '../src/auth/service';
import { emailService } from '../src/services/email.service';

let mongoServer: MongoMemoryServer;

describe('Gap 4: Outbound SMTP Relay Live Diagnostic Integration', () => {
  let superAdminToken: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri() });

    const superAdmin = await AdminUserModel.create({
      email: 'superadmin-relay@toowix.com',
      passwordHash: 'dummy',
      role: 'SUPER_ADMIN',
    });

    superAdminToken = generateOidcToken({
      id: superAdmin._id.toString(),
      email: superAdmin.email,
      role: 'SUPER_ADMIN',
    });
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /api/system/smtp/relay-status returns relay handshake status and latency', async () => {
    vi.spyOn(emailService, 'verifyRelay').mockResolvedValue({
      connected: true,
      latencyMs: 18,
      host: '127.0.0.1',
      port: 2525,
      secure: false,
      authenticated: false,
    });

    const res = await request(app)
      .get('/api/system/smtp/relay-status')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.latencyMs).toBe(18);
    expect(res.body.host).toBe('127.0.0.1');
    expect(res.body.port).toBe(2525);
  });

  it('POST /api/system/smtp/test-ping validates input and dispatches ping', async () => {
    vi.spyOn(emailService, 'sendTestPing').mockResolvedValue({
      success: true,
      messageId: '<test-ping-123@toowix.com>',
      latencyMs: 34,
    });

    const badRes = await request(app)
      .post('/api/system/smtp/test-ping')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ to: 'invalid-email' });

    expect(badRes.status).toBe(400);

    const goodRes = await request(app)
      .post('/api/system/smtp/test-ping')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ to: 'recipient@acme.com' });

    expect(goodRes.status).toBe(200);
    expect(goodRes.body.success).toBe(true);
    expect(goodRes.body.messageId).toBe('<test-ping-123@toowix.com>');
    expect(goodRes.body.latencyMs).toBe(34);
  });

  it('rejects unauthenticated requests to SMTP diagnostic routes', async () => {
    const res1 = await request(app).get('/api/system/smtp/relay-status');
    expect(res1.status).toBe(401);

    const res2 = await request(app).post('/api/system/smtp/test-ping').send({ to: 'test@example.com' });
    expect(res2.status).toBe(401);
  });
});

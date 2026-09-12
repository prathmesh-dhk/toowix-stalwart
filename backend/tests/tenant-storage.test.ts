import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { TenantModel } from '../src/db/models/Tenant';
import { DomainModel } from '../src/db/models/Domain';
import { MailboxModel } from '../src/db/models/Mailbox';
import { AdminUserModel } from '../src/db/models/AdminUser';
import { generateOidcToken } from '../src/auth/service';
import { stalwartClient } from '../src/stalwart/client';

describe('Tenant Storage API (GET /api/tenants/me/storage)', () => {
  let tenantId: string;
  let domain1Id: string;
  let domain2Id: string;
  let tenantToken: string;

  beforeAll(async () => {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/toowix_mail_test_storage';
    await connectDatabase({ uri: mongoUri });
  });

  afterAll(async () => {
    await TenantModel.deleteMany({ name: 'Storage Test Tenant' });
    await DomainModel.deleteMany({ tenantId });
    await MailboxModel.deleteMany({ tenantId });
    await AdminUserModel.deleteMany({ tenantId });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await TenantModel.deleteMany({ name: 'Storage Test Tenant' });
    await DomainModel.deleteMany({ domainName: { $in: ['storagetest1.com', 'storagetest2.com'] } });
    await MailboxModel.deleteMany({ address: { $in: ['alice@storagetest1.com', 'bob@storagetest1.com', 'carol@storagetest2.com'] } });
    await AdminUserModel.deleteMany({ email: 'admin@storagetest1.com' });

    const tenant = await TenantModel.create({
      name: 'Storage Test Tenant',
      status: 'active',
      mailboxLimit: 20,
      mailboxCount: 3,
    });
    tenantId = tenant._id.toString();

    const dom1 = await DomainModel.create({
      tenantId: tenant._id,
      domainName: 'storagetest1.com',
      status: 'active',
      mailboxLimit: 10,
      employeeCount: 10,
      isPrimary: true,
    });
    domain1Id = dom1._id.toString();

    const dom2 = await DomainModel.create({
      tenantId: tenant._id,
      domainName: 'storagetest2.com',
      status: 'active',
      mailboxLimit: 10,
      employeeCount: 10,
      isPrimary: false,
    });
    domain2Id = dom2._id.toString();

    await MailboxModel.create([
      {
        tenantId: tenant._id,
        domainId: dom1._id,
        localPart: 'alice',
        address: 'alice@storagetest1.com',
        stalwartAccountId: 'acc_alice',
        status: 'active',
      },
      {
        tenantId: tenant._id,
        domainId: dom1._id,
        localPart: 'bob',
        address: 'bob@storagetest1.com',
        stalwartAccountId: 'acc_bob',
        status: 'active',
      },
      {
        tenantId: tenant._id,
        domainId: dom2._id,
        localPart: 'carol',
        address: 'carol@storagetest2.com',
        stalwartAccountId: 'acc_carol',
        status: 'active',
      },
    ]);

    const admin = await AdminUserModel.create({
      tenantId: tenant._id,
      email: 'admin@storagetest1.com',
      passwordHash: 'dummyhash',
      role: 'TENANT_ADMIN',
    });

    tenantToken = generateOidcToken({
      id: admin._id.toString(),
      email: admin.email,
      role: 'TENANT_ADMIN',
      tenantId: tenant._id.toString(),
      twoFactorEnabled: false,
    });
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/tenants/me/storage');
    expect(res.status).toBe(401);
  });

  it('returns storage metrics and mailboxes with mapped storageBytes', async () => {
    const mockStorageMap = new Map<string, number>([
      ['acc_alice', 104857600], // 100 MB
      ['acc_bob', 20971520],    // 20 MB
      ['acc_carol', 0],         // 0 B
    ]);
    vi.spyOn(stalwartClient, 'listAccountsWithStorage').mockResolvedValue(mockStorageMap);

    const res = await request(app)
      .get('/api/tenants/me/storage')
      .set('Authorization', `Bearer ${tenantToken}`);

    expect(res.status).toBe(200);
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.totalStorageBytes).toBe(125829120); // 120 MB
    expect(res.body.summary.totalStorageFormatted).toBe('120.0 MB');
    expect(res.body.summary.mailboxCount).toBe(3);
    expect(res.body.summary.mailboxesWithData).toBe(2);

    expect(res.body.mailboxes).toHaveLength(3);
    // Verified sorted descending by storageBytes
    expect(res.body.mailboxes[0].address).toBe('alice@storagetest1.com');
    expect(res.body.mailboxes[0].storageBytes).toBe(104857600);
    expect(res.body.mailboxes[0].storageFormatted).toBe('100.0 MB');
    expect(res.body.mailboxes[0].percentage).toBeGreaterThan(80);

    expect(res.body.mailboxes[1].address).toBe('bob@storagetest1.com');
    expect(res.body.mailboxes[1].storageBytes).toBe(20971520);
    expect(res.body.mailboxes[1].storageFormatted).toBe('20.0 MB');

    expect(res.body.mailboxes[2].address).toBe('carol@storagetest2.com');
    expect(res.body.mailboxes[2].storageBytes).toBe(0);
  });

  it('filters mailboxes by domainId when provided', async () => {
    const mockStorageMap = new Map<string, number>([
      ['acc_alice', 104857600],
      ['acc_bob', 20971520],
      ['acc_carol', 52428800], // 50 MB
    ]);
    vi.spyOn(stalwartClient, 'listAccountsWithStorage').mockResolvedValue(mockStorageMap);

    const res = await request(app)
      .get(`/api/tenants/me/storage?domainId=${domain2Id}`)
      .set('Authorization', `Bearer ${tenantToken}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.mailboxCount).toBe(1);
    expect(res.body.mailboxes).toHaveLength(1);
    expect(res.body.mailboxes[0].address).toBe('carol@storagetest2.com');
    expect(res.body.mailboxes[0].storageBytes).toBe(52428800);
    expect(res.body.mailboxes[0].storageFormatted).toBe('50.0 MB');
  });

  it('handles Stalwart failure gracefully and returns 0 bytes without crashing', async () => {
    vi.spyOn(stalwartClient, 'listAccountsWithStorage').mockRejectedValue(new Error('Stalwart timeout'));

    const res = await request(app)
      .get('/api/tenants/me/storage')
      .set('Authorization', `Bearer ${tenantToken}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.totalStorageBytes).toBe(0);
    expect(res.body.summary.totalStorageFormatted).toBe('0 B');
    expect(res.body.mailboxes).toHaveLength(3);
    for (const mb of res.body.mailboxes) {
      expect(mb.storageBytes).toBe(0);
      expect(mb.storageFormatted).toBe('0 B');
    }
  });
});

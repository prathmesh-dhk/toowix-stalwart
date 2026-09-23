import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import {
  AdminUserModel,
  TenantModel,
  DomainModel,
  MailboxModel,
  AuditLogModel,
} from '../src/db/models';
import { generateOidcToken } from '../src/auth/service';
import { stalwartClient } from '../src/stalwart/client';

let mongoServer: MongoMemoryServer;

describe('Mailbox Email Aliases (Option 1)', () => {
  let tenantAId: string;
  let domainA1Id: string;
  let domainA2Id: string;
  let tenantAdminAToken: string;
  let tenantAdminAId: string;

  let tenantBId: string;
  let domainBId: string;
  let tenantAdminBToken: string;
  let tenantAdminBId: string;

  let mailboxAId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri() });

    vi.spyOn(stalwartClient, 'createAccount').mockImplementation(async (input) => ({
      id: 'mock-acc-' + Math.random().toString(36).substring(7),
      name: input.name,
      domainId: input.domainId,
      emailAddress: `${input.name}@mock.test`,
    }));

    vi.spyOn(stalwartClient, 'updateAccountAliases').mockResolvedValue();
    vi.spyOn(stalwartClient, 'updateAccountPassword').mockResolvedValue();
    vi.spyOn(stalwartClient, 'updateAccountStatus').mockResolvedValue();
    vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue();

    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([
      {
        id: 'dom-acme',
        name: 'acme.com',
        description: 'Acme Primary',
        isEnabled: true,
      },
      {
        id: 'dom-acme-sec',
        name: 'acme-support.com',
        description: 'Acme Support',
        isEnabled: true,
      },
      {
        id: 'dom-beta',
        name: 'beta.com',
        description: 'Beta Corp',
        isEnabled: true,
      },
    ]);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await TenantModel.deleteMany({});
    await DomainModel.deleteMany({});
    await MailboxModel.deleteMany({});
    await AdminUserModel.deleteMany({});
    await AuditLogModel.deleteMany({});
    vi.clearAllMocks();

    // 1. Setup Tenant A
    const tenantA = await TenantModel.create({
      name: 'Acme Corp',
      status: 'active',
      mailboxLimit: 5,
      mailboxCount: 1,
    });
    tenantAId = tenantA._id.toString();

    const domainA1 = await DomainModel.create({
      tenantId: tenantA._id,
      domainName: 'acme.com',
      stalwartDomainId: 'dom-acme',
      isPrimary: true,
      dnsStatus: 'active',
      status: 'active',
    });
    domainA1Id = domainA1._id.toString();

    const domainA2 = await DomainModel.create({
      tenantId: tenantA._id,
      domainName: 'acme-support.com',
      stalwartDomainId: 'dom-acme-sec',
      isPrimary: false,
      dnsStatus: 'active',
      status: 'active',
    });
    domainA2Id = domainA2._id.toString();

    const adminA = await AdminUserModel.create({
      tenantId: tenantA._id,
      email: 'admin@acme.com',
      passwordHash: 'hash123',
      name: 'Acme Admin',
      role: 'TENANT_ADMIN',
    });
    tenantAdminAId = adminA._id.toString();
    tenantAdminAToken = generateOidcToken({
      id: adminA._id.toString(),
      email: adminA.email,
      role: 'TENANT_ADMIN',
      tenantId: tenantAId,
    });

    // Create a base mailbox for Tenant A
    const mbA = await MailboxModel.create({
      tenantId: tenantA._id,
      domainId: domainA1._id,
      localPart: 'alice',
      address: 'alice@acme.com',
      stalwartAccountId: 'acc-alice-123',
      status: 'active',
      aliases: [],
    });
    mailboxAId = mbA._id.toString();

    // 2. Setup Tenant B
    const tenantB = await TenantModel.create({
      name: 'Beta Corp',
      status: 'active',
      mailboxLimit: 5,
      mailboxCount: 0,
    });
    tenantBId = tenantB._id.toString();

    const domainB = await DomainModel.create({
      tenantId: tenantB._id,
      domainName: 'beta.com',
      stalwartDomainId: 'dom-beta',
      isPrimary: true,
      dnsStatus: 'active',
      status: 'active',
    });
    domainBId = domainB._id.toString();

    const adminB = await AdminUserModel.create({
      tenantId: tenantB._id,
      email: 'admin@beta.com',
      passwordHash: 'hash456',
      name: 'Beta Admin',
      role: 'TENANT_ADMIN',
    });
    tenantAdminBId = adminB._id.toString();
    tenantAdminBToken = generateOidcToken({
      id: adminB._id.toString(),
      email: adminB.email,
      role: 'TENANT_ADMIN',
      tenantId: tenantBId,
    });
  });

  describe('Alias Creation', () => {
    it('creates an alias successfully and syncs to Stalwart without consuming seats', async () => {
      const res = await request(app)
        .post(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({
          localPart: 'support',
          domainId: domainA1Id,
          description: 'Inbound Customer Support',
        });

      expect(res.status).toBe(201);
      expect(res.body.alias).toMatchObject({
        localPart: 'support',
        domainName: 'acme.com',
        address: 'support@acme.com',
        description: 'Inbound Customer Support',
      });
      expect(res.body.alias.id).toBeDefined();

      // Verify Stalwart client updateAccountAliases was invoked
      expect(stalwartClient.updateAccountAliases).toHaveBeenCalledWith(
        'acc-alice-123',
        [
          {
            name: 'support',
            domainId: 'dom-acme',
            description: 'Inbound Customer Support',
            enabled: true,
          },
        ]
      );

      // Verify zero quota impact on tenant
      const updatedTenant = await TenantModel.findById(tenantAId);
      expect(updatedTenant?.mailboxCount).toBe(1); // Still 1! Not 2!

      // Verify MongoDB document
      const mailboxDoc = await MailboxModel.findById(mailboxAId);
      expect(mailboxDoc?.aliases).toHaveLength(1);
      expect(mailboxDoc?.aliases[0].address).toBe('support@acme.com');

      // Verify audit log
      const audit = await AuditLogModel.findOne({ action: 'MAILBOX_ALIAS_CREATED' });
      expect(audit).toBeDefined();
      expect(audit?.metadata?.address).toBe('support@acme.com');
    });

    it('always creates an alias on the mailbox domain, ignoring a submitted secondary domain', async () => {
      const res = await request(app)
        .post(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({
          localPart: 'sales',
          domainId: domainA2Id,
          description: 'Sales inquiry',
        });

      expect(res.status).toBe(201);
      expect(res.body.alias.address).toBe('sales@acme.com');

      const mailboxDoc = await MailboxModel.findById(mailboxAId);
      expect(mailboxDoc?.aliases[0].address).toBe('sales@acme.com');
    });

    it('rejects alias creation if address collides with an existing primary mailbox', async () => {
      const res = await request(app)
        .post(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({
          localPart: 'alice', // alice@acme.com is already the primary address
          domainId: domainA1Id,
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('ADDRESS_IN_USE');
    });

    it('rejects alias creation if address collides with an existing alias', async () => {
      // First alias
      await request(app)
        .post(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({
          localPart: 'info',
          domainId: domainA1Id,
        });

      // Second alias with identical address
      const res = await request(app)
        .post(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({
          localPart: 'info',
          domainId: domainA1Id,
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('ALIAS_EXISTS');
    });

    it('ignores a submitted foreign domain and uses the mailbox domain', async () => {
      const res = await request(app)
        .post(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({
          localPart: 'hacker',
          domainId: domainBId, // Belongs to Tenant B
        });

      expect(res.status).toBe(201);
      expect(res.body.alias.address).toBe('hacker@acme.com');
    });

    it('does not let an unrelated inactive domain block an alias on the mailbox domain', async () => {
      await DomainModel.findByIdAndUpdate(domainA2Id, { dnsStatus: 'pending' });

      const res = await request(app)
        .post(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({
          localPart: 'testing',
          domainId: domainA2Id,
        });

      expect(res.status).toBe(201);
      expect(res.body.alias.address).toBe('testing@acme.com');
    });

    it('rejects alias creation if target mailbox is suspended', async () => {
      await MailboxModel.findByIdAndUpdate(mailboxAId, { status: 'suspended' });

      const res = await request(app)
        .post(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({
          localPart: 'testing',
          domainId: domainA1Id,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('MAILBOX_SUSPENDED');
    });

    it('rejects alias creation with invalid local part characters', async () => {
      const res = await request(app)
        .post(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({
          localPart: 'bad spaces!',
          domainId: domainA1Id,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('Alias Listing', () => {
    it('returns empty array when mailbox has no aliases', async () => {
      const res = await request(app)
        .get(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.aliases).toEqual([]);
    });

    it('returns configured aliases in list response and in tenant mailbox listing', async () => {
      // Add two aliases
      await request(app)
        .post(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({ localPart: 'support', domainId: domainA1Id, description: 'Support' });

      await request(app)
        .post(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({ localPart: 'billing', domainId: domainA1Id, description: 'Billing' });

      // List via mailbox-scoped route
      const aliasRes = await request(app)
        .get(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(aliasRes.status).toBe(200);
      expect(aliasRes.body.aliases).toHaveLength(2);
      expect(aliasRes.body.aliases.map((a: any) => a.address)).toEqual([
        'support@acme.com',
        'billing@acme.com',
      ]);

      // List via /api/tenants/me/mailboxes
      const mbRes = await request(app)
        .get('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(mbRes.status).toBe(200);
      const mb = mbRes.body.mailboxes.find((m: any) => m.id === mailboxAId);
      expect(mb.aliases).toHaveLength(2);
      expect(mb.aliases[0].address).toBe('support@acme.com');
    });
  });

  describe('Alias Deletion', () => {
    it('deletes an alias successfully, removes from Stalwart, and preserves remaining aliases', async () => {
      // Add two aliases
      const alias1Res = await request(app)
        .post(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({ localPart: 'alias1', domainId: domainA1Id });

      const alias2Res = await request(app)
        .post(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({ localPart: 'alias2', domainId: domainA1Id });

      const alias1Id = alias1Res.body.alias.id;
      const alias2Id = alias2Res.body.alias.id;

      // Reset spy counts
      vi.clearAllMocks();

      // Delete alias 1
      const delRes = await request(app)
        .delete(`/api/mailboxes/${mailboxAId}/aliases/${alias1Id}`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(delRes.status).toBe(200);
      expect(delRes.body.message).toContain('successfully deleted');

      // Verify Stalwart client updateAccountAliases was called with remaining alias 2 only
      expect(stalwartClient.updateAccountAliases).toHaveBeenCalledWith(
        'acc-alice-123',
        [
          {
            name: 'alias2',
            domainId: 'dom-acme',
            description: null,
            enabled: true,
          },
        ]
      );

      // Verify MongoDB has only alias 2
      const updatedMb = await MailboxModel.findById(mailboxAId);
      expect(updatedMb?.aliases).toHaveLength(1);
      expect(updatedMb?.aliases[0]._id.toString()).toBe(alias2Id);

      // Audit log check
      const audit = await AuditLogModel.findOne({ action: 'MAILBOX_ALIAS_DELETED' });
      expect(audit).toBeDefined();
      expect(audit?.metadata?.address).toBe('alias1@acme.com');
    });

    it('returns 404 when trying to delete a non-existent alias', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .delete(`/api/mailboxes/${mailboxAId}/aliases/${nonExistentId}`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('ALIAS_NOT_FOUND');
    });
  });

  describe('Cross-Tenant IDOR Protection', () => {
    it('prevents Tenant B from viewing Tenant A mailbox aliases', async () => {
      const res = await request(app)
        .get(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminBToken}`);

      expect(res.status).toBe(404);
    });

    it('prevents Tenant B from adding an alias to Tenant A mailbox', async () => {
      const res = await request(app)
        .post(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminBToken}`)
        .send({
          localPart: 'hacked',
          domainId: domainBId,
        });

      expect(res.status).toBe(404);
    });

    it('prevents Tenant B from deleting an alias from Tenant A mailbox', async () => {
      const addRes = await request(app)
        .post(`/api/mailboxes/${mailboxAId}/aliases`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({ localPart: 'support', domainId: domainA1Id });

      const aliasId = addRes.body.alias.id;

      const res = await request(app)
        .delete(`/api/mailboxes/${mailboxAId}/aliases/${aliasId}`)
        .set('Authorization', `Bearer ${tenantAdminBToken}`);

      expect(res.status).toBe(404);
    });
  });
});

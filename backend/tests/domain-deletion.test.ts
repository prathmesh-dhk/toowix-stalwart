import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import {
  TenantModel,
  DomainModel,
  MailboxModel,
  DomainSubscriptionModel,
  DomainDnsCredentialModel,
  AdminUserModel,
} from '../src/db/models';
import {
  deleteDomainDirectly,
  DomainDeletionError,
} from '../src/services/domain-deletion.service';
import { stripeClient } from '../src/stripe/client';
import { stalwartClient } from '../src/stalwart/client';

let mongoServer: MongoMemoryServer;

describe('Domain Deletion Service & Cascades', () => {
  let tenantId: string;
  let domainId: string;
  let domain2Id: string;
  let adminUserId: string;

  const tenantActor = { id: '', email: 'tenant@acme.com', role: 'TENANT_ADMIN' };
  const superAdminActor = { id: '', email: 'super@toowix.com', role: 'SUPER_ADMIN' };

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri(), autoIndex: true });
    process.env.GODADDY_CREDENTIAL_ENCRYPTION_KEY = 'test-only-godaddy-encryption-key-32b';
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await TenantModel.deleteMany({});
    await DomainModel.deleteMany({});
    await MailboxModel.deleteMany({});
    await DomainSubscriptionModel.deleteMany({});
    await DomainDnsCredentialModel.deleteMany({});
    await AdminUserModel.deleteMany({});

    const tenant = await TenantModel.create({
      name: 'Acme Corp',
      status: 'active',
      mailboxLimit: 10,
      mailboxCount: 0,
    });
    tenantId = tenant._id.toString();

    const domain = await DomainModel.create({
      tenantId: tenant._id,
      domainName: 'acme.com',
      status: 'active',
      dnsStatus: 'active',
      mailboxLimit: 10,
      employeeCount: 10,
      isPrimary: true,
      stalwartDomainId: 'stalwart-dom-1',
    });
    domainId = domain._id.toString();

    const domain2 = await DomainModel.create({
      tenantId: tenant._id,
      domainName: 'secondary.com',
      status: 'active',
      dnsStatus: 'active',
      mailboxLimit: 5,
      employeeCount: 5,
      isPrimary: false,
      stalwartDomainId: 'stalwart-dom-2',
    });
    domain2Id = domain2._id.toString();

    const admin = await AdminUserModel.create({
      tenantId: tenant._id,
      email: 'admin@acme.com',
      role: 'TENANT_ADMIN',
      status: 'active',
      passwordHash: 'dummy',
    });
    adminUserId = admin._id.toString();
    tenantActor.id = adminUserId;

    const superAdmin = await AdminUserModel.create({
      email: 'super@toowix.com',
      role: 'SUPER_ADMIN',
      status: 'active',
      passwordHash: 'dummy',
    });
    superAdminActor.id = superAdmin._id.toString();
  });

  describe('deleteDomainDirectly', () => {
    it('rejects deletion if mailboxes exist on the domain', async () => {
      await MailboxModel.create({
        tenantId,
        domainId,
        address: 'ceo@acme.com',
        localPart: 'ceo',
        domain: 'acme.com',
        status: 'active',
        storageUsedBytes: 0,
      });

      await expect(deleteDomainDirectly(domainId, tenantId, tenantActor)).rejects.toMatchObject({
        code: 'MAILBOXES_EXIST',
        statusCode: 400,
      });

      const domInDb = await DomainModel.findById(domainId);
      expect(domInDb).not.toBeNull();
    });

    it('executes the full cascade immediately with no Super Admin approval, and resolves any pending request', async () => {
      const cancelSubSpy = vi.spyOn(stripeClient, 'cancelSubscription').mockResolvedValue({} as any);
      const deleteStalwartSpy = vi.spyOn(stalwartClient, 'deleteDomain').mockResolvedValue();

      await DomainSubscriptionModel.create({
        domainId,
        tenantId,
        planId: new mongoose.Types.ObjectId(),
        stripeSubscriptionId: 'sub_live_98765',
        stripeSubscriptionItemId: 'si_98765',
        status: 'active',
        cancelAtPeriodEnd: false,
        peakMailboxCountThisPeriod: 0,
      });

      await DomainDnsCredentialModel.create({
        domainId,
        tenantId,
        provider: 'cloudflare',
        credentialEncrypted: 'mock_encrypted_secret',
        verifiedProviderDomain: 'acme.com',
        connectedAt: new Date(),
        connectedBy: tenantActor.id,
      });

      const result = await deleteDomainDirectly(domainId, tenantId, tenantActor);
      expect(result.success).toBe(true);
      expect(result.domainName).toBe('acme.com');

      expect(cancelSubSpy).toHaveBeenCalledWith('sub_live_98765');
      expect(await DomainSubscriptionModel.findOne({ domainId })).toBeNull();
      expect(await DomainDnsCredentialModel.findOne({ domainId })).toBeNull();
      expect(deleteStalwartSpy).toHaveBeenCalledWith('stalwart-dom-1');
      expect(await DomainModel.findById(domainId)).toBeNull();

      const secondaryDom = await DomainModel.findById(domain2Id);
      expect(secondaryDom?.isPrimary).toBe(true);
    });

    it('rejects deletion for a domain not owned by the tenant', async () => {
      const otherTenant = await TenantModel.create({ name: 'Other Co', status: 'active', mailboxLimit: 5, mailboxCount: 0 });
      await expect(
        deleteDomainDirectly(domainId, otherTenant._id.toString(), tenantActor)
      ).rejects.toMatchObject({ code: 'DOMAIN_NOT_FOUND', statusCode: 404 });
    });
  });

});

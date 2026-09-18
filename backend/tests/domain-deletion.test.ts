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
  DomainDeletionRequestModel,
  AdminUserModel,
} from '../src/db/models';
import {
  requestDomainDeletion,
  approveDomainDeletion,
  rejectDomainDeletion,
  listDomainDeletionRequests,
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
    await DomainDeletionRequestModel.deleteMany({});
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

  describe('requestDomainDeletion', () => {
    it('rejects deletion request if mailboxes exist on the domain', async () => {
      await MailboxModel.create({
        tenantId,
        domainId,
        address: 'ceo@acme.com',
        localPart: 'ceo',
        domain: 'acme.com',
        status: 'active',
        storageUsedBytes: 0,
      });

      await expect(
        requestDomainDeletion(domainId, tenantId, tenantActor, 'Cleaning up')
      ).rejects.toThrow(DomainDeletionError);

      await expect(
        requestDomainDeletion(domainId, tenantId, tenantActor, 'Cleaning up')
      ).rejects.toMatchObject({
        code: 'MAILBOXES_EXIST',
        statusCode: 400,
      });
    });

    it('creates a pending deletion request when domain has zero mailboxes', async () => {
      const reqDoc = await requestDomainDeletion(domainId, tenantId, tenantActor, 'Shutting down brand');
      expect(reqDoc).toBeDefined();
      expect(reqDoc.status).toBe('pending');
      expect(reqDoc.domainName).toBe('acme.com');
      expect(reqDoc.reason).toBe('Shutting down brand');
      expect(reqDoc.requestedByEmail).toBe('tenant@acme.com');

      const inDb = await DomainDeletionRequestModel.findById(reqDoc._id);
      expect(inDb?.status).toBe('pending');
    });

    it('rejects duplicate pending deletion requests for the same domain', async () => {
      await requestDomainDeletion(domainId, tenantId, tenantActor, 'First try');

      await expect(
        requestDomainDeletion(domainId, tenantId, tenantActor, 'Second try')
      ).rejects.toMatchObject({
        code: 'DELETION_REQUEST_ALREADY_PENDING',
        statusCode: 409,
      });
    });
  });

  describe('approveDomainDeletion', () => {
    it('executes full cascade: cancels Stripe subscription, deletes credentials, Stalwart domain, and MongoDB domain', async () => {
      // 1. Setup live Stripe subscription & credential mocks
      const cancelSubSpy = vi.spyOn(stripeClient, 'cancelSubscription').mockResolvedValue({} as any);
      const deleteStalwartSpy = vi.spyOn(stalwartClient, 'deleteDomain').mockResolvedValue();

      await DomainSubscriptionModel.create({
        domainId,
        tenantId,
        planId: new mongoose.Types.ObjectId(),
        stripeSubscriptionId: 'sub_live_12345',
        stripeSubscriptionItemId: 'si_12345',
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

      // 2. Submit deletion request
      const reqDoc = await requestDomainDeletion(domainId, tenantId, tenantActor);

      // 3. Approve deletion request
      const result = await approveDomainDeletion(reqDoc._id.toString(), superAdminActor);
      expect(result.success).toBe(true);
      expect(result.domainName).toBe('acme.com');

      // 4. Verify Stripe cancellation
      expect(cancelSubSpy).toHaveBeenCalledWith('sub_live_12345');
      const subInDb = await DomainSubscriptionModel.findOne({ domainId });
      expect(subInDb).toBeNull();

      // 5. Verify DNS credential purged
      const credInDb = await DomainDnsCredentialModel.findOne({ domainId });
      expect(credInDb).toBeNull();

      // 6. Verify Stalwart domain deleted
      expect(deleteStalwartSpy).toHaveBeenCalledWith('stalwart-dom-1');

      // 7. Verify MongoDB Domain deleted
      const domInDb = await DomainModel.findById(domainId);
      expect(domInDb).toBeNull();

      // 8. Verify primary domain reassigned to secondary.com
      const secondaryDom = await DomainModel.findById(domain2Id);
      expect(secondaryDom?.isPrimary).toBe(true);

      // 9. Verify request marked approved
      const updatedReq = await DomainDeletionRequestModel.findById(reqDoc._id);
      expect(updatedReq?.status).toBe('approved');
      expect(updatedReq?.reviewedByEmail).toBe('super@toowix.com');
      expect(updatedReq?.reviewedAt).toBeInstanceOf(Date);
    });

    it('rejects approval if mailboxes were created in the interim', async () => {
      const reqDoc = await requestDomainDeletion(domainId, tenantId, tenantActor);

      // A mailbox gets created before Super Admin reviews
      await MailboxModel.create({
        tenantId,
        domainId,
        address: 'newuser@acme.com',
        localPart: 'newuser',
        domain: 'acme.com',
        status: 'active',
        storageUsedBytes: 0,
      });

      await expect(
        approveDomainDeletion(reqDoc._id.toString(), superAdminActor)
      ).rejects.toMatchObject({
        code: 'MAILBOXES_EXIST',
        statusCode: 400,
      });
    });
  });

  describe('rejectDomainDeletion', () => {
    it('marks request rejected with reason and leaves domain untouched', async () => {
      const reqDoc = await requestDomainDeletion(domainId, tenantId, tenantActor, 'Mistake');

      const result = await rejectDomainDeletion(
        reqDoc._id.toString(),
        superAdminActor,
        'Tenant still has contracts active.'
      );

      expect(result.success).toBe(true);

      const updatedReq = await DomainDeletionRequestModel.findById(reqDoc._id);
      expect(updatedReq?.status).toBe('rejected');
      expect(updatedReq?.rejectionReason).toBe('Tenant still has contracts active.');
      expect(updatedReq?.reviewedByEmail).toBe('super@toowix.com');

      // Domain still exists
      const domInDb = await DomainModel.findById(domainId);
      expect(domInDb).not.toBeNull();
    });
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

      // A pending request already exists from an earlier attempt (e.g. the
      // tenant requested review before this feature existed, or a mailbox
      // was later removed making instant delete available).
      const pendingReq = await requestDomainDeletion(domainId, tenantId, tenantActor, 'Earlier attempt');

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

      const updatedPendingReq = await DomainDeletionRequestModel.findById(pendingReq._id);
      expect(updatedPendingReq?.status).toBe('approved');
    });

    it('rejects deletion for a domain not owned by the tenant', async () => {
      const otherTenant = await TenantModel.create({ name: 'Other Co', status: 'active', mailboxLimit: 5, mailboxCount: 0 });
      await expect(
        deleteDomainDirectly(domainId, otherTenant._id.toString(), tenantActor)
      ).rejects.toMatchObject({ code: 'DOMAIN_NOT_FOUND', statusCode: 404 });
    });
  });

  describe('listDomainDeletionRequests', () => {
    it('returns paginated list of requests with populated tenant name', async () => {
      await requestDomainDeletion(domainId, tenantId, tenantActor, 'Reason 1');
      await requestDomainDeletion(domain2Id, tenantId, tenantActor, 'Reason 2');

      const result = await listDomainDeletionRequests({ status: 'PENDING', limit: 10, skip: 0 });
      expect(result.total).toBe(2);
      expect(result.requests.length).toBe(2);
      expect(result.requests[0].tenantName).toBe('Acme Corp');
      expect(result.requests[0].status).toBe('pending');
    });
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { TenantModel, DomainModel, SystemSettingsModel } from '../src/db/models';
import { runSweepOnce } from '../src/jobs/dns-propagation-sweep.job';
import * as domainActivationService from '../src/services/domain-activation.service';

vi.mock('dns/promises', () => ({
  resolveMx: vi.fn(),
  resolveTxt: vi.fn(),
}));

import { resolveMx, resolveTxt } from 'dns/promises';

let mongoServer: MongoMemoryServer;

describe('dns-propagation-sweep.job', () => {
  let tenantId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri(), autoIndex: true });
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await TenantModel.deleteMany({});
    await DomainModel.deleteMany({});
    await SystemSettingsModel.deleteMany({});

    const tenant = await TenantModel.create({ name: 'Acme', status: 'active', mailboxLimit: 50, mailboxCount: 0 });
    tenantId = tenant._id.toString();

    vi.mocked(resolveMx).mockReset();
    vi.mocked(resolveTxt).mockReset();
    vi.spyOn(domainActivationService, 'notifyActivationFailure').mockResolvedValue(undefined);
  });

  it('re-verifies an activating domain and flips it to active when DNS now resolves', async () => {
    const domain = await DomainModel.create({
      tenantId,
      domainName: 'ready.com',
      status: 'active',
      dnsStatus: 'activating',
      dnsVerificationStartedAt: new Date(),
      isPrimary: true,
      dnsRecords: [{ type: 'MX', name: '@', value: 'mail.toowix.com', priority: 10, ttl: 3600, purpose: 'MX' }],
    });

    vi.mocked(resolveMx).mockResolvedValue([{ exchange: 'mail.toowix.com', priority: 10 }] as any);

    const result = await runSweepOnce();

    expect(result.checked).toBe(1);
    expect(result.activated).toBe(1);
    expect(result.timedOut).toBe(0);

    const updated = await DomainModel.findById(domain._id);
    expect(updated?.dnsStatus).toBe('active');
  });

  it('leaves a domain activating if still not resolvable and within the window', async () => {
    await DomainModel.create({
      tenantId,
      domainName: 'waiting.com',
      status: 'active',
      dnsStatus: 'activating',
      dnsVerificationStartedAt: new Date(),
      isPrimary: true,
      dnsRecords: [{ type: 'MX', name: '@', value: 'mail.toowix.com', priority: 10, ttl: 3600, purpose: 'MX' }],
    });

    vi.mocked(resolveMx).mockRejectedValue(new Error('ENOTFOUND'));

    const result = await runSweepOnce();
    expect(result.activated).toBe(0);
    expect(result.timedOut).toBe(0);
  });

  it('flags a domain as activation_failed once past the configured max window', async () => {
    await SystemSettingsModel.create({ key: 'dns_activation_config', dnsActivationMaxHours: 1, dnsSweepIntervalMinutes: 15, alertsEnabled: false, consecutiveFailureThreshold: 3 });

    const staleStart = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago, past the 1h max
    await DomainModel.create({
      tenantId,
      domainName: 'stale.com',
      status: 'active',
      dnsStatus: 'activating',
      dnsVerificationStartedAt: staleStart,
      isPrimary: true,
    });

    const result = await runSweepOnce();

    expect(result.timedOut).toBe(1);
    const domain = await DomainModel.findOne({ domainName: 'stale.com' });
    expect(domain?.dnsStatus).toBe('activation_failed');
    expect(domainActivationService.notifyActivationFailure).toHaveBeenCalled();
  });

  it('skips a concurrent sweep if one is already in progress (re-entrancy guard)', async () => {
    await DomainModel.create({
      tenantId,
      domainName: 'busy.com',
      status: 'active',
      dnsStatus: 'activating',
      dnsVerificationStartedAt: new Date(),
      isPrimary: true,
    });
    vi.mocked(resolveMx).mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve([]), 50)));

    const [first, second] = await Promise.all([runSweepOnce(), runSweepOnce()]);
    // One of the two calls should have been skipped (checked: 0) due to the guard.
    const checkedCounts = [first.checked, second.checked].sort();
    expect(checkedCounts).toEqual([0, 1]);
  });
});

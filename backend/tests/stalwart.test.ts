import { describe, it, expect } from 'vitest';
import { stalwartClient } from '../src/stalwart/client';
import { StalwartDomainExistsError, StalwartAccountExistsError } from '../src/stalwart/errors';

describe('Phase 5: Stalwart Integration Client', () => {
  let createdDomainId: string;
  let createdAccountId: string;

  it('should list existing domains from Stalwart', async () => {
    const domains = await stalwartClient.listDomains();
    expect(domains.length).toBeGreaterThan(0);
    const primary = domains.find(d => d.name === 'toowix.test');
    expect(primary).toBeDefined();
  });

  it('should create a domain and return its ID', async () => {
    const testDomain = 'phase5-test.test';
    const domain = await stalwartClient.createDomain(testDomain, 'Phase 5 Test Domain');
    expect(domain.id).toBeDefined();
    expect(domain.name).toBe(testDomain);
    createdDomainId = domain.id;
  });

  it('should throw StalwartDomainExistsError on duplicate domain creation', async () => {
    await expect(
      stalwartClient.createDomain('phase5-test.test')
    ).rejects.toThrow(StalwartDomainExistsError);
  });

  it('should create a mailbox account under the created domain', async () => {
    const account = await stalwartClient.createAccount({
      name: 'bruce',
      domainId: createdDomainId,
      password: 'BruceSecurePass123!',
      description: 'Bruce Wayne',
    });

    expect(account.id).toBeDefined();
    expect(account.name).toBe('bruce');
    expect(account.emailAddress).toBe('bruce@phase5-test.test');
    createdAccountId = account.id;
  });

  it('should throw StalwartAccountExistsError on duplicate account creation', async () => {
    await expect(
      stalwartClient.createAccount({
        name: 'bruce',
        domainId: createdDomainId,
        password: 'AnotherPassword123!',
      })
    ).rejects.toThrow(StalwartAccountExistsError);
  });

  it('should update account password successfully', async () => {
    await expect(
      stalwartClient.updateAccountPassword(createdAccountId, 'NewBrucePass456!')
    ).resolves.not.toThrow();
  });

  it('should delete the mailbox account successfully', async () => {
    await expect(
      stalwartClient.deleteAccount(createdAccountId)
    ).resolves.not.toThrow();
  });

  it('should delete the domain and its linked DKIM keys successfully', async () => {
    await expect(
      stalwartClient.deleteDomain(createdDomainId)
    ).resolves.not.toThrow();
  });
});

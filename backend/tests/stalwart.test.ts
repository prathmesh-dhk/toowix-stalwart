import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import https from 'https';
import { StalwartClient, stalwartClient } from '../src/stalwart/client';
import {
  StalwartError,
  StalwartDomainExistsError,
  StalwartAccountExistsError,
} from '../src/stalwart/errors';
import { config } from '../src/config';

// Probe if live Stalwart server is reachable on the configured port
async function checkStalwartReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(`${config.stalwart.url}/jmap/`);
      const transport = parsed.protocol === 'https:' ? https : http;
      const req = transport.request(
        parsed,
        {
          method: 'POST',
          timeout: 1000,
          rejectUnauthorized: false,
        },
        () => {
          resolve(true);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    } catch {
      resolve(false);
    }
  });
}

const isStalwartOnline = await checkStalwartReachable();

describe.skipIf(!isStalwartOnline)('Phase 5: Stalwart Integration Client (Live Server)', () => {
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

describe('Phase 5: Stalwart Client Unit Tests (Offline / Mocked)', () => {
  let client: StalwartClient;

  beforeEach(() => {
    client = new StalwartClient();
  });

  it('should parse domain list correctly from JMAP response', async () => {
    const mockDispatch = vi.fn().mockResolvedValue([
      [
        'x:Domain/get',
        {
          list: [
            { id: 'dom-1', name: 'toowix.test', description: 'Primary System Domain' },
            { id: 'dom-2', name: 'acme.com', description: 'Acme Corp' },
          ],
        },
        'c_list_dom',
      ],
    ]);
    (client as any).dispatch = mockDispatch;

    const domains = await client.listDomains();
    expect(domains).toHaveLength(2);
    expect(domains[0]).toEqual({
      id: 'dom-1',
      name: 'toowix.test',
      description: 'Primary System Domain',
    });
    expect(domains[1].name).toBe('acme.com');
  });

  it('should create domain and extract ID and name', async () => {
    const mockDispatch = vi.fn().mockResolvedValue([
      [
        'x:Domain/set',
        {
          created: {
            dom_new: { id: 'dom-new-123' },
          },
        },
        'c_create_dom',
      ],
    ]);
    (client as any).dispatch = mockDispatch;

    const result = await client.createDomain('newdomain.org', 'Test Org');
    expect(result.id).toBe('dom-new-123');
    expect(result.name).toBe('newdomain.org');
    expect(mockDispatch).toHaveBeenCalledWith([
      [
        'x:Domain/set',
        {
          accountId: 'b',
          create: {
            dom_new: {
              name: 'newdomain.org',
              description: 'Test Org',
              isEnabled: true,
            },
          },
        },
        'c_create_dom',
      ],
    ]);
  });

  it('should throw StalwartDomainExistsError on duplicate domain creation', async () => {
    const mockDispatch = vi.fn().mockResolvedValue([
      [
        'x:Domain/set',
        {
          notCreated: {
            dom_new: {
              type: 'primaryKeyViolation',
              description: 'Domain already exists',
            },
          },
        },
        'c_create_dom',
      ],
    ]);
    (client as any).dispatch = mockDispatch;

    await expect(client.createDomain('duplicate.test')).rejects.toThrow(StalwartDomainExistsError);
  });

  it('should throw StalwartAccountExistsError on duplicate mailbox account creation', async () => {
    const mockDispatch = vi.fn().mockResolvedValue([
      [
        'x:Account/set',
        {
          notCreated: {
            acc_new: {
              type: 'primaryKeyViolation',
              description: 'Account name already taken',
            },
          },
        },
        'c_create_acc',
      ],
    ]);
    (client as any).dispatch = mockDispatch;

    await expect(
      client.createAccount({
        name: 'duplicateuser',
        domainId: 'dom-1',
        password: 'Password123!',
      })
    ).rejects.toThrow(StalwartAccountExistsError);
  });

  it('should update account password with correct JMAP credential structure', async () => {
    const mockDispatch = vi.fn().mockResolvedValue([
      [
        'x:Account/set',
        {
          updated: { 'acc-user-1': {} },
        },
        'c_update_pass',
      ],
    ]);
    (client as any).dispatch = mockDispatch;

    await client.updateAccountPassword('acc-user-1', 'NewPassword2026!');
    expect(mockDispatch).toHaveBeenCalledWith([
      [
        'x:Account/set',
        {
          accountId: 'b',
          update: {
            'acc-user-1': {
              credentials: {
                '0': {
                  '@type': 'Password',
                  secret: 'NewPassword2026!',
                },
              },
            },
          },
        },
        'c_update_pass',
      ],
    ]);
  });

  it('should update account status to suspended using Replace permissions payload', async () => {
    const mockDispatch = vi.fn().mockResolvedValue([
      [
        'x:Account/set',
        {
          updated: { 'acc-user-1': {} },
        },
        'c_update_acc_status',
      ],
    ]);
    (client as any).dispatch = mockDispatch;

    await client.updateAccountStatus('acc-user-1', true);
    expect(mockDispatch).toHaveBeenCalledWith([
      [
        'x:Account/set',
        {
          accountId: 'b',
          update: {
            'acc-user-1': {
              permissions: {
                '@type': 'Replace',
                enabledPermissions: {},
                disabledPermissions: {},
              },
            },
          },
        },
        'c_update_acc_status',
      ],
    ]);
  });

  it('should update account status to active using Inherit permissions payload', async () => {
    const mockDispatch = vi.fn().mockResolvedValue([
      [
        'x:Account/set',
        {
          updated: { 'acc-user-1': {} },
        },
        'c_update_acc_status',
      ],
    ]);
    (client as any).dispatch = mockDispatch;

    await client.updateAccountStatus('acc-user-1', false);
    expect(mockDispatch).toHaveBeenCalledWith([
      [
        'x:Account/set',
        {
          accountId: 'b',
          update: {
            'acc-user-1': {
              permissions: {
                '@type': 'Inherit',
              },
            },
          },
        },
        'c_update_acc_status',
      ],
    ]);
  });

  it('should convert MB to bytes when updating mail limits', async () => {
    const mockDispatch = vi.fn().mockResolvedValue([
      ['x:Email/set', { updated: { singleton: null } }, 'c_update_email_limits'],
      ['x:Jmap/set', { updated: { singleton: null } }, 'c_update_jmap_limits'],
      ['x:Action/set', { created: { reload_limits: { id: 'act1' } } }, 'c_reload_settings'],
    ]);
    (client as any).dispatch = mockDispatch;

    await client.updateMailLimits({
      attachmentSizeMb: 15,
      messageSizeMb: 20,
      maxMailboxDepth: 5,
      maxMailboxNameLength: 100,
    });

    expect(mockDispatch).toHaveBeenCalledWith([
      [
        'x:Email/set',
        {
          accountId: 'b',
          update: {
            singleton: {
              maxAttachmentSize: 15 * 1024 * 1024,
              maxMessageSize: 20 * 1024 * 1024,
              maxMailboxDepth: 5,
              maxMailboxNameLength: 100,
            },
          },
        },
        'c_update_email_limits',
      ],
      [
        'x:Jmap/set',
        {
          accountId: 'b',
          update: {
            singleton: {
              maxUploadSize: 15 * 1024 * 1024,
              uploadQuota: 15 * 1024 * 1024,
            },
          },
        },
        'c_update_jmap_limits',
      ],
      [
        'x:Action/set',
        {
          accountId: 'b',
          create: {
            reload_limits: {
              '@type': 'ReloadSettings',
            },
          },
        },
        'c_reload_settings',
      ],
    ]);
  });

  it('should delete account successfully using destroy array', async () => {
    const mockDispatch = vi.fn().mockResolvedValue([
      [
        'x:Account/set',
        {
          destroyed: ['acc-to-delete'],
        },
        'c_del_acc',
      ],
    ]);
    (client as any).dispatch = mockDispatch;

    await client.deleteAccount('acc-to-delete');
    expect(mockDispatch).toHaveBeenCalledWith([
      ['x:Account/set', { accountId: 'b', destroy: ['acc-to-delete'] }, 'c_del_acc'],
    ]);
  });

  it('should delete linked DKIM signatures when deleting domain', async () => {
    const mockDispatch = vi
      .fn()
      // 1. List DKIM signatures for domain
      .mockResolvedValueOnce([
        [
          'x:DkimSignature/get',
          {
            list: [{ id: 'dkim-sig-1', domainId: 'dom-to-delete' }],
          },
          'c_get_dkim',
        ],
      ])
      // 2. Destroy DKIM signatures
      .mockResolvedValueOnce([
        [
          'x:DkimSignature/set',
          { destroyed: ['dkim-sig-1'] },
          'c_del_dkim',
        ],
      ])
      // 3. Destroy Domain
      .mockResolvedValueOnce([
        [
          'x:Domain/set',
          { destroyed: ['dom-to-delete'] },
          'c_del_dom',
        ],
      ]);
    (client as any).dispatch = mockDispatch;

    await client.deleteDomain('dom-to-delete');
    expect(mockDispatch).toHaveBeenCalledTimes(3);
  });
});

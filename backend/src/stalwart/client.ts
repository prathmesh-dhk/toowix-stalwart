import http from 'http';
import https from 'https';
import { config } from '../config';
import {
  StalwartDomain,
  StalwartAccount,
  CreateAccountInput,
  StalwartCreatedAccount,
  StalwartDkimKey,
  StalwartBlockedIp,
  StalwartAllowedIp,
} from './types';
import {
  StalwartError,
  StalwartUnavailableError,
  StalwartDomainExistsError,
  StalwartAccountExistsError,
} from './errors';

export class StalwartClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly accountId: string;
  private cachedAcmeProviderId: string | null = null;

  constructor() {
    this.baseUrl = config.stalwart.url.replace(/\/+$/, '');
    const userPass = `${config.stalwart.user}:${config.stalwart.password}`;
    this.authHeader = `Basic ${Buffer.from(userPass).toString('base64')}`;
    this.accountId = config.stalwart.accountId || 'b';
  }

  /**
   * Dispatches low-level JMAP method calls to the Stalwart endpoint.
   */
  private async dispatch(methodCalls: [string, any, string][]): Promise<any[]> {
    const payload = JSON.stringify({
      using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
      methodCalls,
    });

    const url = new URL(`${this.baseUrl}/jmap/`);
    const transport = url.protocol === 'https:' ? https : http;

    try {
      const responseData = await new Promise<any>((resolve, reject) => {
        const req = transport.request(
          url,
          {
            method: 'POST',
            rejectUnauthorized: false, // For local dev with self-signed TLS
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
              'Authorization': this.authHeader,
            },
            timeout: 10000,
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 500) {
                return reject(new StalwartUnavailableError(`Stalwart server error: HTTP ${res.statusCode}`));
              }
              if (res.statusCode === 401 || res.statusCode === 403) {
                return reject(new StalwartError('Invalid Stalwart management credentials', 'AUTH_ERROR'));
              }
              try {
                const parsed = JSON.parse(body);
                resolve(parsed);
              } catch (e) {
                reject(new StalwartError('Invalid JSON response from Stalwart', 'PROTOCOL_ERROR', body));
              }
            });
          }
        );

        req.on('error', (err) => {
          reject(new StalwartUnavailableError(`Unable to reach Stalwart at ${this.baseUrl}: ${err.message}`));
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new StalwartUnavailableError('Stalwart request timed out'));
        });

        req.write(payload);
        req.end();
      });

      return responseData.methodResponses || [];
    } catch (err: any) {
      if (err instanceof StalwartError) throw err;
      throw new StalwartUnavailableError(`Network failure communicating with Stalwart: ${err.message}`);
    }
  }

  /**
   * Clears the cached ACME provider ID.
   */
  clearCachedAcmeProviderId(): void {
    this.cachedAcmeProviderId = null;
  }

  /**
   * Explicitly sets or overrides the cached ACME provider ID.
   */
  setAcmeProviderId(id: string | null): void {
    this.cachedAcmeProviderId = id;
  }

  /**
   * Resolves the ACME provider ID configured on Stalwart.
   * Prioritizes:
   * 1. Cached provider ID
   * 2. Explicit config (STALWART_ACME_PROVIDER_ID)
   * 3. Provider matching account 3299314325 (from Stalwart UI)
   * 4. Provider matching Let's Encrypt directory
   * 5. First available provider in Stalwart
   * 6. Auto-creation of Let's Encrypt provider if none exist
   */
  async getAcmeProviderId(): Promise<string | null> {
    if (this.cachedAcmeProviderId) {
      return this.cachedAcmeProviderId;
    }

    if (config.stalwart.acmeProviderId) {
      this.cachedAcmeProviderId = config.stalwart.acmeProviderId;
      return this.cachedAcmeProviderId;
    }

    try {
      const responses = await this.dispatch([
        [
          'x:AcmeProvider/get',
          { accountId: this.accountId },
          'c_get_acme_prov',
        ],
      ]);

      const list: any[] = responses[0]?.[1]?.list || [];
      if (list.length > 0) {
        // Priority 1: Match account 3299314325 (account ID from user setup)
        const byAccount = list.find((p: any) =>
          p.id === '3299314325' ||
          (typeof p.description === 'string' && p.description.includes('3299314325')) ||
          (typeof p.accountUri === 'string' && p.accountUri.includes('3299314325'))
        );
        if (byAccount) {
          this.cachedAcmeProviderId = byAccount.id;
          return this.cachedAcmeProviderId;
        }

        // Priority 2: Match Let's Encrypt directory
        const byDirectory = list.find((p: any) =>
          typeof p.directory === 'string' && p.directory.includes('acme-v02.api.letsencrypt.org')
        );
        if (byDirectory) {
          this.cachedAcmeProviderId = byDirectory.id;
          return this.cachedAcmeProviderId;
        }

        // Priority 3: First available provider
        this.cachedAcmeProviderId = list[0].id;
        return this.cachedAcmeProviderId;
      }

      // If no provider exists on Stalwart, attempt to create default Let's Encrypt ACME provider
      const adminEmail = config.smtp.user || 'admin@toowix.com';
      const createResponses = await this.dispatch([
        [
          'x:AcmeProvider/set',
          {
            accountId: this.accountId,
            create: {
              acme_le: {
                directory: 'https://acme-v02.api.letsencrypt.org/directory',
                contact: { [`mailto:${adminEmail}`]: true },
              },
            },
          },
          'c_create_acme_prov',
        ],
      ]);

      const createdId = createResponses[0]?.[1]?.created?.acme_le?.id;
      if (createdId) {
        this.cachedAcmeProviderId = createdId;
        return this.cachedAcmeProviderId;
      }
    } catch {
      // In case dispatch fails (e.g. mock test or offline network), return null
    }

    return null;
  }

  // --- Domain Methods ---

  /**
   * Creates a domain on Stalwart with Manual DKIM management and ACME TLS certificate management.
   */
  async createDomain(
    domainName: string,
    description?: string,
    options?: { acmeProviderId?: string }
  ): Promise<{ id: string; name: string }> {
    const normalized = domainName.trim().toLowerCase();
    const tempId = 'dom_new';

    const acmeProviderId = options?.acmeProviderId ?? (await this.getAcmeProviderId());

    const domainPayload: any = {
      name: normalized,
      description: description || null,
      isEnabled: true,
      dkimManagement: {
        '@type': 'Automatic',
        algorithms: { Dkim1Ed25519Sha256: true, Dkim1RsaSha256: true },
      },
    };

    if (acmeProviderId) {
      domainPayload.certificateManagement = {
        '@type': 'Automatic',
        acmeProviderId,
      };
    }

    const responses = await this.dispatch([
      [
        'x:Domain/set',
        {
          accountId: this.accountId,
          create: {
            [tempId]: domainPayload,
          },
        },
        'c_create_dom',
      ],
    ]);

    const result = responses[0]?.[1];
    if (result?.notCreated?.[tempId]) {
      const err = result.notCreated[tempId];
      if (err.type === 'primaryKeyViolation') {
        throw new StalwartDomainExistsError(normalized, err);
      }
      throw new StalwartError(`Failed to create domain on Stalwart: ${err.description || err.type}`, 'DOMAIN_CREATE_FAILED', err);
    }

    const createdId = result?.created?.[tempId]?.id;
    if (!createdId) {
      throw new StalwartError('Stalwart did not return a domain ID on creation', 'PROTOCOL_ERROR');
    }

    return { id: createdId, name: normalized };
  }

  /**
   * Retrieves all domains from Stalwart.
   */
  async listDomains(): Promise<StalwartDomain[]> {
    const responses = await this.dispatch([
      ['x:Domain/get', { accountId: this.accountId, ids: null }, 'c_list_dom'],
    ]);

    const list = responses[0]?.[1]?.list || [];
    return list.map((d: any) => ({
      id: d.id,
      name: d.name,
      isEnabled: d.isEnabled,
      createdAt: d.createdAt,
      description: d.description,
      dnsZoneFile: d.dnsZoneFile,
      dkimManagement: d.dkimManagement,
      certificateManagement: d.certificateManagement,
    }));
  }

  /**
   * Retrieves a single domain by its Stalwart ID (efficient single lookup
   * used by the domain-activation orchestrator instead of listing all).
   */
  async getDomain(domainId: string): Promise<StalwartDomain | null> {
    const responses = await this.dispatch([
      ['x:Domain/get', { accountId: this.accountId, ids: [domainId] }, 'c_get_dom'],
    ]);
    const list = responses[0]?.[1]?.list || [];
    const d = list[0];
    if (!d) return null;
    return {
      id: d.id,
      name: d.name,
      isEnabled: d.isEnabled,
      createdAt: d.createdAt,
      description: d.description,
      dnsZoneFile: d.dnsZoneFile,
      dkimManagement: d.dkimManagement,
      certificateManagement: d.certificateManagement,
    };
  }

  /**
   * Returns the active DKIM signatures (selector + public key) for a domain.
   * Stalwart auto-generates these at domain creation (see
   * docs/STALWART_API_NOTES.md §7) — normally one RSA + one Ed25519 entry.
   * `x:DkimSignature/get` has no server-side domainId filter, so this fetches
   * the full list and filters client-side, mirroring the existing pattern in
   * deleteDomain() below. Private key material is never returned by Stalwart
   * over this API (redacted server-side), so there is nothing to leak here.
   */
  async getActiveDkimKeys(domainId: string): Promise<StalwartDkimKey[]> {
    const responses = await this.dispatch([
      ['x:DkimSignature/get', { accountId: this.accountId, ids: null }, 'c_get_dkim_active'],
    ]);
    const list = responses[0]?.[1]?.list || [];
    return list
      .filter((k: any) => k.domainId === domainId && k.stage === 'active')
      .map((k: any) => ({
        id: k.id,
        domainId: k.domainId,
        selector: k.selector,
        algorithm: k['@type'],
        publicKey: k.publicKey,
        stage: k.stage,
        createdAt: k.createdAt,
      }));
  }

  /**
   * Polls getActiveDkimKeys() until keys appear or the budget runs out.
   * Stalwart generates DKIM keys asynchronously right after domain creation
   * — a single fixed-delay retry (the pattern this replaces, used to be a
   * one-shot 500-800ms wait) is a coin flip under any real load: too slow
   * and it's a wasted delay every time, too fast under load and the domain
   * permanently ships with no DKIM record in its initial zone file/DNS
   * provider sync, since nothing re-checks after that single retry.
   * Defaults to ~8 attempts / 500ms apart (4s worst case) — long enough for
   * real key generation, short enough not to visibly stall the caller.
   */
  async getActiveDkimKeysWithRetry(domainId: string, maxAttempts = 8, intervalMs = 500): Promise<StalwartDkimKey[]> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const keys = await this.getActiveDkimKeys(domainId);
      if (keys.length > 0) return keys;
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
    return [];
  }

  /**
   * Updates a domain's enabled status on Stalwart.
   */
  async updateDomainStatus(domainId: string, isEnabled: boolean): Promise<void> {
    const responses = await this.dispatch([
      [
        'x:Domain/set',
        {
          accountId: this.accountId,
          update: {
            [domainId]: {
              isEnabled,
            },
          },
        },
        'c_update_dom',
      ],
    ]);

    const result = responses[0]?.[1];
    if (result?.notUpdated?.[domainId]) {
      const err = result.notUpdated[domainId];
      throw new StalwartError(`Failed to update domain status in Stalwart: ${err.description || err.type}`, 'DOMAIN_UPDATE_FAILED', err);
    }
  }

  /**
   * Ensures a domain has Automatic DKIM management configured so RSA and Ed25519 keys exist.
   */
  async ensureAutomaticDkim(domainId: string): Promise<void> {
    const responses = await this.dispatch([
      [
        'x:Domain/set',
        {
          accountId: this.accountId,
          update: {
            [domainId]: {
              dkimManagement: {
                '@type': 'Automatic',
                algorithms: { Dkim1Ed25519Sha256: true, Dkim1RsaSha256: true },
              },
            },
          },
        },
        'c_ensure_auto_dkim',
      ],
    ]);

    const result = responses[0]?.[1];
    if (result?.notUpdated?.[domainId]) {
      const err = result.notUpdated[domainId];
      throw new StalwartError(`Failed to update DKIM management in Stalwart: ${err.description || err.type}`, 'DOMAIN_UPDATE_FAILED', err);
    }
  }

  /**
   * Destroys a domain and cleans up linked DKIM signatures.
   */
  async deleteDomain(domainId: string): Promise<void> {
    // 1. Find any linked DKIM signatures for this domain
    const dkimResponses = await this.dispatch([
      ['x:DkimSignature/get', { accountId: this.accountId, ids: null }, 'c_get_dkim'],
    ]);
    const dkimList = dkimResponses[0]?.[1]?.list || [];
    const linkedDkimIds = dkimList.filter((k: any) => k.domainId === domainId).map((k: any) => k.id);

    // 2. Delete linked DKIM keys first (Stalwart requires linked objects destroyed before domain)
    if (linkedDkimIds.length > 0) {
      await this.dispatch([
        ['x:DkimSignature/set', { accountId: this.accountId, destroy: linkedDkimIds }, 'c_del_dkim'],
      ]);
    }

    // 3. Delete the domain
    const responses = await this.dispatch([
      ['x:Domain/set', { accountId: this.accountId, destroy: [domainId] }, 'c_del_dom'],
    ]);
    const domainDelResult = responses[0]?.[1];

    if (domainDelResult?.notDestroyed?.[domainId]) {
      const err = domainDelResult.notDestroyed[domainId];
      if (err.type === 'objectIsLinked' && Array.isArray(err.linkedObjects)) {
        const dkimIds = err.linkedObjects
          .filter((obj: any) => obj.object === 'DkimSignature')
          .map((obj: any) => obj.id);
        if (dkimIds.length > 0) {
          await this.dispatch([
            ['x:DkimSignature/set', { accountId: this.accountId, destroy: dkimIds }, 'c_del_linked_dkim'],
          ]);
          // Retry deleting domain
          const retryResponses = await this.dispatch([
            ['x:Domain/set', { accountId: this.accountId, destroy: [domainId] }, 'c_del_dom_retry'],
          ]);
          if (!retryResponses[0]?.[1]?.notDestroyed?.[domainId]) {
            return;
          }
        }
      }
      throw new StalwartError(`Failed to delete domain ${domainId} in Stalwart: ${err.type}`, 'DOMAIN_DELETE_FAILED', err);
    }
  }

  // --- Account / Mailbox Methods ---

  /**
   * Creates a mailbox account in Stalwart.
   */
  async createAccount(input: CreateAccountInput): Promise<StalwartCreatedAccount> {
    const tempId = 'acc_new';
    const localPart = input.name.trim().toLowerCase();

    const responses = await this.dispatch([
      [
        'x:Account/set',
        {
          accountId: this.accountId,
          create: {
            [tempId]: {
              '@type': 'User',
              name: localPart,
              domainId: input.domainId,
              description: input.description || null,
              roles: { '@type': 'User' },
              credentials: {
                '0': {
                  '@type': 'Password',
                  secret: input.password,
                },
              },
            },
          },
        },
        'c_create_acc',
      ],
    ]);

    const result = responses[0]?.[1];
    if (result?.notCreated?.[tempId]) {
      const err = result.notCreated[tempId];
      if (err.type === 'primaryKeyViolation') {
        throw new StalwartAccountExistsError(localPart, err);
      }
      throw new StalwartError(`Failed to create account in Stalwart: ${err.description || err.type}`, 'ACCOUNT_CREATE_FAILED', err);
    }

    const createdId = result?.created?.[tempId]?.id;
    if (!createdId) {
      throw new StalwartError('Stalwart did not return an account ID on creation', 'PROTOCOL_ERROR');
    }

    // Retrieve details to get full emailAddress
    const getRes = await this.getAccount(createdId);
    return {
      id: createdId,
      name: localPart,
      domainId: input.domainId,
      emailAddress: getRes?.emailAddress || `${localPart}@unknown`,
    };
  }

  /**
   * Updates an account's password in Stalwart.
   */
  async updateAccountPassword(accountId: string, newPassword: string): Promise<void> {
    const responses = await this.dispatch([
      [
        'x:Account/set',
        {
          accountId: this.accountId,
          update: {
            [accountId]: {
              credentials: {
                '0': {
                  '@type': 'Password',
                  secret: newPassword,
                },
              },
            },
          },
        },
        'c_update_pass',
      ],
    ]);

    const result = responses[0]?.[1];
    if (result?.notUpdated?.[accountId]) {
      const err = result.notUpdated[accountId];
      throw new StalwartError(`Failed to update password in Stalwart: ${err.description || err.type}`, 'PASSWORD_UPDATE_FAILED', err);
    }
  }

  /**
   * Applies the configured mail limits to the live Stalwart runtime.
   * Values are stored in MB in the app and converted to bytes in Stalwart.
   */
  async updateMailLimits(limits: {
    attachmentSizeMb: number;
    messageSizeMb: number;
    maxMailboxDepth: number;
    maxMailboxNameLength: number;
  }): Promise<void> {
    const attachmentBytes = Math.max(1, Number(limits.attachmentSizeMb ?? 5)) * 1024 * 1024;
    const messageBytes = Math.max(1, Number(limits.messageSizeMb ?? 6)) * 1024 * 1024;
    const mailboxDepth = Math.max(1, Number(limits.maxMailboxDepth ?? 10));
    const mailboxNameLength = Math.max(1, Number(limits.maxMailboxNameLength ?? 255));

    const emailPayload = {
      maxAttachmentSize: attachmentBytes,
      maxMessageSize: messageBytes,
      maxMailboxDepth: mailboxDepth,
      maxMailboxNameLength: mailboxNameLength,
    };

    const jmapPayload = {
      maxUploadSize: attachmentBytes,
      uploadQuota: attachmentBytes,
    };

    try {
      const responses = await this.dispatch([
        [
          'x:Email/set',
          {
            accountId: this.accountId,
            update: {
              singleton: emailPayload,
            },
          },
          'c_update_email_limits',
        ],
        [
          'x:Jmap/set',
          {
            accountId: this.accountId,
            update: {
              singleton: jmapPayload,
            },
          },
          'c_update_jmap_limits',
        ],
        [
          'x:Action/set',
          {
            accountId: this.accountId,
            create: {
              reload_limits: {
                '@type': 'ReloadSettings',
              },
            },
          },
          'c_reload_settings',
        ],
      ]);

      const emailResult = responses[0]?.[1];
      if (emailResult?.notUpdated?.singleton) {
        const err = emailResult.notUpdated.singleton;
        if (err.type !== 'notFound') {
          throw new StalwartError(
            `Failed to update email limits in Stalwart: ${err.description || err.type}`,
            'MAIL_LIMITS_UPDATE_FAILED',
            err
          );
        }
      }
    } catch (err: any) {
      if (err instanceof StalwartError && err.code === 'MAIL_LIMITS_UPDATE_FAILED') {
        throw err;
      }
      console.warn(`[StalwartClient] Mail limits runtime sync warning: ${err.message}`);
    }
  }

  /**
   * Updates an account's active/suspended status in Stalwart.
   * When suspended: sets permissions to @type Replace with empty sets,
   *   which gives the account zero permissions (blocks all auth and mail sending).
   * When reactivated: restores default inherited permissions via @type Inherit.
   */
  async updateAccountStatus(accountId: string, isSuspended: boolean): Promise<void> {
    // Suspended: Replace all permissions with empty sets → zero permissions, cannot authenticate
    // Active: Inherit permissions from role (default User role)
    const permissionsPayload = isSuspended
      ? {
          '@type': 'Replace',
          enabledPermissions: {},
          disabledPermissions: {},
        }
      : {
          '@type': 'Inherit',
        };

    const responses = await this.dispatch([
      [
        'x:Account/set',
        {
          accountId: this.accountId,
          update: {
            [accountId]: {
              permissions: permissionsPayload,
            },
          },
        },
        'c_update_acc_status',
      ],
    ]);

    const result = responses[0]?.[1];
    if (result?.notUpdated?.[accountId]) {
      const err = result.notUpdated[accountId];
      throw new StalwartError(
        `Failed to update account status in Stalwart: ${err.description || err.type}`,
        'ACCOUNT_UPDATE_FAILED',
        err
      );
    }
  }

  /**
   * Deletes an account from Stalwart.
   */
  async deleteAccount(accountId: string): Promise<void> {
    const responses = await this.dispatch([
      ['x:Account/set', { accountId: this.accountId, destroy: [accountId] }, 'c_del_acc'],
    ]);

    const result = responses[0]?.[1];
    if (result?.notDestroyed?.[accountId]) {
      const err = result.notDestroyed[accountId];
      throw new StalwartError(`Failed to delete account ${accountId} in Stalwart: ${err.type}`, 'ACCOUNT_DELETE_FAILED', err);
    }
  }

  /**
   * Lists all accounts from Stalwart.
   */
  async listAccounts(): Promise<StalwartAccount[]> {
    const responses = await this.dispatch([
      ['x:Account/get', { accountId: this.accountId, ids: null }, 'c_list_acc'],
    ]);

    const list = responses[0]?.[1]?.list || [];
    return list.map((a: any) => ({
      id: a.id,
      name: a.name,
      domainId: a.domainId,
      emailAddress: a.emailAddress,
      description: a.description,
      createdAt: a.createdAt,
      roles: a.roles,
    }));
  }

  /**
   * Gets single account by ID from Stalwart.
   */
  async getAccount(accountId: string): Promise<StalwartAccount | null> {
    const responses = await this.dispatch([
      ['x:Account/get', { accountId: this.accountId, ids: [accountId] }, 'c_get_acc'],
    ]);

    const acc = responses[0]?.[1]?.list?.[0];
    if (!acc) return null;
    return {
      id: acc.id,
      name: acc.name,
      domainId: acc.domainId,
      emailAddress: acc.emailAddress,
      description: acc.description,
      createdAt: acc.createdAt,
      roles: acc.roles,
    };
  }

  /**
   * Fetches all accounts with their storage usage (usedDiskQuota).
   * Returns a map of stalwartAccountId → storageBytes.
   */
  async listAccountsWithStorage(): Promise<Map<string, number>> {
    const responses = await this.dispatch([
      ['x:Account/get', { accountId: this.accountId, ids: null }, 'c_list_storage'],
    ]);

    const list = responses[0]?.[1]?.list || [];
    const result = new Map<string, number>();
    for (const a of list) {
      result.set(a.id, typeof a.usedDiskQuota === 'number' ? a.usedDiskQuota : 0);
    }
    return result;
  }

  /**
   * Fetches email counts (sent, inbox, total) for a single mailbox account
   * using admin-level impersonation via JMAP Mailbox/get.
   * Returns { emailsSent, emailsInbox, totalEmails }.
   */
  async getAccountEmailCounts(stalwartAccountId: string): Promise<{
    emailsSent: number;
    emailsInbox: number;
    totalEmails: number;
  }> {
    const responses = await this.dispatch([
      [
        'Mailbox/get',
        {
          accountId: stalwartAccountId,
          ids: null,
          properties: ['id', 'name', 'role', 'totalEmails'],
        },
        'c_get_mbox_counts',
      ],
    ]);

    const folders: any[] = responses[0]?.[1]?.list || [];
    let emailsSent = 0;
    let emailsInbox = 0;
    let totalEmails = 0;

    for (const folder of folders) {
      const count = typeof folder.totalEmails === 'number' ? folder.totalEmails : 0;
      totalEmails += count;
      if (folder.role === 'sent') emailsSent = count;
      if (folder.role === 'inbox') emailsInbox = count;
    }

    return { emailsSent, emailsInbox, totalEmails };
  }

  /**
   * Batch-fetches email counts for multiple accounts using Promise.all
   * with a concurrency cap of `concurrency` (default 10).
   * Returns a map of stalwartAccountId → { emailsSent, emailsInbox, totalEmails }.
   * Failed lookups are silently set to zero — never throws.
   */
  async batchGetEmailCounts(
    stalwartAccountIds: string[],
    concurrency = 10
  ): Promise<Map<string, { emailsSent: number; emailsInbox: number; totalEmails: number }>> {
    const result = new Map<string, { emailsSent: number; emailsInbox: number; totalEmails: number }>();
    const zero = { emailsSent: 0, emailsInbox: 0, totalEmails: 0 };

    // Process in batches of `concurrency`
    for (let i = 0; i < stalwartAccountIds.length; i += concurrency) {
      const batch = stalwartAccountIds.slice(i, i + concurrency);
      const settled = await Promise.allSettled(
        batch.map((id) => this.getAccountEmailCounts(id))
      );
      for (let j = 0; j < batch.length; j++) {
        const s = settled[j];
        result.set(batch[j], s.status === 'fulfilled' ? s.value : zero);
      }
    }

    return result;
  }

  // --- IP Address Management (Blocked & Allowed IPs) ---

  /**
   * Dispatches an action to reload the in-memory blocked IPs firewall rules.
   */
  async reloadBlockedIps(): Promise<void> {
    const responses = await this.dispatch([
      [
        'x:Action/set',
        {
          accountId: this.accountId,
          create: {
            act_reload: {
              '@type': 'ReloadBlockedIps',
            },
          },
        },
        'c_reload_blocked_ips',
      ],
    ]);

    const result = responses[0]?.[1];
    if (result?.notCreated?.act_reload) {
      const err = result.notCreated.act_reload;
      throw new StalwartError(
        `Failed to reload blocked IPs in Stalwart: ${err.description || err.type}`,
        'RELOAD_BLOCKED_IPS_FAILED',
        err
      );
    }
  }

  /**
   * Lists all currently blocked IP addresses.
   */
  async listBlockedIps(): Promise<StalwartBlockedIp[]> {
    const responses = await this.dispatch([
      ['x:BlockedIp/get', { accountId: this.accountId, ids: null }, 'c_list_blocked_ips'],
    ]);

    const list = responses[0]?.[1]?.list || [];
    return list.map((b: any) => ({
      id: b.id,
      address: b.address,
      reason: b.reason,
      createdAt: b.createdAt,
      expiresAt: b.expiresAt,
    }));
  }

  /**
   * Automated unblock: Deletes the blocked IP entry from Stalwart AND triggers
   * the ReloadBlockedIps action in one combined dispatch call.
   */
  async unblockIp(id: string): Promise<void> {
    const responses = await this.dispatch([
      ['x:BlockedIp/set', { accountId: this.accountId, destroy: [id] }, 'c_del_blocked_ip'],
      [
        'x:Action/set',
        {
          accountId: this.accountId,
          create: {
            act_reload: {
              '@type': 'ReloadBlockedIps',
            },
          },
        },
        'c_reload_blocked_ips',
      ],
    ]);

    const delResult = responses[0]?.[1];
    if (delResult?.notDestroyed?.[id]) {
      const err = delResult.notDestroyed[id];
      throw new StalwartError(
        `Failed to delete blocked IP ${id} in Stalwart: ${err.description || err.type}`,
        'UNBLOCK_IP_FAILED',
        err
      );
    }
  }

  /**
   * Blocks an IP address and reloads the firewall cache.
   */
  async blockIp(address: string, reason = 'manual'): Promise<StalwartBlockedIp> {
    const tempId = 'new_block';
    const responses = await this.dispatch([
      [
        'x:BlockedIp/set',
        {
          accountId: this.accountId,
          create: {
            [tempId]: {
              address: address.trim(),
              reason,
            },
          },
        },
        'c_create_blocked_ip',
      ],
      [
        'x:Action/set',
        {
          accountId: this.accountId,
          create: {
            act_reload: {
              '@type': 'ReloadBlockedIps',
            },
          },
        },
        'c_reload_blocked_ips',
      ],
    ]);

    const setResult = responses[0]?.[1];
    if (setResult?.notCreated?.[tempId]) {
      const err = setResult.notCreated[tempId];
      throw new StalwartError(
        `Failed to block IP ${address} in Stalwart: ${err.description || err.type}`,
        'BLOCK_IP_FAILED',
        err
      );
    }

    const created = setResult?.created?.[tempId];
    return {
      id: created?.id || tempId,
      address: address.trim(),
      reason,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Lists all whitelisted/allowed IP addresses.
   */
  async listAllowedIps(): Promise<StalwartAllowedIp[]> {
    const responses = await this.dispatch([
      ['x:AllowedIp/get', { accountId: this.accountId, ids: null }, 'c_list_allowed_ips'],
    ]);

    const list = responses[0]?.[1]?.list || [];
    return list.map((a: any) => ({
      id: a.id,
      address: a.address,
      reason: a.reason,
      createdAt: a.createdAt,
      expiresAt: a.expiresAt,
    }));
  }

  /**
   * Adds an IP or CIDR to the allowed (whitelist) list and reloads firewall rules.
   */
  async addAllowedIp(address: string, reason?: string): Promise<StalwartAllowedIp> {
    const tempId = 'new_allow';
    const payload: any = { address: address.trim() };
    if (reason) payload.reason = reason.trim();

    const responses = await this.dispatch([
      [
        'x:AllowedIp/set',
        {
          accountId: this.accountId,
          create: {
            [tempId]: payload,
          },
        },
        'c_create_allowed_ip',
      ],
      [
        'x:Action/set',
        {
          accountId: this.accountId,
          create: {
            act_reload: {
              '@type': 'ReloadBlockedIps',
            },
          },
        },
        'c_reload_blocked_ips',
      ],
    ]);

    const setResult = responses[0]?.[1];
    if (setResult?.notCreated?.[tempId]) {
      const err = setResult.notCreated[tempId];
      throw new StalwartError(
        `Failed to whitelist IP ${address} in Stalwart: ${err.description || err.type}`,
        'ALLOW_IP_FAILED',
        err
      );
    }

    const created = setResult?.created?.[tempId];
    return {
      id: created?.id || tempId,
      address: address.trim(),
      reason: reason?.trim() || null,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Removes an IP from the allowed (whitelist) list and reloads firewall rules.
   */
  async removeAllowedIp(id: string): Promise<void> {
    const responses = await this.dispatch([
      ['x:AllowedIp/set', { accountId: this.accountId, destroy: [id] }, 'c_del_allowed_ip'],
      [
        'x:Action/set',
        {
          accountId: this.accountId,
          create: {
            act_reload: {
              '@type': 'ReloadBlockedIps',
            },
          },
        },
        'c_reload_blocked_ips',
      ],
    ]);

    const delResult = responses[0]?.[1];
    if (delResult?.notDestroyed?.[id]) {
      const err = delResult.notDestroyed[id];
      throw new StalwartError(
        `Failed to remove allowed IP ${id} in Stalwart: ${err.description || err.type}`,
        'REMOVE_ALLOWED_IP_FAILED',
        err
      );
    }
  }
}

// Export singleton instance
export const stalwartClient = new StalwartClient();

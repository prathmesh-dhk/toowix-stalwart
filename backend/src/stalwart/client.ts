import http from 'http';
import https from 'https';
import { config } from '../config';
import {
  StalwartDomain,
  StalwartAccount,
  CreateAccountInput,
  StalwartCreatedAccount,
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

  // --- Domain Methods ---

  /**
   * Creates a domain on Stalwart.
   */
  async createDomain(domainName: string, description?: string): Promise<{ id: string; name: string }> {
    const normalized = domainName.trim().toLowerCase();
    const tempId = 'dom_new';

    const responses = await this.dispatch([
      [
        'x:Domain/set',
        {
          accountId: this.accountId,
          create: {
            [tempId]: {
              name: normalized,
              description: description || null,
              isEnabled: true,
            },
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
    }));
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
}

// Export singleton instance
export const stalwartClient = new StalwartClient();

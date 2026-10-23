# Remote Stalwart Migration Guide: Domains & Mailboxes to Platform Database

**Target Audience:** Platform Engineers, Backend Developers, DevOps  
**System:** Toowix Stalwart Multi-Tenant Mail Platform  
**Scope:** Migrating domains, mailboxes, aliases, and metadata from an external (remote) Stalwart Mail Server instance into the Toowix platform database (MongoDB) and destination Stalwart cluster.

---

## 1. Executive Summary & Architecture

The Toowix platform currently features an internal import function (`platformTenantRouter.post('/:id/domains/import')`) which attaches domains and mailboxes that already reside on the *local* configured Stalwart instance to a tenant in MongoDB.

When migrating from a **different (external/remote) Stalwart server**, the requirements change fundamentally:
1. **Multi-Server Connectivity:** The backend must connect to an external Stalwart instance over JMAP/REST using remote administrative credentials (`url`, `apiKey` or `user`/`password`).
2. **Metadata Extraction:** It must discover remote domains, accounts, and alias dictionaries.
3. **Password Security Boundary:** Stalwart hashes passwords (Argon2/PBKDF2) and intentionally redacts secrets in API responses (`sysAccountPasswordGet` / `x:Account/get`). Cleartext passwords cannot be read from the remote server. The migration strategy must account for this by issuing secure temporary passwords, email activation tokens, or staging credentials.
4. **DKIM & Cryptographic Keys:** Remote private keys are redacted (`"****"`). New DKIM keypairs must be provisioned on the destination Stalwart cluster and new DNS TXT records generated.
5. **Two-Tier Ingestion:**
   - **Tier 1 (Database Ingestion):** Create `Domain` and `Mailbox` records in MongoDB scoped to the target `Tenant`, with conflict detection and audit logging.
   - **Tier 2 (Target Stalwart Provisioning):** Provision the domains, DKIM keys, and user accounts on the target Toowix Stalwart cluster.
   - **Tier 3 (Optional Mail History Sync):** Transfer RFC822 mail message content between accounts.

```
┌─────────────────────────────────┐                 ┌──────────────────────────────────┐
│     Remote Stalwart Server      │                 │     Toowix Platform Backend      │
│  (https://external-mail.com)    │                 │                                  │
│                                 │                 │  ┌────────────────────────────┐  │
│  - Domains (x:Domain/get)       │   Remote JMAP   │  │ RemoteStalwartClient       │  │
│  - Accounts (x:Account/get)     │◄────────────────┼──│ (Dynamic credentials)      │  │
│  - Aliases (account.aliases)    │                 │  └─────────────┬──────────────┘  │
│  - Quotas & Roles               │                 │                │                 │
└─────────────────────────────────┘                 │                ▼                 │
                                                    │  ┌────────────────────────────┐  │
                                                    │  │ RemoteMigrationService     │  │
                                                    │  │ - Conflict checking        │  │
                                                    │  │ - Tenant association       │  │
                                                    │  │ - Temp password / tokens   │  │
                                                    │  └──────┬──────────────┬──────┘  │
                                                    │         │              │         │
                                                    └─────────┼──────────────┼─────────┘
                                                              │              │
                                     ┌────────────────────────┘              └────────────────────────┐
                                     ▼                                                                ▼
                      ┌──────────────────────────────┐                                 ┌──────────────────────────────┐
                      │    Platform Database (DB)    │                                 │   Platform Stalwart Server   │
                      │          (MongoDB)           │                                 │      (Target Instance)       │
                      │                              │                                 │                              │
                      │  - DomainModel               │                                 │  - createDomain()            │
                      │  - MailboxModel              │                                 │  - ensureAutomaticDkim()     │
                      │  - TenantModel limits        │                                 │  - createAccount()           │
                      │  - AuditLogModel             │                                 │  - updateAccountAliases()    │
                      └──────────────────────────────┘                                 └──────────────────────────────┘
```

---

## 2. Remote Stalwart API Introspection & Protocols

Stalwart Mail Server uses JMAP with the `urn:stalwart:jmap` extension for administrative operations.

### 2.1 Remote Connection Authentication
Administrative authentication on Stalwart supports two modes:
- **API Key (Bearer Token):** `Authorization: Bearer <API_KEY>`
- **HTTP Basic Auth:** `Authorization: Basic base64(<USERNAME>:<PASSWORD>)`

Before attempting migration, verify the connection and permissions using Stalwart's lightweight REST introspection endpoint:
- **Endpoint:** `GET https://<remote-stalwart-host>/api/account`
- **Expected Permissions:**
  ```json
  {
    "permissions": [
      "sysDomainGet",
      "sysDomainQuery",
      "sysAccountGet",
      "sysAccountQuery"
    ],
    "edition": "community"
  }
  ```

### 2.2 Remote Domains Query (`x:Domain/get`)
To fetch all domains configured on the remote Stalwart:
```json
{
  "using": ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
  "methodCalls": [
    ["x:Domain/get", { "accountId": "b", "ids": null }, "get_all_domains"]
  ]
}
```
**Response Format:**
```json
[
  "x:Domain/get",
  {
    "accountId": "b",
    "list": [
      {
        "id": "dom_1",
        "name": "example.com",
        "isEnabled": true,
        "description": "Corporate domain",
        "dnsZoneFile": "...",
        "createdAt": "2025-01-10T12:00:00Z"
      }
    ]
  },
  "get_all_domains"
]
```

### 2.3 Remote Accounts & Mailboxes Query (`x:Account/get`)
To fetch all accounts and user mailboxes:
```json
{
  "using": ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
  "methodCalls": [
    ["x:Account/get", { "accountId": "b", "ids": null }, "get_all_accounts"]
  ]
}
```
**Response Format:**
```json
[
  "x:Account/get",
  {
    "accountId": "b",
    "list": [
      {
        "id": "acc_101",
        "name": "alice",
        "domainId": "dom_1",
        "emailAddress": "alice@example.com",
        "@type": "User",
        "description": "Alice Smith",
        "roles": { "@type": "User" },
        "aliases": {
          "0": {
            "name": "support",
            "domainId": "dom_1",
            "enabled": true
          }
        }
      }
    ]
  },
  "get_all_accounts"
]
```

*Note on Stalwart Aliases:* As verified in `docs/STALWART_API_NOTES.md §4E`, Stalwart represents aliases as a **dictionary/map** (`Record<string, EmailAlias>`), not a flat JSON array. The local part is stored in `name`, and the domain reference is in `domainId`.

---

## 3. Database Schema Alignment & Ingestion Rules

When importing into Toowix's MongoDB database, adhere to the following schema mappings and invariants:

### 3.1 Domain Ingestion (`DomainModel`)
| Field | Source / Strategy | Description |
|---|---|---|
| `tenantId` | User/Operator specified | Target tenant in Toowix owning the domain |
| `domainName` | `remoteDomain.name.toLowerCase().trim()` | Fully-qualified domain name (unique) |
| `stalwartDomainId` | Target Stalwart `id` (or `null` before provisioning) | Populated when provisioned on local cluster |
| `status` | `remoteDomain.isEnabled ? 'active' : 'suspended'` | Service status |
| `dnsStatus` | `'not_started'` | Reset to allow standard verification workflow |
| `isPrimary` | `true` if tenant has 0 prior domains, else `false` | Primary tenant identity |
| `mailboxLimit` | `Math.max(50, importedMailboxesCount)` | Automatically sized to prevent quota lockouts |
| `dnsZoneFile` | `remoteDomain.dnsZoneFile || null` | Captured for manual DNS setup reference |

### 3.2 Mailbox Ingestion (`MailboxModel`)
| Field | Source / Strategy | Description |
|---|---|---|
| `tenantId` | Target `tenant._id` | Tenant foreign key |
| `domainId` | Newly created `domainDoc._id` | Domain foreign key |
| `localPart` | `remoteAccount.name.toLowerCase().trim()` | e.g. `"alice"` |
| `address` | `"${localPart}@${domainName}"` | e.g. `"alice@example.com"` |
| `displayName` | `remoteAccount.description || remoteAccount.name` | Human display name |
| `status` | `'active'` | Default active |
| `billingHold` | `false` | Migrated mailboxes bypass pre-payment billing hold |
| `aliases` | Mapped from `remoteAccount.aliases` | Array of `IMailboxAlias` subdocuments |
| `security.mustChangePassword` | `true` | Requires password reset upon first platform login |
| `security.temporaryPasswordHash`| Bcrypt hash of generated temporary password | Safe fallback access |

---

## 4. Handling Passwords, Credentials, and DKIM

### 4.1 The Password Transfer Challenge
Because mail servers store one-way salted hashes (Argon2id or PBKDF2), the remote Stalwart API **cannot and will not export cleartext passwords**.

**Three Supported Migration Strategies:**
1. **Automated Temporary Password Generation (Recommended Default):**
   - The migration service generates a cryptographically secure random password (e.g. 16 chars: alphanumeric + symbols) for each account.
   - The account is provisioned on the target Stalwart instance with this temporary password.
   - The user's `security.mustChangePassword` flag is set to `true` in MongoDB.
   - An activation/welcome email containing a password-reset link or one-time token is dispatched or recorded in the migration audit log for the administrator.
2. **Batch Password CSV / Mapping Ingestion:**
   - The administrator provides a JSON/CSV mapping file `{ "alice@example.com": "CustomerProvidedPassword123!" }`.
   - The migration service uses these explicit passwords when creating accounts on the target Stalwart instance.
3. **Stalwart Migration Proxy (Zero-Downtime Dynamic Proxy):**
   - If migrating between live environments without resetting passwords, Stalwart's Migration Proxy (`vandelay`) can be placed in front. Upon a user's first IMAP/JMAP login to the new cluster, Stalwart proxies the login to the old Stalwart instance, captures the cleartext password during authentication, provisions the hash locally, and begins asynchronous mail copy.

### 4.2 DKIM Key Transition
- Remote Stalwart DKIM private keys are redacted (`"****"`).
- When the domain is created on the target Stalwart cluster via `stalwartClient.createDomain()`, the target Stalwart cluster generates fresh, local Ed25519 and RSA DKIM keypairs.
- The platform extracts these public keys (`stalwartClient.getActiveDkimKeys()`) and stores the selector and public key in `DomainModel`.
- The administrator updates the domain's DNS TXT records (`v1-rsa-...` and `v1-ed25519-...`) to authorize the new Stalwart cluster.

---

## 5. Mail Content Migration Strategies (Message Transfer)

Once the domain and mailbox structures exist in the database and target Stalwart, mail messages (folders, read flags, attachments) can be migrated using one of the following methods:

### Method A: JMAP Email Sync (Direct API Sync)
The Toowix backend can iterate through remote mailboxes using administrative impersonation:
1. `Mailbox/get` on remote account to enumerate folders (Inbox, Sent, Drafts, Archive).
2. `Mailbox/set` on destination account to mirror the folder tree.
3. `Email/query` + `Email/get` with `fetchTextBody: true`, downloading RFC822 blobs.
4. Upload blobs to destination Stalwart via JMAP `upload` endpoint.
5. Create messages via `Email/set` on the destination account with identical flags (`$seen`, `$flagged`).

### Method B: Native Stalwart Migration Utility
Stalwart provides built-in tools for bulk synchronization:
- `stalwart-cli import`: Command-line migration tool connecting to remote IMAP/JMAP endpoints.
- Database Import/Export: If both instances have filesystem access and downtime is acceptable, Stalwart's offline database serialization utility can serialize RocksDB/SQLite data.

---

## 6. Complete Implementation Architecture

Below is the complete, modular TypeScript implementation designed to fit seamlessly into the Toowix codebase.

### 6.1 Enhancing `StalwartClient` for Dynamic Remote Instances
Currently, `StalwartClient` (`backend/src/stalwart/client.ts`) uses global environment configuration. By allowing an optional configuration override in the constructor, `StalwartClient` can connect to any remote Stalwart server on demand.

```typescript
export interface StalwartClientConfig {
  url: string;
  apiKey?: string;
  user?: string;
  password?: string;
  accountId?: string;
}

export class StalwartClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly accountId: string;

  constructor(customConfig?: StalwartClientConfig) {
    if (customConfig) {
      this.baseUrl = customConfig.url.replace(/\/+$/, '');
      if (customConfig.apiKey && customConfig.apiKey.trim() !== '') {
        this.authHeader = `Bearer ${customConfig.apiKey.trim()}`;
      } else {
        const userPass = `${customConfig.user || ''}:${customConfig.password || ''}`;
        this.authHeader = `Basic ${Buffer.from(userPass).toString('base64')}`;
      }
      this.accountId = customConfig.accountId || 'b';
    } else {
      // Default fallback to platform environment variables
      this.baseUrl = config.stalwart.url.replace(/\/+$/, '');
      if (config.stalwart.apiKey && config.stalwart.apiKey.trim() !== '') {
        this.authHeader = `Bearer ${config.stalwart.apiKey.trim()}`;
      } else {
        const userPass = `${config.stalwart.user}:${config.stalwart.password}`;
        this.authHeader = `Basic ${Buffer.from(userPass).toString('base64')}`;
      }
      this.accountId = config.stalwart.accountId || 'b';
    }
  }
  // ... existing dispatch and method calls remain identical
}
```

### 6.2 The Remote Stalwart Migration Service
Create `backend/src/services/remote-stalwart-migration.service.ts`:

```typescript
import crypto from 'crypto';
import mongoose from 'mongoose';
import { StalwartClient, StalwartClientConfig } from '../stalwart/client';
import { stalwartClient as targetStalwartClient } from '../stalwart/client';
import { DomainModel, IDomain } from '../db/models/Domain';
import { MailboxModel, IMailboxAlias } from '../db/models/Mailbox';
import { TenantModel } from '../db/models/Tenant';
import { AuditLogModel } from '../db/models/AuditLog';
import { logAudit } from '../audit/service';

export interface RemoteStalwartInspectResult {
  edition: string;
  domains: Array<{
    id: string;
    name: string;
    isEnabled: boolean;
    description: string | null;
    mailboxCount: number;
    alreadyClaimedInPlatform: boolean;
  }>;
  totalAccounts: number;
}

export interface RemoteMigrationOptions {
  remoteConfig: StalwartClientConfig;
  tenantId: string;
  domainNamesToMigrate?: string[]; // If undefined, migrate all domains
  provisionOnTargetStalwart?: boolean; // Default: true
  passwordStrategy?: 'generate_temporary' | 'manual_mapping';
  passwordMapping?: Record<string, string>; // email -> cleartext password
  actorId?: string;
  actorRole?: string;
  actorEmail?: string;
  actorIp?: string;
}

export interface MigrationSummary {
  domainsMigrated: Array<{
    domainName: string;
    domainId: string;
    mailboxesMigrated: number;
    provisionedOnTargetStalwart: boolean;
  }>;
  skippedDomains: Array<{
    domainName: string;
    reason: string;
  }>;
  generatedCredentials: Array<{
    email: string;
    temporaryPassword?: string;
  }>;
  errors: Array<{
    target: string;
    error: string;
  }>;
}

export class RemoteStalwartMigrationService {
  /**
   * Tests connectivity to the remote Stalwart server.
   */
  static async testConnection(remoteConfig: StalwartClientConfig): Promise<{ success: boolean; message: string }> {
    try {
      const remote = new StalwartClient(remoteConfig);
      const domains = await remote.listDomains();
      return {
        success: true,
        message: `Successfully connected to remote Stalwart. Found ${domains.length} domain(s).`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Failed to connect to remote Stalwart: ${err.message || 'Unknown network error'}`,
      };
    }
  }

  /**
   * Inspects a remote Stalwart instance without writing anything to DB.
   * Returns domain inventory, account counts, and highlights conflicts.
   */
  static async inspectRemoteServer(remoteConfig: StalwartClientConfig): Promise<RemoteStalwartInspectResult> {
    const remote = new StalwartClient(remoteConfig);
    const [domains, accounts] = await Promise.all([
      remote.listDomains(),
      remote.listAccounts(),
    ]);

    // Check existing domains in platform database
    const domainNames = domains.map((d) => d.name.toLowerCase().trim());
    const existingPlatformDomains = await DomainModel.find({
      domainName: { $in: domainNames },
    }).select('domainName').lean();
    const claimedSet = new Set(existingPlatformDomains.map((d) => d.domainName.toLowerCase()));

    const domainList = domains.map((d) => {
      const normalized = d.name.toLowerCase().trim();
      const accountCount = accounts.filter(
        (a) => a.domainId === d.id || (a.emailAddress && a.emailAddress.toLowerCase().endsWith(`@${normalized}`))
      ).length;

      return {
        id: d.id,
        name: d.name,
        isEnabled: d.isEnabled,
        description: d.description || null,
        mailboxCount: accountCount,
        alreadyClaimedInPlatform: claimedSet.has(normalized),
      };
    });

    return {
      edition: 'community',
      domains: domainList,
      totalAccounts: accounts.length,
    };
  }

  /**
   * Executes the full migration of domains and mailboxes from the remote Stalwart instance.
   */
  static async executeMigration(options: RemoteMigrationOptions): Promise<MigrationSummary> {
    const {
      remoteConfig,
      tenantId,
      domainNamesToMigrate,
      provisionOnTargetStalwart = true,
      passwordStrategy = 'generate_temporary',
      passwordMapping = {},
      actorId,
      actorRole = 'SUPER_ADMIN',
      actorEmail,
      actorIp = '127.0.0.1',
    } = options;

    const tenant = await TenantModel.findById(tenantId);
    if (!tenant) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }

    const remote = new StalwartClient(remoteConfig);
    const [allRemoteDomains, allRemoteAccounts] = await Promise.all([
      remote.listDomains(),
      remote.listAccounts(),
    ]);

    const summary: MigrationSummary = {
      domainsMigrated: [],
      skippedDomains: [],
      generatedCredentials: [],
      errors: [],
    };

    let totalMailboxesImportedAcrossTenant = 0;

    // Filter target domains
    const targetDomains = domainNamesToMigrate && domainNamesToMigrate.length > 0
      ? allRemoteDomains.filter((d) => domainNamesToMigrate.map((n) => n.toLowerCase()).includes(d.name.toLowerCase()))
      : allRemoteDomains;

    for (const remoteDomain of targetDomains) {
      const normalizedDomainName = remoteDomain.name.toLowerCase().trim();

      try {
        // 1. Conflict Check: Verify domain not claimed in platform database
        const existingDomain = await DomainModel.findOne({
          domainName: { $regex: new RegExp(`^${normalizedDomainName}$`, 'i') },
        });

        if (existingDomain) {
          summary.skippedDomains.push({
            domainName: remoteDomain.name,
            reason: `Domain is already registered to tenant ${existingDomain.tenantId}`,
          });
          continue;
        }

        // 2. Provision Domain on Platform's Destination Stalwart (if enabled)
        let targetStalwartDomainId: string | null = null;
        let dkimSelector: string | null = null;
        let dkimPublicKey: string | null = null;

        if (provisionOnTargetStalwart) {
          try {
            // Check if domain already exists on destination Stalwart cluster
            const localDomains = await targetStalwartClient.listDomains();
            const existingLocal = localDomains.find(
              (ld) => ld.name.toLowerCase() === normalizedDomainName
            );

            if (existingLocal) {
              targetStalwartDomainId = existingLocal.id;
            } else {
              const createdDom = await targetStalwartClient.createDomain(
                normalizedDomainName,
                `Migrated for Tenant ${tenant.name}`
              );
              targetStalwartDomainId = createdDom.id;
            }

            // Ensure automatic DKIM generation & fetch keys
            await targetStalwartClient.ensureAutomaticDkim(targetStalwartDomainId);
            const dkimKeys = await targetStalwartClient.getActiveDkimKeys(targetStalwartDomainId);
            if (dkimKeys && dkimKeys.length > 0) {
              dkimSelector = dkimKeys[0].selector || null;
              dkimPublicKey = dkimKeys[0].publicKey || null;
            }
          } catch (stalwartErr: any) {
            console.error(`[RemoteMigration] Failed to provision domain ${normalizedDomainName} on target Stalwart:`, stalwartErr);
            summary.errors.push({
              target: remoteDomain.name,
              error: `Destination Stalwart domain provisioning failed: ${stalwartErr.message}`,
            });
            // We still continue to ingest metadata if allowed
          }
        }

        // 3. Create Domain Document in MongoDB
        const existingTenantDomainCount = await DomainModel.countDocuments({ tenantId: tenant._id });
        const isPrimary = existingTenantDomainCount === 0;

        const domainDoc: IDomain = await DomainModel.create({
          tenantId: tenant._id,
          domainName: normalizedDomainName,
          stalwartDomainId: targetStalwartDomainId,
          status: remoteDomain.isEnabled ? 'active' : 'suspended',
          dnsStatus: 'not_started',
          isPrimary,
          dnsZoneFile: remoteDomain.dnsZoneFile || null,
          dkimSelector,
          dkimPublicKey,
          mailboxLimit: 50,
          employeeCount: 0,
        });

        // 4. Find all mailboxes belonging to this remote domain
        const remoteDomainAccounts = allRemoteAccounts.filter(
          (acc) =>
            acc.domainId === remoteDomain.id ||
            (acc.emailAddress && acc.emailAddress.toLowerCase().endsWith(`@${normalizedDomainName}`))
        );

        let domainMailboxesImported = 0;

        for (const remoteAcc of remoteDomainAccounts) {
          const localPart = (remoteAcc.name || '').toLowerCase().trim();
          const fullAddress = (
            remoteAcc.emailAddress || `${localPart}@${normalizedDomainName}`
          ).toLowerCase().trim();

          if (!localPart || !fullAddress) continue;

          // Check if mailbox address already claimed in platform
          const existingMailbox = await MailboxModel.findOne({
            $or: [
              { address: { $regex: new RegExp(`^${fullAddress}$`, 'i') } },
              { tenantId: tenant._id, domainId: domainDoc._id, localPart },
            ],
          });

          if (existingMailbox) {
            summary.errors.push({
              target: fullAddress,
              error: 'Mailbox address already claimed in platform database.',
            });
            continue;
          }

          // 5. Determine Password Strategy
          let targetPassword = passwordMapping[fullAddress];
          let generatedTempPassword = false;

          if (!targetPassword) {
            if (passwordStrategy === 'generate_temporary') {
              // Generate secure 16-character random password
              targetPassword = `Tmp!${crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, 'a')}`;
              generatedTempPassword = true;
            } else {
              targetPassword = `Welcome!${crypto.randomBytes(4).toString('hex')}`;
              generatedTempPassword = true;
            }
          }

          // 6. Provision Account on Target Stalwart Cluster
          let targetStalwartAccountId: string | undefined;

          if (provisionOnTargetStalwart && targetStalwartDomainId) {
            try {
              const createdAcc = await targetStalwartClient.createAccount({
                name: localPart,
                domainId: targetStalwartDomainId,
                password: targetPassword,
                description: remoteAcc.description || undefined,
              });
              targetStalwartAccountId = createdAcc.id;

              // Re-attach aliases if remote account had any
              if (remoteAcc && (remoteAcc as any).aliases) {
                const remoteAliasesMap = (remoteAcc as any).aliases;
                const aliasesToSet: Array<{ name: string; domainId: string; description?: string | null; enabled: boolean }> = [];

                for (const key of Object.keys(remoteAliasesMap)) {
                  const item = remoteAliasesMap[key];
                  if (item && item.name) {
                    aliasesToSet.push({
                      name: item.name.toLowerCase().trim(),
                      domainId: targetStalwartDomainId,
                      description: item.description || null,
                      enabled: item.enabled !== false,
                    });
                  }
                }

                if (aliasesToSet.length > 0) {
                  await targetStalwartClient.updateAccountAliases(targetStalwartAccountId, aliasesToSet);
                }
              }
            } catch (accStalwartErr: any) {
              console.error(`[RemoteMigration] Failed to create account ${fullAddress} on destination Stalwart:`, accStalwartErr);
              summary.errors.push({
                target: fullAddress,
                error: `Destination Stalwart account creation failed: ${accStalwartErr.message}`,
              });
            }
          }

          // Map aliases for MongoDB document
          const mongoAliases: IMailboxAlias[] = [];
          if (remoteAcc && (remoteAcc as any).aliases) {
            const remoteAliasesMap = (remoteAcc as any).aliases;
            for (const key of Object.keys(remoteAliasesMap)) {
              const item = remoteAliasesMap[key];
              if (item && item.name) {
                mongoAliases.push({
                  _id: new mongoose.Types.ObjectId(),
                  localPart: item.name.toLowerCase().trim(),
                  domainId: domainDoc._id,
                  domainName: normalizedDomainName,
                  address: `${item.name.toLowerCase().trim()}@${normalizedDomainName}`,
                  description: item.description || null,
                  createdAt: new Date(),
                });
              }
            }
          }

          // 7. Create Mailbox Document in MongoDB
          await MailboxModel.create({
            tenantId: tenant._id,
            domainId: domainDoc._id,
            domainName: normalizedDomainName,
            localPart,
            address: fullAddress,
            displayName: remoteAcc.description || remoteAcc.name || null,
            stalwartAccountId: targetStalwartAccountId,
            status: 'active',
            billingHold: false,
            aliases: mongoAliases,
            security: {
              twoFactorEnabled: false,
              mustChangePassword: generatedTempPassword,
              tempPasswordExpiresAt: generatedTempPassword
                ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
                : undefined,
            },
          });

          if (generatedTempPassword) {
            summary.generatedCredentials.push({
              email: fullAddress,
              temporaryPassword: targetPassword,
            });
          }

          domainMailboxesImported++;
        }

        // Adjust domain mailboxLimit if imported mailboxes exceed default
        if (domainMailboxesImported > domainDoc.mailboxLimit) {
          await DomainModel.updateOne(
            { _id: domainDoc._id },
            { $set: { mailboxLimit: domainMailboxesImported } }
          );
        }

        totalMailboxesImportedAcrossTenant += domainMailboxesImported;

        summary.domainsMigrated.push({
          domainName: normalizedDomainName,
          domainId: domainDoc._id.toString(),
          mailboxesMigrated: domainMailboxesImported,
          provisionedOnTargetStalwart: Boolean(targetStalwartDomainId),
        });

        // Audit Logging
        if (actorId) {
          await AuditLogModel.create({
            actorId,
            actorRole,
            actorEmail: actorEmail || 'operator@toowix.com',
            actorIp,
            tenantId: tenant._id,
            action: 'DOMAIN_MIGRATED_FROM_REMOTE_STALWART',
            resource: 'DOMAIN',
            resourceId: domainDoc._id.toString(),
            status: 'SUCCESS',
            metadata: {
              domainName: normalizedDomainName,
              remoteUrl: remoteConfig.url,
              mailboxesMigrated: domainMailboxesImported,
              isPrimary,
            },
            timestamp: new Date(),
          });
        }
      } catch (domainErr: any) {
        console.error(`[RemoteMigration] Failed processing domain ${remoteDomain.name}:`, domainErr);
        summary.errors.push({
          target: remoteDomain.name,
          error: domainErr.message || 'Unknown processing error',
        });
      }
    }

    // 8. Reconcile Tenant mailboxCount and limits
    if (totalMailboxesImportedAcrossTenant > 0) {
      const currentCount = await MailboxModel.countDocuments({ tenantId: tenant._id, status: 'active' });
      await TenantModel.updateOne(
        { _id: tenant._id },
        {
          $set: {
            mailboxCount: currentCount,
            mailboxLimit: Math.max(tenant.mailboxLimit, currentCount + 10),
          },
        }
      );
    }

    return summary;
  }
}
```

---

## 7. Platform Admin REST API Endpoints

Add these administrative endpoints to `backend/src/api/platform-tenant.routes.ts`:

### 7.1 Endpoint 1: Test Remote Connection
- **`POST /api/platform/tenants/migration/remote-stalwart/test`**
- **Auth:** Super Admin only (`requireSuperAdmin`)
- **Body:**
  ```json
  {
    "url": "https://external-mail.example.com",
    "apiKey": "optional-remote-bearer-token",
    "user": "admin",
    "password": "remoteAdminPassword123!"
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "message": "Successfully connected to remote Stalwart. Found 3 domain(s)."
  }
  ```

### 7.2 Endpoint 2: Inspect Remote Stalwart Inventory
- **`POST /api/platform/tenants/migration/remote-stalwart/inspect`**
- **Auth:** Super Admin only (`requireSuperAdmin`)
- **Body:** Connection credentials (same as above).
- **Response:**
  ```json
  {
    "edition": "community",
    "totalAccounts": 42,
    "domains": [
      {
        "id": "dom_1",
        "name": "acmecorp.com",
        "isEnabled": true,
        "description": "Acme Primary",
        "mailboxCount": 25,
        "alreadyClaimedInPlatform": false
      }
    ]
  }
  ```

### 7.3 Endpoint 3: Execute Migration into Tenant
- **`POST /api/platform/tenants/:id/migration/remote-stalwart/execute`**
- **Auth:** Super Admin only (`requireSuperAdmin`)
- **Body:**
  ```json
  {
    "remoteConfig": {
      "url": "https://external-mail.example.com",
      "user": "admin",
      "password": "remoteAdminPassword123!"
    },
    "domainNamesToMigrate": ["acmecorp.com"],
    "provisionOnTargetStalwart": true,
    "passwordStrategy": "generate_temporary",
    "passwordMapping": {
      "ceo@acmecorp.com": "ExplicitSecurePassword99!"
    }
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "domainsMigrated": [
      {
        "domainName": "acmecorp.com",
        "domainId": "66da8123bc894726ef34a101",
        "mailboxesMigrated": 25,
        "provisionedOnTargetStalwart": true
      }
    ],
    "skippedDomains": [],
    "generatedCredentials": [
      {
        "email": "staff1@acmecorp.com",
        "temporaryPassword": "Tmp!x8y7Z2a98..."
      }
    ],
    "errors": []
  }
  ```

---

## 8. Verification & Operational Testing Matrix

| Scenario | Expected Result | Verification Check |
|---|---|---|
| **Remote Server Unreachable / Bad Credentials** | Fast failure (HTTP 400 / 502) with clear error message; no DB changes | Call `testConnection()` with invalid port or password |
| **Domain Already Claimed in Platform** | Domain skipped gracefully; recorded in `summary.skippedDomains` | Attempt to migrate `toowix.test` which already exists |
| **Duplicate Mailbox in Tenant** | Individual mailbox skipped without breaking batch | Pre-seed mailbox `info@domain.com` in MongoDB |
| **Stalwart Account Provisioning** | Created in destination Stalwart via `x:Account/set`; `stalwartAccountId` saved in MongoDB | Query target Stalwart `x:Account/get` and compare IDs |
| **DKIM Key Generation** | Target Stalwart generates new Ed25519/RSA keys; selectors saved to `domainDoc` | Inspect `DomainModel.findOne({ domainName })` for `dkimSelector` |
| **Alias Association** | Aliases preserved and bound on destination Stalwart as map dictionary | Query destination Stalwart `x:Account/get` and inspect `aliases` |
| **Tenant Limits Auto-Adjustment** | Tenant `mailboxCount` and `mailboxLimit` updated to fit imported batch | Inspect `TenantModel.findById(tenantId)` |

---

## 9. Rollback & Disaster Recovery Runbook

If a remote migration encounters a catastrophic mid-flight failure:
1. **Database Rollback:**
   ```javascript
   // Run in MongoDB shell / script:
   const domainId = ObjectId("...");
   await MailboxModel.deleteMany({ domainId });
   await DomainModel.deleteOne({ _id: domainId });
   ```
2. **Target Stalwart Rollback:**
   - Delete created accounts: `stalwartClient.deleteAccount(accountId)`.
   - Delete domain: `stalwartClient.deleteDomain(domainId)` (which deletes linked DKIM keys automatically).
3. **Remote Stalwart Safety:**
   - The remote Stalwart instance is **never modified** during this migration. Only read queries (`x:Domain/get`, `x:Account/get`, `GET /api/account`) are dispatched against the remote instance.

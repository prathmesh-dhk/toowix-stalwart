# Stalwart Mail Server — Management API Notes (Live Verified)

**Date of Verification:** September 4, 2026  
**Stalwart Version:** `0.16.20`  
**Stalwart Edition:** `community`  
**Host Target:** `https://mail.toowix.test` (Port 443)  
**Primary Management Protocol:** JMAP (`POST /jmap/`) with custom extension capability `urn:stalwart:jmap`  
**Introspection Endpoint:** `GET /api/account` (REST)

---

## 1. Authentication & Service Credentials

### Introspection Endpoint
- **Endpoint:** `GET /api/account`
- **Authentication:** HTTP Basic Auth (`Authorization: Basic base64(username:password)`) or Bearer token.
- **Observed Behavior:** Returns the authenticated user's permission set, server edition (`community`), and locale.
- **Example Response:**
```json
{
  "permissions": [
    "jmapPrincipalCreate",
    "jmapPrincipalDestroy",
    "jmapPrincipalUpdate",
    "sysDomainQuery",
    "sysDomainDestroy",
    "sysDomainUpdate",
    "sysDomainCreate",
    "sysDomainGet",
    "sysAccountSettingsUpdate",
    "sysAccountPasswordUpdate",
    "sysAccountPasswordGet",
    "sysAccountQuery",
    "sysAccountDestroy",
    "sysAccountUpdate",
    "sysAccountCreate",
    "sysAccountGet"
  ],
  "edition": "community",
  "locale": "en-US"
}
```

### Dedicated Toowix Backend Service Credential
- A dedicated administrative user was provisioned on Stalwart:
  - **Account Name:** `toowix-service`
  - **Full Email:** `toowix-service@toowix.test`
  - **Role:** `{"@type": "Admin"}`
  - **Domain ID:** `b` (`toowix.test`)
- Stored securely in backend environment variables (`STALWART_URL`, `STALWART_USER`, `STALWART_PASSWORD`).

---

## 2. JMAP Management Protocol Fundamentals

All management and directory operations on Stalwart Community Edition execute against the JMAP endpoint:
- **URL:** `POST https://mail.toowix.test/jmap/`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Basic <base64>`
- **Top-level Envelope:**
```json
{
  "using": [
    "urn:ietf:params:jmap:core",
    "urn:stalwart:jmap"
  ],
  "methodCalls": [
    ["<MethodName>", { "accountId": "b", ...arguments }, "<callId>"]
  ]
}
```
*Note: In Stalwart Community Edition, the primary administrative account ID is `"b"` (or retrieved dynamically via `GET /jmap/session`).*

---

## 3. Domain Management (`x:Domain/*`)

### A. List Domains (`x:Domain/get`)
- **Method:** `x:Domain/get`
- **Request Arguments:**
```json
{
  "accountId": "b",
  "ids": null
}
```
- **Response Format:**
```json
[
  "x:Domain/get",
  {
    "accountId": "b",
    "list": [
      {
        "id": "b",
        "name": "toowix.test",
        "aliases": {},
        "isEnabled": true,
        "createdAt": "2026-09-04T10:27:18Z",
        "description": null,
        "dnsZoneFile": "..."
      }
    ],
    "notFound": []
  },
  "callId"
]
```

### B. Create Domain (`x:Domain/set`)
- **Method:** `x:Domain/set`
- **Request Arguments:**
```json
{
  "accountId": "b",
  "create": {
    "tempId1": {
      "name": "acme.com",
      "description": "Acme Corp Primary Domain",
      "isEnabled": true
    }
  }
}
```
- **Success Response:**
```json
[
  "x:Domain/set",
  {
    "accountId": "b",
    "created": {
      "tempId1": {
        "id": "c"
      }
    }
  },
  "callId"
]
```
- **Important Side Effect:** Creating a domain automatically generates default linked `DkimSignature` objects associated with `domainId: "c"`.

### C. Destroy Domain (`x:Domain/set`)
- **Method:** `x:Domain/set`
- **Prerequisite:** All linked objects (specifically `DkimSignature` and accounts under this domain) must be deleted first, or Stalwart returns `objectIsLinked`.
- **Request Arguments (Atomic Batch):**
```json
{
  "using": ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
  "methodCalls": [
    ["x:DkimSignature/set", { "accountId": "b", "destroy": ["<linkedDkimId>"] }, "c_dkim"],
    ["x:Domain/set", { "accountId": "b", "destroy": ["<domainId>"] }, "c_dom"]
  ]
}
```
- **Success Response:**
```json
[
  "x:Domain/set",
  {
    "accountId": "b",
    "destroyed": ["c"]
  },
  "callId"
]
```

---

## 4. Account / Mailbox Management (`x:Account/*`)

### A. List Accounts (`x:Account/get`)
- **Method:** `x:Account/get`
- **Request Arguments:**
```json
{
  "accountId": "b",
  "ids": null
}
```
- **Response Format:**
```json
[
  "x:Account/get",
  {
    "accountId": "b",
    "list": [
      {
        "id": "b",
        "name": "admin",
        "domainId": "b",
        "emailAddress": "admin@toowix.test",
        "@type": "User",
        "roles": { "@type": "Admin" },
        "description": "System administrator",
        "createdAt": "2026-09-04T10:27:19Z"
      }
    ],
    "notFound": []
  },
  "callId"
]
```

### B. Create Mailbox (`x:Account/set`)
- **Method:** `x:Account/set`
- **Request Arguments:**
```json
{
  "accountId": "b",
  "create": {
    "tempId": {
      "@type": "User",
      "name": "john",
      "domainId": "<domainId>",
      "description": "John Doe",
      "roles": { "@type": "User" },
      "credentials": {
        "0": {
          "@type": "Password",
          "secret": "SecurePassword123!"
        }
      }
    }
  }
}
```
- **Critical Requirements:**
  - `@type: "User"` is mandatory in the root of the created object.
  - `domainId` must match the Stalwart Domain ID.
  - `credentials.0.secret` must be at least 8 characters long.
- **Success Response:**
```json
[
  "x:Account/set",
  {
    "accountId": "b",
    "created": {
      "tempId": {
        "id": "e"
      }
    }
  },
  "callId"
]
```

### C. Update Mailbox Password (`x:Account/set`)
- **Method:** `x:Account/set`
- **Request Arguments:**
```json
{
  "accountId": "b",
  "update": {
    "<accountId>": {
      "credentials": {
        "0": {
          "@type": "Password",
          "secret": "NewSecurePassword456!"
        }
      }
    }
  }
}
```
- **Success Response:**
```json
[
  "x:Account/set",
  {
    "accountId": "b",
    "updated": {
      "<accountId>": null
    }
  },
  "callId"
]
```

### D. Delete Mailbox (`x:Account/set`)
- **Method:** `x:Account/set`
- **Request Arguments:**
```json
{
  "accountId": "b",
  "destroy": ["<accountId>"]
}
```
- **Success Response:**
```json
[
  "x:Account/set",
  {
    "accountId": "b",
    "destroyed": ["<accountId>"]
  },
  "callId"
]
### E. Update Account Email Aliases (`x:Account/set`)
- **Method:** `x:Account/set`
- **Request Arguments:**
```json
{
  "accountId": "b",
  "update": {
    "<accountId>": {
      "aliases": {
        "0": {
          "name": "sales",
          "domainId": "<stalwartDomainId>",
          "description": null,
          "enabled": true
        }
      }
    }
  }
}
```
- **Critical Requirements:**
  - `aliases` is an **object map** (dictionary `Record<string, EmailAlias>`), **NOT a JSON array**. Passing `aliases: [ ... ]` fails with `"Invalid value for object property"`.
  - `domainId` must be the internal Stalwart Domain ID (e.g. `"g2"`, `"b"`), **NOT** the domain name string (e.g. `"bottle.com"`). Passing a domain name string fails with `"Failed to parse Id from string"`.
  - To clear all aliases from an account, pass an empty object: `"aliases": {}`.
- **Success Response:**
```json
[
  "x:Account/set",
  {
    "accountId": "b",
    "updated": {
      "<accountId>": null
    }
  },
  "callId"
]
```

---

## 5. Verified Error Responses

| Condition | Method | Stalwart Error Type | Details / Observed Properties |
|---|---|---|---|
| Duplicate Domain Name | `x:Domain/set` create | `primaryKeyViolation` | `properties: ["name"]`, `objectId: {"object": "Domain", "id": "b"}` |
| Duplicate Mailbox Email | `x:Account/set` create | `primaryKeyViolation` | `properties: ["email"]`, `objectId: {"object": "Account", "id": "b"}` |
| Password < 8 characters | `x:Account/set` create | `invalidProperties` | `description: "Password must be at least 8 characters long."`, `properties: ["secret"]` |
| Missing `@type: "User"` | `x:Account/set` create | `invalidPatch` | `description: "Missing or invalid '@type' property in object"` |
| Deleting Domain with Linked Keys | `x:Domain/set` destroy | `objectIsLinked` | `linkedObjects: [{"object": "DkimSignature", "id": "..."}]` |
| Aliases passed as JSON array | `x:Account/set` update | `invalidPatch` | `description: "Invalid value for object property"`, `properties: ["aliases"]` |
| Alias domainId passed as string domain name | `x:Account/set` update | `invalidPatch` | `description: "Failed to parse Id from string"`, `properties: ["aliases/domainId"]` |
| Invalid Authentication | Any | `401 Unauthorized` | `{"type": "about:blank", "status": 401, "title": "Unauthorized"}` |

---

## 6. Architecture Implications for Toowix Client

1. **Domain Lookup Cache / Mapping:** Toowix stores the Stalwart `domainId` (e.g. `"b"`) alongside the domain record in PostgreSQL, so mailbox provisioning does not need a roundtrip domain query every time.
2. **Linked DKIM Deletion:** When a tenant domain is removed or migrated by Platform Admin, the backend queries `x:DkimSignature/query` / `x:DkimSignature/get` for the matching `domainId`, and safely deletes DKIM signatures before destroying the domain principal.
3. **Password Confidentiality:** Mailbox passwords are sent directly from the Toowix Backend to Stalwart's `x:Account/set` and are **never** stored in PostgreSQL.
4. **Idempotency:** Stalwart's `primaryKeyViolation` error allows Toowix to distinguish between a new conflicting mailbox and an idempotent retry.

---

## 7. DKIM Signature Object & DNS Zone File (Live Verified — Domain Activation Spike)

**Date of Verification:** September 12, 2026, against the dev container (`toowix-mail-stalwart`, JMAP reachable in-container at `http://127.0.0.1:8080/jmap/`; the host-mapped port `8085` was unreachable from this environment's shell sandbox during verification — `docker exec ... curl` was used instead. The Toowix backend itself always reaches Stalwart over the internal Docker network, so this is a test-tooling quirk only, not a production concern.)

### A. Domains create their own DKIM keys automatically
Every domain returned by `x:Domain/get` carries a `dkimManagement` object:
```json
"dkimManagement": {
  "@type": "Automatic",
  "algorithms": { "Dkim1Ed25519Sha256": true, "Dkim1RsaSha256": true },
  "selectorTemplate": "v{version}-{algorithm}-{date-%Y%m%d}",
  "rotateAfter": 7776000000,
  "retireAfter": 604800000,
  "deleteAfter": 2592000000
}
```
No explicit "generate DKIM key" call is needed — creating a domain via `x:Domain/set` auto-generates **two** active DKIM signatures (one Ed25519, one RSA) with selectors following the template above (e.g. `v1-rsa-20260907`, `v1-ed25519-20260907`).

### B. `x:DkimSignature/get` — real response shape
```json
{
  "accountId": "b",
  "list": [
    {
      "id": "jdpxkb7abxqa",
      "domainId": "d",
      "selector": "v1-rsa-20260907",
      "@type": "Dkim1RsaSha256",
      "publicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...(base64 DER SubjectPublicKeyInfo)...IDAQAB",
      "stage": "active",
      "privateKey": { "secret": "****", "@type": "Text" },
      "canonicalization": "relaxed/relaxed",
      "headers": { "From": true, "To": true, "Date": true, "Subject": true, "Message-ID": true },
      "report": true,
      "auid": null, "expire": null, "thirdParty": null, "thirdPartyHash": null,
      "memberTenantId": null, "createdAt": "2026-09-07T09:49:21Z", "nextTransitionAt": null
    },
    { "...": "second entry, same domainId, @type: Dkim1Ed25519Sha256, selector v1-ed25519-20260907, shorter base64 publicKey" }
  ],
  "notFound": []
}
```
Key facts:
- `privateKey.secret` is **always redacted to `"****"`** in the response — Stalwart never returns private key material over this API, only the public key. Safe to call from the backend at activation time.
- There is no server-side filter-by-`domainId` argument observed on `x:DkimSignature/get`; fetch the full unfiltered `list` (as `deleteDomain()` already does) and filter client-side by `domainId` + `stage === 'active'`.
- A domain normally has **two active DKIM entries** (RSA + Ed25519). Toowix should publish DKIM TXT records for both selectors — Stalwart signs outgoing mail with both.
- DKIM DNS record construction: `name = "${selector}._domainkey.${domainName}"`, `type: 'TXT'`, `value` — for RSA: `v=DKIM1; k=rsa; p=${publicKey}`; for Ed25519: `v=DKIM1; k=ed25519; p=${publicKey}` (the `publicKey` field is already the raw base64 to go after `p=`, for both algorithms — no reformatting needed beyond wrapping in the `v=DKIM1; k=...; p=...` envelope).

### C. `Domain.dnsZoneFile` is already a complete, Stalwart-authored zone
Every domain's `x:Domain/get` response includes a fully pre-rendered `dnsZoneFile` string (already captured into `StalwartDomain.dnsZoneFile` in `backend/src/stalwart/types.ts`, but never parsed/used anywhere today). Example (redacted) for a live domain:
```
v1-ed25519-20260907._domainkey.toowix.test. IN TXT "v=DKIM1; k=ed25519; h=sha256; p=QOkG7d2..."
v1-rsa-20260907._domainkey.toowix.test. IN TXT (
    "v=DKIM1; k=rsa; h=sha256; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A..."
    "...continuation, DNS TXT split into <=255-byte quoted chunks..."
)
toowix.test. IN TXT "v=spf1 mx -all"
toowix.test. IN MX 10 localhost.
_dmarc.toowix.test. IN TXT "v=DMARC1; p=reject; rua=mailto:postmaster@toowix.test"
_caldavs._tcp.toowix.test. IN SRV 0 1 443 localhost.
_carddavs._tcp.toowix.test. IN SRV 0 1 443 localhost.
_imaps._tcp.toowix.test. IN SRV 0 1 993 localhost.
_jmap._tcp.toowix.test. IN SRV 0 1 443 localhost.
_pop3s._tcp.toowix.test. IN SRV 0 1 995 localhost.
_submissions._tcp.toowix.test. IN SRV 0 1 465 localhost.
mta-sts.toowix.test. IN CNAME localhost.
_mta-sts.toowix.test. IN TXT "v=STSv1; id=..."
_smtp._tls.toowix.test. IN TXT "v=TLSRPTv1; rua=mailto:postmaster@toowix.test"
autoconfig.toowix.test. IN CNAME localhost.
autodiscover.toowix.test. IN CNAME localhost.
```
Notes/discrepancies to resolve deliberately in `dns-records.service.ts`, not silently inherit:
- **MX target and SRV/CNAME targets show `localhost.`** in this dev environment — production Stalwart config must point these at the real public mail hostname (e.g. `mail.toowix.com`) before this zone file is fit to hand to GoDaddy; do not publish `localhost.` targets to a customer's public DNS. Confirm/patch Stalwart's server hostname config before wiring the real activation flow to a production Stalwart instance.
- **SPF here is `v=spf1 mx -all`** (hard fail) — stricter than `docs/DOMAIN_SETUP_GUIDE.md`'s documented `v=spf1 mx include:_spf.toowix.com ~all` (soft fail + include). These disagree; pick one canonical policy.
- **DMARC here is `p=reject` immediately** — much stricter than a typical progressive rollout (`p=none` → `p=quarantine` → `p=reject`) and disagrees with the existing hardcoded placeholder in `tenant.routes.ts` (`p=quarantine`). Pick one canonical policy; a progressive DMARC rollout is generally safer for a new customer domain and worth considering even though it's not what Stalwart auto-generates.
- The zone file also includes MTA-STS, TLS-RPT, autoconfig/autodiscover CNAME, and UA-auto-config records not mentioned in `docs/DOMAIN_SETUP_GUIDE.md` at all — worth including for completeness once the canonical record set is finalized, but not required for baseline mail deliverability (MX/SPF/DKIM/DMARC).

### D. Recommended approach for `dns-records.service.ts`
Prefer building the required record set from **structured `x:DkimSignature/get` output** (selector + publicKey + algorithm, per-domain) combined with Toowix's own canonical (not Stalwart-default) MX/SPF/DMARC policy, rather than regex-parsing the free-text `dnsZoneFile`. The structured DKIM data is small, typed, and stable; the zone file is useful only as a human-readable cross-check/fallback display, not as a machine-parsed source of truth for the fields that matter (SPF/DMARC policy is deliberately going to differ from Stalwart's auto-generated default per the discrepancies above).

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
| Invalid Authentication | Any | `401 Unauthorized` | `{"type": "about:blank", "status": 401, "title": "Unauthorized"}` |

---

## 6. Architecture Implications for Toowix Client

1. **Domain Lookup Cache / Mapping:** Toowix stores the Stalwart `domainId` (e.g. `"b"`) alongside the domain record in PostgreSQL, so mailbox provisioning does not need a roundtrip domain query every time.
2. **Linked DKIM Deletion:** When a tenant domain is removed or migrated by Platform Admin, the backend queries `x:DkimSignature/query` / `x:DkimSignature/get` for the matching `domainId`, and safely deletes DKIM signatures before destroying the domain principal.
3. **Password Confidentiality:** Mailbox passwords are sent directly from the Toowix Backend to Stalwart's `x:Account/set` and are **never** stored in PostgreSQL.
4. **Idempotency:** Stalwart's `primaryKeyViolation` error allows Toowix to distinguish between a new conflicting mailbox and an idempotent retry.

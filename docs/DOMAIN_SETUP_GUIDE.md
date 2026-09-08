# Toowix Mail Platform — DNS & Domain Setup Guide

This guide details the required DNS configuration for organizations hosting email on the Toowix Mail Platform.

---

## 1. Domain Registration & Tenant Binding Policy

* **Hard Invariant**: **1 Tenant = Exactly 1 Primary Domain**.
* **Automated Provisioning**: When a Super Admin approves a tenant registration application in `admin.toowix.com`, the domain is **automatically created in Stalwart** and assigned an RSA-2048/Ed25519 DKIM signing key.
* **Pre-Flight Activation Check**: During tenant activation, the backend verifies that Stalwart confirms domain readiness before issuing the applicant's 48-hour activation link.

---

## 2. Standard DNS Records Configuration

For a tenant domain (e.g. `acme.com`), the organization's DNS provider (Cloudflare, Route 53, Namecheap, etc.) must publish the following records:

### A. Inbound Mail Routing (MX Record)
Directs inbound SMTP email to the Toowix mail platform cluster.

| Type | Host / Name | Value / Target | Priority | TTL |
|---|---|---|---|---|
| **MX** | `@` (or `acme.com`) | `mail.toowix.com` | `10` | 300 / Auto |

---

### B. Sender Policy Framework (SPF Record)
Authorizes the Toowix mail servers to send email on behalf of your domain, preventing spoofing.

| Type | Host / Name | Value / Text Content | TTL |
|---|---|---|---|
| **TXT** | `@` (or `acme.com`) | `v=spf1 mx include:_spf.toowix.com ~all` | 300 / Auto |

*Note: If sending exclusively through Toowix, `v=spf1 mx ~all` is valid.*

---

### C. DomainKeys Identified Mail (DKIM Record)
Cryptographically validates that outgoing email was signed by your authorized Stalwart server and has not been altered in transit.

| Type | Host / Name | Value / Text Content | TTL |
|---|---|---|---|
| **TXT** | `toowix._domainkey` | `v=DKIM1; k=rsa; p=<PUBLIC_KEY_PROVIDED_IN_PORTAL>` | 300 / Auto |

*Retrieve your domain's specific public key from the Super Admin portal under the tenant's domain details.*

---

### D. Domain-based Message Authentication (DMARC Record)
Enforces policy on how receiving mail providers (Gmail, Microsoft 365, Yahoo) handle messages failing SPF or DKIM.

| Type | Host / Name | Value / Text Content | TTL |
|---|---|---|---|
| **TXT** | `_dmarc` | `v=DMARC1; p=reject; sp=reject; pct=100; rua=mailto:dmarc@acme.com` | 300 / Auto |

*Recommended progression:*
1. Initial deployment: `p=none` (Monitoring mode).
2. Quarantine mode: `p=quarantine; pct=100`.
3. Strict enforcement: `p=reject; pct=100` (Production standard).

---

### E. Client Autoconfiguration (IMAP & SMTP Autodiscover)
Enables Thunderbird, Apple Mail, Outlook, and mobile clients to configure mailboxes automatically.

| Type | Host / Name | Target / Value | Port | Priority | Weight |
|---|---|---|---|---|---|
| **SRV** | `_imaps._tcp` | `mail.toowix.com` | `993` | `0` | `1` |
| **SRV** | `_submission._tcp` | `mail.toowix.com` | `587` | `0` | `1` |
| **CNAME** | `autoconfig` | `mail.toowix.com` | — | — | — |
| **CNAME** | `autodiscover` | `mail.toowix.com` | — | — | — |

---

## 3. DNS Verification Commands

Verify propagation using `dig` or `nslookup`:

### 1. Verify MX
```bash
dig +short MX acme.com
# Expected output: 10 mail.toowix.com.
```

### 2. Verify SPF
```bash
dig +short TXT acme.com
# Expected output includes: "v=spf1 mx ~all"
```

### 3. Verify DKIM
```bash
dig +short TXT toowix._domainkey.acme.com
# Expected output includes: "v=DKIM1; k=rsa; p=..."
```

### 4. Verify DMARC
```bash
dig +short TXT _dmarc.acme.com
# Expected output: "v=DMARC1; p=reject; ..."
```

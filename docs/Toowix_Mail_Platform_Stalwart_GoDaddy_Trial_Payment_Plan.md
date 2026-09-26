# Toowix Mail Platform — Stalwart + GoDaddy + Trial/Payment Plan

## 1. Core Architecture

- Backend: Node.js + Express
- Database: MongoDB
- Mail server: Stalwart Community
- DNS provider integration: GoDaddy
- One tenant = one domain
- One shared Stalwart instance
- Tenant isolation enforced through `tenantId`
- Separate portals:
  - `admin.toowix.com` — Super Admin
  - `manage.toowix.com` — Tenant Admin
- Strict no-cross-portal login/access.

## 2. Tenant Registration

The customer submits:

- Company information
- Domain
- Tenant/Admin contact information
- Selected plan
- Other required registration information

Registration does **not** activate the tenant.

At registration:

- No domain activation
- No GoDaddy DNS changes
- No trial start
- No public mail-service activation

Initial state:

`pending_review`

## 3. Super Admin Approval

Super Admin reviews registrations through `admin.toowix.com`.

After approval:

`pending_review` → `approved_pending_setup`

Super Admin then performs/prepares the Stalwart-side domain setup.

Registration and activation remain separate operations.

## 4. GoDaddy Authorization

GoDaddy authorization may happen:

- During registration, or
- Later when activation is ready.

Toowix uses the authorization for the initial activation process only.

Toowix does **not** retain permanent DNS-management permission for future changes. Future DNS changes require manual handling or fresh authorization.

Before activation, Toowix should verify that the authorized GoDaddy account actually manages the customer's entered domain.

## 5. Domain Activation

GoDaddy automation happens **only when the Super Admin clicks Activate Domain**.

Recommended sequence:

1. Super Admin clicks **Activate Domain**.
2. Toowix enables/configures the domain in Stalwart.
3. Toowix obtains the required mail DNS records from Stalwart.
4. Toowix checks existing public DNS for conflicts.
5. Toowix creates the required mail records in GoDaddy.
6. Toowix verifies public DNS.
7. Domain becomes active.
8. The 30-day trial starts after successful activation/DNS verification.

Conceptual flow:

`Super Admin → Stalwart setup → Get DNS records → GoDaddy → Public DNS verification → Active`

## 6. Stalwart as DNS Source of Truth

Required mail DNS records must be obtained dynamically from Stalwart.

Do **not** hard-code:

- MX
- SPF
- DKIM
- DKIM selector
- DKIM public key
- DMARC, where applicable
- Other Stalwart-required mail records

Stalwart is the source of truth for the exact records required for each domain.

This is especially important for DKIM selectors and keys.

## 7. DNS Scope

Toowix should create only **mail-related DNS records**.

It must not modify unrelated customer DNS such as:

- Website records
- CDN records
- Application records
- Unrelated verification records
- Other customer infrastructure

## 8. DNS Conflict Protection

Existing conflicting mail records must never be overwritten automatically.

Example:

```text
acme.com
MX → another-mail-provider.com
```

If a conflict is detected:

- Activation stops.
- Super Admin is informed.
- The exact conflicting DNS records are shown.
- Super Admin can retry after the customer resolves the conflict.

The UI should provide a clear warning such as:

> `acme.com` already has MX records pointing to another mail provider. Activation cannot continue until the conflict is resolved.

## 9. Retry / Verify

When Super Admin clicks **Retry / Verify**:

1. Re-check current public DNS.
2. If required Toowix/Stalwart records are missing, recreate them in GoDaddy.
3. Verify DNS again.
4. Continue activation only when required records are correct.
5. Never blindly overwrite conflicting mail records.

## 10. DNS Propagation

GoDaddy accepting a DNS API request does not mean public DNS has propagated.

During propagation, the domain remains:

`activating`

Toowix automatically retries DNS verification for a limited period of approximately **24–48 hours**.

If verification succeeds:

`activating` → `active`

If verification does not succeed within the retry window:

`activating` → `activation_failed`

Super Admin is notified and can manually retry later.

## 11. Trial Start

The 30-day trial starts **only after successful domain activation and DNS verification**.

The trial does not start when:

- Customer registers
- Super Admin approves the registration
- GoDaddy is connected
- Stalwart setup begins
- DNS changes are submitted

This prevents trial time from being consumed while waiting for approval or DNS propagation.

## 12. 30-Day Trial

Once activated:

`ACTIVE → 30-DAY TRIAL`

The tenant has normal mail service during the trial.

## 13. Seven-Day Grace Period

After the 30-day trial expires without payment:

`ACTIVE → GRACE_PERIOD`

Grace period duration:

**7 days**

During grace:

- Receiving mail continues.
- Sending mail is blocked.
- Tenant remains administratively visible.

Notifications are sent to:

- Tenant Admin
- Super Admin

Mailbox users are not directly notified by this lifecycle event.

## 14. Payment During Grace

If payment succeeds during the grace period:

`GRACE_PERIOD → ACTIVE`

The system:

- Immediately restores sending.
- Requires no Super Admin approval.
- Does not require DNS re-verification.

## 15. Suspension

If payment is not received after the seven-day grace period:

`GRACE_PERIOD → SUSPENDED`

Suspension is a service restriction, not data deletion.

Preserve:

- Mailboxes
- Existing emails
- Tenant configuration
- Relevant tenant data

While suspended:

- Mailbox login is blocked.
- Reading email is blocked.
- Sending is blocked.
- Receiving is blocked at the service level.

## 16. DNS During Suspension

Suspension must **not** modify GoDaddy DNS.

Existing Toowix mail DNS records remain untouched.

No automatic DNS cleanup should occur merely because of suspension.

## 17. Payment After Suspension

If a suspended tenant pays:

`SUSPENDED → ACTIVE`

Reactivation is automatic.

Requirements:

- No Super Admin approval.
- No GoDaddy DNS re-authorization.
- No DNS re-verification.
- Mail service is restored immediately.

## 18. Billing Lifecycle Reset

After successful reactivation from suspension, the previous trial/grace lifecycle is reset for the new billing lifecycle.

The historical billing/payment events should still be retained for audit purposes.

Resetting the lifecycle must **not** mean deleting historical records.

## 19. Overall State Machine

```text
                    ┌──────────────────┐
                    │  Tenant Register │
                    └────────┬─────────┘
                             ↓
                     PENDING_REVIEW
                             ↓
                  SUPER ADMIN APPROVES
                             ↓
                 APPROVED_PENDING_SETUP
                             ↓
                    Stalwart Setup
                             ↓
                 SUPER ADMIN ACTIVATES
                             ↓
                       ACTIVATING
                             ↓
                    DNS Verification
                       ↙           ↘
              CONFLICT/FAIL       SUCCESS
                   ↓                 ↓
            ACTIVATION_FAILED      ACTIVE
                                     ↓
                              30-DAY TRIAL
                                     ↓
                              GRACE — 7 DAYS
                              ↙             ↘
                         PAYMENT          NO PAYMENT
                           ↓                  ↓
                        ACTIVE            SUSPENDED
                                            ↓
                                         PAYMENT
                                            ↓
                                          ACTIVE
```

## 20. Non-Negotiable Rules

1. Registration never activates a domain.
2. GoDaddy DNS changes happen only during Super Admin activation.
3. Stalwart is the source of truth for required mail DNS records.
4. DNS records must be obtained dynamically from Stalwart.
5. DKIM selectors and keys must never be hard-coded.
6. Conflicting MX/mail records must never be overwritten automatically.
7. Only mail-related DNS records are managed.
8. Public DNS must actually verify before activation succeeds.
9. Trial starts only after successful activation/DNS verification.
10. Trial duration is 30 days.
11. Grace period is 7 days.
12. During grace, receiving continues and sending is blocked.
13. Suspension preserves mailboxes and stored email.
14. Suspended mailbox users cannot access their mailboxes.
15. Suspension does not modify GoDaddy DNS.
16. Payment automatically restores service.
17. Reactivation does not require Super Admin approval.
18. Reactivation does not perform DNS verification.
19. GoDaddy authorization is not retained for permanent future DNS management.
20. DNS verification automatically retries for approximately 24–48 hours before activation fails.
21. Historical billing/payment events remain available for audit even when the billing lifecycle resets after reactivation.

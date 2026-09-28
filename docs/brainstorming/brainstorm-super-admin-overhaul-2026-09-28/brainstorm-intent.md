# Super Admin Overhaul: Strategic Intent & Synthesis

**Generated via:** BMad Brainstorming (`autonomous` / `Ideate for me` stance)  
**Topic:** Comprehensive Super Admin Portal Overhaul & Redesign  
**Project:** Toowix Mail Platform (Stalwart Mail Engine, GoDaddy DNS, MongoDB, Stripe Billing, React/Vite)  
**Artifacts Generated:** 
- Canonical Memlog: [`.memlog.md`](file:///c:/Users/xeon3/Desktop/toowix-mail-platform-app/toowix-mail-platform/docs/brainstorming/brainstorm-super-admin-overhaul-2026-09-28/.memlog.md)
- Interactive HTML Keepsake: [`brainstorm.html`](file:///c:/Users/xeon3/Desktop/toowix-mail-platform-app/toowix-mail-platform/docs/brainstorming/brainstorm-super-admin-overhaul-2026-09-28/brainstorm.html)

---

## 1. Executive Summary & Core Diagnosis

The Super Admin portal is currently caught between two identities:
1. A **low-frequency administrative settings panel** (creating plans, looking at deleted org archives).
2. A **mission-critical operational triage console** (diagnosing DNS verification failures, investigating stuck email queues, supporting compromised mailboxes).

Because navigation and views treat every function with equal visual weight, operators suffer from friction: modal-in-modal loops, hunting for tenant details across multiple clicks, missing proactive Stalwart queue health, and lacking safeguards around destructive operations.

The **overhaul intention** is to transform the Super Admin portal into a **high-density, proactive MailOps cockpit**:
- **Sub-second navigation via Command Palette (`⌘K`)**.
- **360-Degree Tenant Hub** replacing disconnected detail views.
- **Proactive MailOps & Deliverability Engine** with live DNS drift recovery and Stalwart telemetry.
- **Foolproof Non-Destructive Guardrails** (safe quarantine sandboxes, 2-person approval for data purging).

---

## 2. Four Core Strategic Pillars

```
+-----------------------------------------------------------------------------------+
|                            THE 4 STRATEGIC PILLARS                                |
+-------------------------+-------------------------+-------------------------------+
|  1. HIGH-DENSITY UI     |  2. PROACTIVE MAILOPS   |  3. TENANT 360 & GOVERNANCE   |
|  • Command Palette (⌘K) |  • Live Stalwart Queues |  • 15m STS Impersonation      |
|  • Slide-over Drawers   |  • DNS Drift Healer     |  • Safe Quarantine Sandbox    |
|  • OLED Dark/Light Theme|  • Direct JMAP Bridge   |  • 2-Person Purge Rule        |
|  • Virtualized Tables   |  • Deliverability Matrix|  • Provisioning Rollback (2PC)|
+-------------------------+-------------------------+-------------------------------+
|                             4. MONETIZATION & INTELLIGENCE                        |
|  • Stripe Webhook Auto-Healer • 85%+ Quota Upsell Heatmap • Bulk M365/Google CSV  |
+-----------------------------------------------------------------------------------+
```

### Pillar 1: High-Density Operator UI (Vim/Linear Speed)
- **Universal Command Palette (`⌘K` / `Ctrl+K`):** Global instant search for tenants, domains, mailboxes, and administrative actions with keyboard navigation.
- **Slide-Over Drawers:** Eliminate modal-in-modal traps. Clicking a domain, mailbox, or audit log slides in an inspector drawer while keeping the background table visible.
- **Operator Theme Engine:** Dedicated high-contrast OLED dark mode for NOC night shifts, with customizable table density (compact/comfortable).

### Pillar 2: Proactive MailOps & Deliverability Engine
- **DNS Drift Reconciler:** Background job cross-referencing GoDaddy API with actual DNS resolution; flags drifted SPF/DKIM/DMARC records and provides a 1-click `Restore DNS Matrix` button.
- **Stalwart Queue & Spool Inspector:** Real-time visibility into active, deferred, and frozen queues in Stalwart, with options to flush queues or purge outbound spam runs.
- **Direct JMAP/SMTP Diagnostic Bridge:** In-portal console allowing operators to test JMAP queries directly against Stalwart without external tooling.

### Pillar 3: Tenant 360 & Bulletproof Governance
- **Zero-Latency Tenant Impersonation:** 15-minute cryptographically scoped STS token allowing an operator to "View as Tenant Admin" or "View Webmail" with full audit recording.
- **Tenant 360 Hub:** Unified view consolidating Overview, Domains, Mailboxes, Deliverability Score, Billing, and Operator Notes into one persistent screen.
- **Safe Mode Quarantine Sandbox:** Instead of abrupt tenant suspension, 1-click quarantine diverts outbound mail to a test sink/hold queue.
- **Two-Person Purge Verification:** Irreversible deletion of tenants or mailboxes requires dual admin confirmation.

### Pillar 4: Monetization & Enterprise Intelligence
- **Stripe Webhook Desync Auto-Healer:** 1-click reconciliation between Stripe customer subscriptions and MongoDB state.
- **Storage Upsell Heatmap:** Surface tenants nearing 85%+ quota to trigger automated or manual plan upgrades.
- **Bulk Migration Wizard:** Step-by-step importer for domains, mailboxes, and aliases from Google Workspace, Microsoft 365, or cPanel.

---

## 3. High-Leverage Implementation Sequence

| Phase | Milestone | Key Deliverables | Downstream Target |
|---|---|---|---|
| **Phase A** | **Ergonomics & Navigation** | Global `⌘K` Command Palette, Slide-over inspection drawers, Humanized timestamps, Table density toggle | Direct UX Polish |
| **Phase B** | **Tenant 360 Hub** | Unified Tenant Hub (tabs: Overview, Domains, Mailboxes, Deliverability, Billing, Audit), 15m STS impersonation | `bmad-spec` |
| **Phase C** | **MailOps Telemetry** | Stalwart mail queue viewer, DNS drift reconciler with GoDaddy sync, JMAP test bridge | `bmad-architecture` |
| **Phase D** | **Safety & Monetization** | Safe quarantine sandbox, Stripe subscription desync healer, Quota overage alerts | `bmad-prd` |

---

## 4. Suggested Next Steps

1. **Review the Visual Keepsake:** Open [`brainstorm.html`](file:///c:/Users/xeon3/Desktop/toowix-mail-platform-app/toowix-mail-platform/docs/brainstorming/brainstorm-super-admin-overhaul-2026-09-28/brainstorm.html) in your browser to interact with the search bar, preview the 360 cockpit mockup, and explore all 100 generated concepts.
2. **Select Focus Areas:** Confirm which pillars to prioritize for immediate implementation.
3. **Downstream BMad Skills:**
   - Run `/bmad-spec` to distill Phase A & B into an engineering specification.
   - Run `/bmad-architecture` to specify the STS impersonation tokens and Stalwart telemetry integration.

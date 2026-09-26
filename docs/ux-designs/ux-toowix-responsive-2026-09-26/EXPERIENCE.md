---
name: Toowix Mail Platform
status: final
sources:
  - docs/ux-designs/ux-toowix-responsive-2026-09-26/DESIGN.md
  - DESIGN.md
updated: 2026-09-26
---

# Toowix Mail Platform — Experience Spine

> Responsive web — multi-surface (desktop, tablet, phone). Tailwind CSS v3 via CDN + vanilla CSS design system. Two portals: Super Admin (platform operator) and Tenant Admin (organisation administrator). `DESIGN.md` is the visual identity reference; this spine is the experience.

## Foundation

Multi-surface responsive web. React + Vite + Tailwind CSS v3 (CDN). Two separate SPAs sharing a common design system:

- **Super Admin Portal** (`/super-admin`): Platform-wide operational oversight — tenants, plans, coupons, system health, audit logs, analytics.
- **Tenant Admin Portal** (`/tenant-admin`): Per-organisation management — mailboxes, domains, DNS, storage, billing, security, team moderators.

Both portals inherit `DESIGN.md` tokens. UI components are vanilla React with CSS classes from `index.css` (design system) + Tailwind utilities. No component library (no shadcn, no MUI). Lucide React for all iconography.

Form factor: **desktop-first existing codebase, migrating to mobile-first responsive**. Full feature parity across all viewports.

## Information Architecture

### Super Admin Portal

| Surface | Reached from | Purpose |
|---|---|---|
| Login | `/login` (unauthenticated) | Super Admin authentication with 2FA |
| Forgot Password | Login → "Forgot password" | Password reset flow |
| Dashboard | Sidebar → Dashboard | Platform overview: stats, health, recent activity |
| Tenants | Sidebar → Tenants | Tenant directory with search, filter, status |
| Tenant Detail | Tenants → row tap | Deep-dive: domains, mailboxes, admins, audit, governance |
| Plans | Sidebar → Plans | Subscription plan management |
| Coupons | Sidebar → Coupons | Discount coupon CRUD |
| Analytics | Sidebar → Analytics | Platform-wide email and usage analytics |
| System Health | Sidebar → System Health | MongoDB, Stalwart, backups, SMTP relay diagnostics |
| Audit Log | Sidebar → Audit Log | Chronological administrative action history |
| Active Devices | Sidebar → Active Devices | Active sessions across all administrators |
| Deleted Organisations | Sidebar → Deleted Organisations | Permanent audit trail of removed tenants |

Sidebar navigation rail — fixed on desktop (≥ `{components.breakpoints.lg}`), off-canvas drawer on tablet and mobile. Drawer triggered by hamburger icon in top header.

### Tenant Admin Portal

| Surface | Reached from | Purpose |
|---|---|---|
| Login | `/login` (unauthenticated) | Tenant Admin / Moderator authentication with 2FA |
| Register | Login → "Register" | New tenant registration with plan selection |
| Activate Tenant | Post-approval redirect | Domain setup wizard for newly approved tenants |
| Forgot Password | Login → "Forgot password" | Password reset flow |
| Tenant Home | Authenticated root | Organisation overview, domain cards, recent activity |
| Domain Dashboard | Tenant Home → domain card | Per-domain management: mailboxes, storage, billing, etc. |
| Mailboxes | Domain Dashboard sidebar → Mailboxes | Create, manage, reset, delete mailboxes for active domain |
| Storage | Domain Dashboard sidebar → Storage | Usage breakdown and quota monitoring |
| Billing | Domain Dashboard sidebar → Billing | Invoices, payment methods, plan management |
| Domains | Domain Dashboard sidebar → Domains | DNS setup, verification, domain security |
| Security | Domain Dashboard sidebar → Security | 2FA, allowed/blocked IPs, firewall rules |
| Team | Domain Dashboard sidebar / Tenant Home → Team | Moderator management (invite, roles, remove) |
| Cart | Header → Cart icon | Checkout for plan changes, add-ons |

Same sidebar pattern as Super Admin: fixed rail on desktop, off-canvas drawer on mobile. Domain switcher component lives in the sidebar.

→ DESIGN.md is the visual spec. Spine wins on conflict.

## Voice and Tone

Microcopy. Brand voice and aesthetic posture live in `DESIGN.md`.

| Do | Don't |
|---|---|
| "Mailbox provisioned." | "Your mailbox has been successfully created! 🎉" |
| "Domain verified. DNS records confirmed." | "Great news! Your domain is now fully set up." |
| "Session revoked." | "The device has been logged out successfully." |
| "Tenant suspended." | "This organisation's access has been paused." |
| "2FA enabled. Save your backup codes." | "Two-factor authentication is now active! Your account is more secure than ever!" |
| Action + result in one line. | Separate confirmation paragraph. |
| Error: state what failed and what to do. "DNS record missing. Add a TXT record at your registrar." | "Something went wrong. Please try again later." |

Confirmation banners auto-dismiss after 4 seconds. Error banners persist until user dismissal or retry.

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
|---|---|---|
| Sidebar nav rail | Both portals | Desktop: fixed, always visible. Mobile/Tablet: off-canvas drawer via hamburger. Active item highlighted with `{colors.primary-tint}` background. Tap closes drawer on mobile. |
| Top header bar | Both portals | Desktop: role badge, 2FA status, email, Devices, Webmail, Logout — all visible. Mobile: hamburger + brand + role badge (compact) + overflow menu (three-dot) for remaining actions. |
| Overflow menu | Mobile header | Three-dot icon → dropdown menu containing: 2FA status, Devices, Webmail link, Logout. Opens on tap, closes on outside tap or Escape. |
| Data table | Directory/list views | Desktop: standard `<table>`. Mobile: converts to card stack for ≤4 columns, horizontal scroll for ≥5 columns (see DESIGN.md §5 "Responsive Table Behavior"). |
| Mobile data card | Mobile table replacement | Stacked card per row. Tap anywhere on card → navigate to detail (for navigable rows). Actions via trailing icon buttons. |
| Stat card | Dashboard overviews | Single column stack on mobile. Padding reduces per DESIGN.md. |
| Modal dialog | CRUD actions, confirmations | Desktop: centered overlay. Mobile: near-full-screen for wizards, centered-reduced-padding for simple confirms. Footer buttons stack vertically. |
| Domain switcher | Tenant Admin sidebar | Dropdown selector in sidebar. On mobile drawer: same position, tap to expand domain list within drawer. |
| Action menu (three-dot per row) | Mailbox/tenant row actions | Desktop: hover to reveal. Mobile: always visible. Tap opens a positioned popover. If popover would overflow viewport, opens upward. [ASSUMPTION: no bottom-sheet conversion needed — positioned popover with viewport-aware placement is sufficient] |
| 2FA setup modal | Navbar | QR code + manual key + 6-digit input. On mobile: QR scales to fit viewport width. Manual key block uses `word-break: break-all`. Buttons stack vertically. |
| Wizard stepper | DomainSetupModal, RegisterView, ActivateTenantView | Desktop: horizontal step indicators. Mobile: compact — show current step number and title only (e.g., "Step 2 of 4: DNS Verification"). Previous/Next buttons always visible. |
| Toast / alert banner | Global feedback | Fixed to top of content area (below header). Full-width on mobile. Auto-dismiss for success, persist for errors. |
| Domain DNS record display | DNS panels | Monospace blocks with copy buttons. Mobile: horizontal scroll within each record block. Copy button always visible (no hover-to-reveal). |
| Cart nav button | Tenant header | Badge count over cart icon. Always visible in header, not hidden in overflow menu. |
| Search + filter bar | List views | Desktop: inline search + dropdown filters side-by-side. Mobile: search input full-width, filters in a collapsible "Filters" accordion below. |
| Pagination | Tables | Desktop: "Showing 1–10 of 50" + prev/next buttons. Mobile: same layout but text abbreviates to "1–10 / 50". |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Initial load | Any authenticated view | Full-page centered spinner with brand mark. Both portals. |
| View loading | Dashboard, tables | Skeleton rows (4–6) matching expected layout height. Never blank white space. |
| Empty table | Any list view | Centered empty state card: icon circle + title + description + primary action button. Full-width on mobile. |
| No domains | Tenant Dashboard | "Add your first domain" CTA card with illustrated graphic. Graphic hidden on mobile (< md). |
| Offline | N/A | Not handled — admin consoles require connectivity. No offline mode. |
| Session expired | Any view | Redirect to login with "Session expired. Please sign in again." message on login page. |
| 2FA not enabled | Dashboard (both portals) | Dismissible banner below header. Persists across navigation until dismissed. `sessionStorage` tracks dismissal per login session. |
| Sidebar drawer open | Mobile/Tablet | Body scroll locked (prevent background scrolling). Focus trapped within drawer for accessibility. |
| Modal open | Any view | Body scroll locked. Focus trapped within modal. Escape key closes. Backdrop click closes (except destructive confirmations). |
| Form validation error | Forms | Inline error text below field in `{colors.error-text}`. Field border turns `{colors.error}`. Error message announces to screen readers. |
| Destructive action confirmation | Delete modals | User must type entity name to confirm. Delete button disabled until exact match. On mobile: input full-width, button full-width below. |
| DNS verification pending | Domain management | Polling indicator with "Checking DNS records..." text. Auto-refreshes every 30 seconds. Manual refresh button always available. |

## Interaction Primitives

**Mouse + keyboard on desktop. Touch-first on mobile.** Both portals are administrative tools; no consumer gestures needed.

- **Tap** to act on all interactive elements. Minimum touch target: `44 × 44px` on mobile per `DESIGN.md`.
- **Swipe-left** on sidebar drawer overlay to close (mobile only).
- **Scroll**: Native scroll. No custom scrollbars. `-webkit-overflow-scrolling: touch` on all scrollable containers.
- **Long-press**: Not used. Reserved for browser default (text selection, link preview).
- **Pull-to-refresh**: Not implemented. Use explicit refresh buttons on data views.
- **Hover actions**: Desktop only. On touch devices, all row actions are always visible (icon buttons, not hidden behind hover).
- **Keyboard shortcuts**: Not implemented in v1. All actions accessible via visible UI controls.
- **Focus management**: On modal/drawer open, focus moves to first focusable element. On close, focus returns to trigger element.

**Banned:** swipe-to-delete, shake-to-undo, multi-touch gestures, drag-and-drop, carousel swipe for navigation.

## Accessibility Floor

Behavioral. Visual contrast lives in `DESIGN.md`.

- **WCAG 2.1 AA** as the minimum bar.
- All interactive elements have visible focus indicators (2px `{colors.primary}` outline with 2px offset).
- Screen reader: every button and link has an accessible name. Icon-only buttons use `aria-label`. Status badges announce their semantic meaning.
- Focus trap: modals and sidebar drawer trap focus when open.
- Escape key: closes any overlay (modal, drawer, dropdown, popover).
- Reduced motion: `@media (prefers-reduced-motion: reduce)` → disable all transitions and animations. Already partially implemented in tenant-admin CSS.
- Touch targets: `44 × 44px` minimum on mobile, per DESIGN.md. Applies to all buttons, links, and interactive controls.
- Form inputs: `16px` font size on mobile to prevent iOS Safari auto-zoom.
- Color is never the sole indicator: status badges include dot + text + background, not color alone.
- Headings follow a single `<h1>` per view with proper hierarchy.

## Responsive & Platform

### Form-Factor Matrix

| Viewport | Sidebar | Header | Content | Tables | Modals |
|---|---|---|---|---|---|
| Desktop (≥ 1024px) | Fixed 240px rail | Full actions visible | `pl-60`, `max-w-6xl`, `zoom: 1.12` | Full table | Centered, max-width per variant |
| Tablet (768–1023px) | Off-canvas drawer | Hamburger + compact actions + overflow | Full-width, `px-6`, `zoom: 1` | Sticky first column + scroll | Centered, `calc(100vw - 48px)` |
| Mobile (< 768px) | Off-canvas drawer | Hamburger + brand + overflow | Full-width, `px-4`, `zoom: 1` | Cards (≤4 cols) or scroll (≥5 cols) | Near-full-screen for wizards, reduced-padding for simple |

### Sidebar Drawer Specification

```
Trigger:     Hamburger icon (24px Lucide Menu icon) in top-left of header
Width:       280px
Direction:   Slide from left
Duration:    250ms
Easing:      cubic-bezier(0.16, 1, 0.3, 1)
Overlay:     rgba(15, 23, 42, 0.45), covers full viewport
Z-index:     50
Close on:    Overlay tap, nav item tap, swipe-left (≥50px), Escape key
Body lock:   overflow: hidden on <body> while open
Focus trap:  First focusable element receives focus on open
```

### Header Responsive Behavior

```
Desktop (≥ lg):
  [Brand] ——————————————— [Role Badge] [2FA] [Email] [Devices] [Webmail] [Logout]

Tablet (md–lg):
  [☰ Hamburger] [Brand] ————————————————————————— [Role Badge] [⋮ Overflow]

Mobile (< md):
  [☰ Hamburger] [Brand Logo] ————————————————————— [🛒 Cart*] [⋮ Overflow]
  (* Cart icon only in Tenant Admin)
```

### Page-Level Responsive Rules

| Page | Desktop Layout | Mobile Layout |
|---|---|---|
| Login / Register | Centered `auth-card`, max-width 440px | Full-width card, reduced padding (20px), edge-to-edge on small screens |
| Dashboard Overview | 3-column stat grid + 2-column details | Single-column stack, cards full-width |
| Tenants List | Full data table with all columns | Card layout: org name + status badge, domain, mailbox count |
| Tenant Detail | Sub-tab bar + content area | Sub-tabs become scrollable horizontal bar, content single-column |
| Mailboxes | Table with search + filters inline | Search full-width, filters collapsed, mailbox cards |
| System Operations | Multi-card grid (2–3 cols) | Single-column card stack |
| Billing | Invoice table + payment card | Invoice cards, payment form full-width |
| Security Settings | Two-column (label + control) | Single-column, label above control |
| Domain Setup Wizard | Step indicators horizontal + content | Step counter text + full-width content, buttons stacked |
| Cart / Checkout | Two-column (items + summary) | Single-column, sticky summary at bottom |

### Touch-Specific Adaptations

- Row action menus: always visible as icon buttons on mobile (no hover-to-reveal).
- Copy buttons for DNS records and API keys: always visible, not hover-dependent.
- Dropdown menus: if they would extend below the viewport, open upward.
- Modal close: tap overlay or swipe-down (for full-screen wizard modals). [ASSUMPTION: swipe-down to close is v2; for v1, explicit close button + overlay tap is sufficient]
- Floating action menus (mailbox three-dot): positioned relative to tap point, viewport-aware. If near bottom edge, opens upward.

## Key Flows

### Flow 1 — Priya checks system health from her phone (Super Admin, morning commute)

1. Priya opens the Super Admin portal on her phone's browser.
2. Login page renders full-width with the auth card edge-to-edge.
3. She enters credentials and 2FA code. The TOTP input field is centered, large, monospace.
4. Dashboard loads — single-column stat cards. She scans: all green.
5. She taps the hamburger icon. Sidebar drawer slides in from left.
6. She taps "System Health". Drawer closes. System Operations view loads.
7. Health cards stack vertically. MongoDB: green. Stalwart: green. Backup: up to date.
8. **Climax:** Priya sees everything healthy in 15 seconds. She pockets her phone. The platform is running.

Failure: Stalwart shows amber. She taps the SMTP diagnostics card. Test email button is full-width on mobile. She sends a test ping. Result appears inline below the button.

### Flow 2 — Rajan manages a tenant's mailboxes from tablet (Super Admin, desk but no laptop)

1. Rajan opens the Super Admin portal on his iPad in portrait mode.
2. Dashboard loads. He taps the hamburger to open the sidebar drawer.
3. He taps "Tenants". The drawer closes. Tenants list loads.
4. The tenant list shows cards — each with org name, primary domain, status badge, mailbox count.
5. He taps "Acme Corp" card. Tenant Detail view loads with horizontal scrollable sub-tabs (Domains, Mailboxes, Admins, Audit, Governance).
6. He taps "Mailboxes" sub-tab. Mailbox table renders — 5 columns, so it uses horizontal scroll with sticky first column (email).
7. He scrolls right to see the status and actions columns. Taps three-dot on a mailbox. Action menu appears above the row (viewport-aware positioning).
8. **Climax:** He resets a mailbox password from the action menu. Confirmation toast appears at top. Done from tablet in under a minute.

### Flow 3 — Meera adds a domain from her phone (Tenant Admin, after working hours)

1. Meera opens the Tenant Admin portal on her Android phone.
2. She logs in. Tenant Home loads with her two domain cards stacked vertically.
3. She taps the hamburger. Sidebar drawer opens.
4. She taps "Domains" to go to domain management.
5. She taps "Add Domain". The DomainSetupModal opens near-full-screen (slides up from bottom, rounded top corners).
6. Step counter shows "Step 1 of 4: Domain Name". Input field is full-width. She types `newdomain.com`.
7. She taps "Next". Step 2: DNS Verification. The DNS records display in monospace blocks with always-visible copy buttons.
8. She long-presses to select a DNS record value (system text selection), copies it.
9. She switches to her registrar app, adds the TXT record, switches back.
10. She taps "Verify DNS". Polling spinner. After 12 seconds: "DNS records confirmed."
11. **Climax:** Step 3 shows the domain verified with a green badge. She taps "Finish". The new domain appears in her domain list. She managed critical infrastructure from her phone, after hours.

### Flow 4 — Karthik creates a mailbox from his phone (Tenant Admin Moderator, field office)

1. Karthik is a Moderator — he only sees Mailboxes and Security in the sidebar.
2. He opens the Tenant Admin portal on his phone. Login renders edge-to-edge.
3. After auth, the mailbox list loads as cards (3 columns → cards on mobile).
4. He taps the "+" button (floating or at top of list). Create Mailbox modal opens.
5. Three fields stack vertically: Display Name, Local Part (with @domain suffix shown), Password.
6. He fills them in. "Create" button is full-width at the bottom.
7. The mailbox is created. Toast: "mailbox@domain.com provisioned."
8. **Climax:** The new mailbox card appears at the top of the list with an "active" badge. Karthik didn't need desktop access.

---

*Next recommended steps: `bmad-architecture` (update architecture doc with responsive patterns), then `bmad-create-epics-and-stories` (generate implementation stories from this spine).*

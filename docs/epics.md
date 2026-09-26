# Toowix Mail Platform — Gap Remediation Epics

Requirements and implementation stories derived from [toowix_mail_platform_gaps_plan.md](file:///C:/Users/xeon3/.gemini/antigravity-ide/brain/33fe5c06-7a91-4e2c-9bed-2d525418412c/toowix_mail_platform_gaps_plan.md) and [Toowix_Mail_Platform_Stalwart_GoDaddy_Trial_Payment_Plan.md](file:///c:/Users/xeon3/Desktop/toowix-mail-platform-app/toowix-mail-platform/docs/Toowix_Mail_Platform_Stalwart_GoDaddy_Trial_Payment_Plan.md).

---

## Epic 1: Stalwart Access Control & Admin UI Lockdown

Lock down Stalwart Community Mail Server so that `/admin` and `/account` endpoints return 404 to the public internet, while permitting JMAP and autoconfig mail protocols.

### Story 1.1: Configure allowedEndpoints in bootstrap.sh
As a platform engineer,  
I want `deploy/stalwart-bootstrap/bootstrap.sh` to configure `server.http.allowedEndpoints` via Stalwart's JMAP API `x:Http/set`,  
So that new or restarted Stalwart deployments automatically restrict `/admin` to private listeners.

**Acceptance Criteria**:
- Given a running Stalwart node, when `bootstrap.sh` executes, it calls JMAP `x:Http/set` with the source-verified `path` variable.
- `/admin`, `/account`, and `/form` are blocked on public listeners with a 404 response.
- Loopback (`127.0.0.1`) and private listeners retain full administrative access.

### Story 1.2: Automate allowedEndpoints Access Verification
As a test engineer,  
I want automated test assertions verifying the endpoint filter behavior,  
So that regressions in Stalwart configuration are caught in CI/CD.

**Acceptance Criteria**:
- A script or test asserts that simulated public requests to `/admin` return HTTP 404.
- JMAP calls to `/jmap` and `/.well-known/*` return HTTP 200.

---

## Epic 2: Stalwart Entity Drift 1-Click Auto-Repair

Provide full self-healing capabilities when discrepancies between MongoDB (source of truth) and Stalwart are detected.

### Story 2.1: Implement repairEntityDrift in Reconciliation Service
As a backend engineer,  
I want `ReconciliationService` to implement `repairEntityDrift()`,  
So that active MongoDB domains and mailboxes missing from Stalwart can be restored programmatically.

**Acceptance Criteria**:
- Given a drift report where domains or accounts exist in MongoDB but are missing in Stalwart:
  - `repairEntityDrift()` invokes `stalwartClient.createDomain()` for each missing domain.
  - `repairEntityDrift()` invokes `stalwartClient.createAccount()` for each missing active mailbox.
- Structured `logAudit` events are emitted for every restored entity.
- Quota counters are aligned upon completion.

### Story 2.2: Add Auto-Repair API Route in system.routes.ts
As an API developer,  
I want a protected route `POST /api/v1/system/reconcile/auto-repair`,  
So that Super Admins can safely trigger self-healing.

**Acceptance Criteria**:
- Route requires valid Super Admin authentication.
- Returns execution summary with counts of restored domains and accounts.
- Re-runs `checkDrift()` after repair to confirm `synchronized: true`.

### Story 2.3: Build Auto-Repair UI in SystemOperationsView
As a Super Admin,  
I want an "Auto-Repair Drift" action in `SystemOperationsView.tsx`,  
So that I can heal discrepancies directly from the web dashboard.

**Acceptance Criteria**:
- Button is visible whenever drift is detected.
- Shows loading state and displays toast notification with exact repaired counts.
- Refreshes the drift audit card automatically.

---

## Epic 3: Dynamic Webmail Launcher & SSO Handover

Ensure tenant admins and mailbox users can launch webmail across any deployment environment without hardcoded localhost references.

### Story 3.1: Replace Hardcoded Webmail URLs with Environment Configuration
As a frontend engineer,  
I want `Navbar.tsx` in both `tenant-admin` and `super-admin` to derive the webmail URL from `import.meta.env.VITE_WEBMAIL_URL`,  
So that webmail links work seamlessly across development, staging, and production domains.

**Acceptance Criteria**:
- Replaces `http://localhost:8888` in `apps/tenant-admin/src/components/Navbar.tsx` and `apps/super-admin/src/components/Navbar.tsx`.
- Defaults gracefully to `http://localhost:8888` if env variable is unset.
- Links open with `target="_blank"` and `rel="noopener noreferrer"`.

### Story 3.2: Add Direct Mailbox Launch Shortcuts in MailboxManagementView
As a tenant administrator,  
I want a direct "Open in Webmail" button in each mailbox row in `MailboxManagementView.tsx`,  
So that I can quickly test or access specific mail accounts.

**Acceptance Criteria**:
- Each active mailbox row includes a webmail launch button with icon.
- Passes the mailbox email address as a deep-link parameter if supported by the webmail client.

---

## Epic 4: Outbound SMTP Relay Health Diagnostic

Verify external email delivery capabilities without having to compose manual test emails.

### Story 4.1: Implement SMTP Relay Diagnostic Service & Route
As a backend engineer,  
I want `POST /api/v1/system/test-relay` in `system.routes.ts`,  
So that the platform can test SMTP handshake and STARTTLS connectivity against upstream relays.

**Acceptance Criteria**:
- Tests connectivity against configured Stalwart SMTP egress or external relay.
- Reports connection latency, TLS status, and server banner.
- Emits audit log entry.

### Story 4.2: Add SMTP Relay Diagnostic Card in Super Admin
As a Super Admin,  
I want an SMTP diagnostic panel in `SystemOperationsView.tsx`,  
So that I can verify mail deliverability health at a glance.

**Acceptance Criteria**:
- Card with "Test Relay Connection" action and recipient input.
- Displays connection latency and success/failure status badges.

---

## Epic 5: Responsive Foundation & App Shells

Establish core responsive breakpoints, media query tokens, off-canvas drawers, and mobile headers across both Super Admin and Tenant Admin portals.

### Story 5.1: Configure Responsive Breakpoints & Viewport Rules in index.css
As a frontend engineer,  
I want standard responsive media queries in `apps/super-admin/src/index.css` and `apps/tenant-admin/src/index.css`,  
So that typography, cards, tables, and modal tokens adapt predictably across mobile (<768px), tablet (768-1023px), and desktop (≥1024px) viewports.

**Acceptance Criteria**:
- Breakpoints defined for `sm: 640px`, `md: 768px`, `lg: 1024px`, `xl: 1280px`.
- Mobile rules for `.card-base`, `.stat-num`, `.modal-card`, `.auth-card`, and `.empty-state-card` added.
- Min supported viewport width `360px` with zero horizontal overflow on root body.

### Story 5.2: Create Shared useMediaQuery & useIsMobile Hooks
As a developer,  
I want a lightweight, zero-dependency `useMediaQuery` and `useIsMobile` hook in both applications,  
So that components can reactively determine screen size without attaching multiple un-garbage-collected resize listeners.

**Acceptance Criteria**:
- Implemented in `apps/super-admin/src/hooks/useMediaQuery.ts` and `apps/tenant-admin/src/hooks/useMediaQuery.ts`.
- Subscribes via `window.matchMedia` change listeners with proper clean-up in `useEffect`.
- Exports `useIsMobile(breakpoint?: number)` returning a boolean.

### Story 5.3: Convert Super Admin Sidebar to Off-Canvas Drawer Shell
As a Super Admin on mobile or tablet,  
I want the navigation sidebar in `PlatformAdminDashboard.tsx` to collapse into an off-canvas drawer below 1024px,  
So that the dashboard content is fully visible and not pushed offscreen by a fixed 240px sidebar.

**Acceptance Criteria**:
- On viewports < 1024px, sidebar transforms into an off-canvas drawer (`280px` width) with backdrop overlay.
- Content wrapper resets `pl-60` to `pl-0` on mobile/tablet.
- Clicking backdrop or pressing Escape dismisses the drawer.
- Navigation item selection automatically closes the drawer.

### Story 5.4: Convert Tenant Admin Sidebar to Off-Canvas Drawer Shell
As a Tenant Admin on mobile or tablet,  
I want the navigation sidebar in `TenantAdminDashboard.tsx` to collapse into an off-canvas drawer below 1024px,  
So that mailbox and domain management tools occupy the full screen width.

**Acceptance Criteria**:
- Off-canvas drawer with backdrop overlay for `< 1024px`.
- Removes fixed `pl-60` margin offset when drawer is collapsed.
- Backdrop tap or route change closes drawer.
- Drawer open state locks body scroll.

### Story 5.5: Convert Tenant Home Sidebar to Off-Canvas Drawer Shell
As a Tenant User on mobile or tablet,  
I want the navigation sidebar in `TenantHomeView.tsx` to collapse into an off-canvas drawer,  
So that domain cards and organizational overviews scale cleanly.

**Acceptance Criteria**:
- Off-canvas drawer with backdrop overlay for `< 1024px`.
- Content padding adjusts seamlessly.
- Touch gesture or backdrop tap dismisses drawer.

### Story 5.6: Implement Responsive Topbar & Mobile Hamburger Menu in Super Admin
As a Super Admin on mobile,  
I want a top navigation bar with a hamburger button and responsive icon layout in `apps/super-admin/src/components/Navbar.tsx`,  
So that all actions (2FA, Devices, Webmail, Logout) are accessible without horizontal overflow.

**Acceptance Criteria**:
- Topbar includes a `44x44px` hamburger toggle button visible on viewports `< 1024px`.
- Utility buttons collapse into a responsive overflow dropdown menu on viewports `< 768px`.
- Status indicators and branding scale down appropriately on small screens.

### Story 5.7: Implement Responsive Topbar & Actions in Tenant Admin
As a Tenant Admin on mobile,  
I want the header in `apps/tenant-admin/src/components/Navbar.tsx` to handle small viewports gracefully,  
So that user profile details and session controls do not wrap awkwardly.

**Acceptance Criteria**:
- Topbar includes hamburger button below 1024px.
- Webmail link and user email collapse into an action menu below 640px.
- Zero horizontal overflow.

### Story 5.8: Eliminate Fixed Desktop Zoom on Mobile Viewports
As a mobile user,  
I want the legacy desktop zoom (`zoom: 1.12`) disabled on mobile viewports in both portals,  
So that elements are not artificially magnified and overflowing screen borders.

**Acceptance Criteria**:
- Media queries in both `index.css` reset `.page-content-scaled { zoom: 1; }` below 1024px.
- Root `<meta name="viewport">` verified in both `index.html` files.

---

## Epic 6: Auth, Onboarding & Recovery Pages Mobile Optimization

Make all authentication, onboarding, activation, and recovery flows fully responsive and comfortable to use on smartphone screens.

### Story 6.1: Responsive Super Admin Login View
As a Super Admin logging in from a phone,  
I want `SuperAdminLoginView.tsx` to fit within 360px+ screens without edge clipping or horizontal scrolling,  
So that I can log in securely on the go.

**Acceptance Criteria**:
- Auth card uses `w-full max-w-md mx-auto` with `px-4 sm:px-6` responsive padding.
- Inputs have `font-size: 16px` on mobile to prevent iOS Safari auto-zoom.
- Error alerts and 2FA input screens adapt to mobile width.

### Story 6.2: Responsive Tenant Admin Login View
As a Tenant Admin logging in from mobile,  
I want `TenantAdminLoginView.tsx` to adapt cleanly to small screens,  
So that I can access my tenant portal from any device.

**Acceptance Criteria**:
- Auth card centers with fluid width on mobile.
- Form inputs have minimum 44px tap heights.
- Password reveal and submit buttons remain fully accessible.

### Story 6.3: Responsive Tenant Registration Wizard
As a prospective tenant registering on a mobile device,  
I want `RegisterView.tsx` multi-step form to guide me through registration without cramped form elements,  
So that onboarding on mobile is smooth and error-free.

**Acceptance Criteria**:
- Wizard step progress indicators wrap or display numbered counter on mobile.
- Form grid collapses from 2 columns to 1 column below 768px.
- Step action buttons (Back / Next) span full width or comfortable touch targets.

### Story 6.4: Responsive Tenant Activation Wizard
As a newly registered tenant activating my account on mobile,  
I want `ActivateTenantView.tsx` to scale down graphic elements and format steps cleanly,  
So that I can verify credentials and set up my domain from a mobile phone.

**Acceptance Criteria**:
- `WizardStepGraphic.tsx` scales down or hides on viewports < 768px.
- Step panels stack vertically with `px-4` padding.
- Verification code input boxes size dynamically to fit phone screens without overflowing.

### Story 6.5: Responsive Forgot Password & Recovery Flows
As a user resetting my password on mobile,  
I want `ForgotPasswordView.tsx` in both portals to format cleanly on small screens,  
So that I can complete OTP verification and password reset without usability friction.

**Acceptance Criteria**:
- Step cards fit fluidly within mobile screen margins.
- Backup code input and verification tokens format without clipping.
- Reset confirmation buttons are full-width and touch-friendly.

---

## Epic 7: Data Tables to Mobile Cards Transformation

Transform all administrative data tables into responsive cards on mobile viewports (<768px) while preserving full sorting, filtering, and row actions.

### Story 7.1: Tenants Management Mobile Card Transformation
As a Super Admin on mobile,  
I want `TenantsManagementView.tsx` to render tenant rows as cards on `< 768px`,  
So that I can view tenant status, mailbox counts, and trigger actions without horizontal scrolling.

**Acceptance Criteria**:
- Renders `.data-card` items showing tenant name, domain, status badge, mailbox quota, and plan.
- Action dropdown or buttons are touch-friendly (`min-h-[44px]`).
- Desktop continues to render full data table on `≥ 768px`.

### Story 7.2: Audit Log Responsive Table View
As a Super Admin on mobile,  
I want `AuditLogView.tsx` to provide a card or sticky-column table view,  
So that I can review security events and actor details legibly on phone screens.

**Acceptance Criteria**:
- On `< 768px`, converts log rows into cards showing Action, Actor, Timestamp, and expandable JSON details.
- Filter and search inputs stack vertically on mobile.

### Story 7.3: Active Devices Mobile Card Views
As an administrator on mobile,  
I want `ActiveDevicesView.tsx` in both portals to display session items as stacked cards,  
So that I can inspect IP addresses, last active times, and revoke sessions easily.

**Acceptance Criteria**:
- Session rows become cards below 768px.
- "Revoke Session" button has minimum 44x44px touch target.
- "Current Device" badge clearly visible.

### Story 7.4: Coupons & Plans Management Mobile Card Adaptation
As a Super Admin on mobile,  
I want `CouponsManagementView.tsx` and `PlansManagementView.tsx` to display items as cards,  
So that I can manage discount codes and subscription tiers from a mobile phone.

**Acceptance Criteria**:
- Coupon list renders as cards below 768px with Code, Discount, Usage, and Expiry.
- Plan cards stack into a single column on `< 768px`.
- Add/Edit buttons are easily tappable.

### Story 7.5: Deleted Organisations Mobile Cards View
As a Super Admin on mobile,  
I want `DeletedOrganisationsView.tsx` to format deletion logs as cards,  
So that I can view purge dates and restore/purge options on small screens.

**Acceptance Criteria**:
- Deleted org items display as cards with key deletion metadata.
- Confirmation actions format safely with distinct dangerous-action styling.

### Story 7.6: Tenant Detail Sub-Tables & Tabs Mobile Adaptation
As a Super Admin viewing a tenant on mobile,  
I want `TenantDetailView.tsx` sub-tabs (Domains, Mailboxes, Admins, Audit) and sub-tables to adapt to mobile cards,  
So that I can manage a specific tenant's configuration on the go.

**Acceptance Criteria**:
- Sub-tabs wrap or scroll horizontally with visual indicator.
- Sub-tables (mailboxes, admins, audit) convert to card layouts on `< 768px`.
- Action buttons stack vertically on mobile.

### Story 7.7: Blocked & Allowed IPs Responsive Cards
As a Tenant Admin on mobile,  
I want `BlockedIpsView.tsx` and `AllowedIpsView.tsx` to format IP entries as cards,  
So that I can inspect and add/remove security rules from my phone.

**Acceptance Criteria**:
- IP addresses render prominently at the top of each card.
- Reason, added date, and remove buttons stack cleanly.
- "Add IP" form inputs stack into a single column below 640px.

### Story 7.8: Moderators & API Keys Responsive Cards
As a Tenant Admin on mobile,  
I want `ModeratorsView.tsx` and `ApiKeysView.tsx` to display entries as cards,  
So that I can manage team permissions and API tokens from any device.

**Acceptance Criteria**:
- Moderator card shows Name, Email, Role badge, and revoke button.
- API Key card shows Name, masked token, created date, and copy/delete actions.

### Story 7.9: Billing Invoices Table Mobile Adaptation
As a Tenant Admin on mobile,  
I want the invoice history table in `BillingView.tsx` to render as cards,  
So that I can check past payments, download PDF receipts, and view payment status on my phone.

**Acceptance Criteria**:
- Invoices display as cards showing Date, Amount, Status badge, and Receipt link.
- Card actions are easily tappable.

---

## Epic 8: Modals, Dialogs & Wizards Mobile Responsiveness

Ensure all dialogs, setup wizards, and confirmation sheets fit within mobile viewports with sticky headers/footers and smooth scrolling bodies.

### Story 8.1: Core Modal Mobile Constraints in index.css
As a frontend engineer,  
I want `.modal-card`, `.modal-backdrop`, and `.modal-footer` CSS classes to implement mobile viewport boundaries,  
So that no modal ever clips or overflows the mobile screen.

**Acceptance Criteria**:
- `.modal-card` max-height constrained to `calc(100dvh - 32px)` on `< 768px`.
- Modal body gains `overflow-y: auto; -webkit-overflow-scrolling: touch;`.
- `.modal-footer` stacks buttons vertically (`flex-col-reverse`) with full width on mobile.

### Story 8.2: Super Admin Management Modals Mobile Responsiveness
As a Super Admin on mobile,  
I want all 8 Super Admin modals to scale cleanly to mobile viewports,  
So that I can create tenants, edit quotas, and manage admins from a phone.

**Acceptance Criteria**:
- Applies to `CreateTenantModal`, `UpdateQuotaModal`, `ManageAdminsModal`, `PlanFormModal`, `CreateCouponModal`, `TenantActivationModal`, `TenantDetailModal`, `ActiveSessionsModal`.
- Forms stack into a single column; buttons are full-width and touch-friendly.

### Story 8.3: Tenant Admin Management Modals Mobile Responsiveness
As a Tenant Admin on mobile,  
I want all Tenant Admin modals to adapt to mobile screens,  
So that creating mailboxes, managing aliases, and updating payment methods work flawlessly on phones.

**Acceptance Criteria**:
- Applies to `ManageAliasesModal`, `PaymentMethodModal`, `DomainDnsStatusModal`, `DomainDeletionModal`, `ActiveSessionsModal`.
- No clipped inputs; scrollable body handles virtual keyboard appearances.

### Story 8.4: Domain Setup Wizard Multi-Step Mobile Overhaul
As a Tenant Admin setting up a custom domain on mobile,  
I want `DomainSetupModal.tsx` to format steps, DNS records, and verification instructions for mobile screens,  
So that I can complete domain onboarding from my smartphone.

**Acceptance Criteria**:
- Wizard expands to near-fullscreen (`calc(100dvh - 16px)`) on mobile.
- Step tabs scroll horizontally.
- DNS record tables feature horizontal scrolling with sticky record-type column and one-tap copy buttons.

### Story 8.5: 2FA Setup Modal Responsiveness & Form Factor Adaptation
As an administrator enabling two-factor authentication on mobile,  
I want the 2FA setup modal in `Navbar.tsx` and `TenantAdminDashboard.tsx` to display QR code and backup codes legibly,  
So that I can scan or copy setup keys without layout breakage.

**Acceptance Criteria**:
- Replaces rigid inline pixel styles (`style={{ width: '480px' }}`) with responsive CSS classes.
- QR code image scales dynamically to fit screen width (`max-w-[200px] mx-auto`).
- Backup codes render in a clean 2-column or 1-column responsive grid with one-tap copy button.

---

## Epic 9: Dashboard Overview, Metrics & Card Grids

Optimize high-level dashboards, analytics panels, and storage visualizations for mobile and tablet devices.

### Story 9.1: Super Admin Dashboard Overview Responsive Grid
As a Super Admin on mobile,  
I want `DashboardOverviewView.tsx` stat cards and activity panels to stack into a single column,  
So that key metrics (Tenants, Domains, Mailboxes, MRR) are immediately visible without horizontal scrolling.

**Acceptance Criteria**:
- Metric cards switch from `grid-cols-3` to `grid-cols-1` below 640px, `grid-cols-2` on tablet.
- Quick actions stack vertically.
- Recent tenant activity list formats cleanly as a mobile card list.

### Story 9.2: Tenant Home Overview Cards Responsive Grid
As a Tenant User on mobile,  
I want `TenantHomeView.tsx` domain cards and storage summaries to format as a single-column stack,  
So that I can inspect my domain status and mailbox usage from my phone.

**Acceptance Criteria**:
- Domain overview cards stack into 1 column on `< 768px`.
- Progress bars and quota indicators scale fluidly.

### Story 9.3: Analytics View Responsive Metric Cards & Chart Containers
As an administrator on mobile,  
I want `AnalyticsView.tsx` charts and metric grids to scale down responsively,  
So that delivery volume and error rates can be monitored from any screen.

**Acceptance Criteria**:
- Stat cards stack single column on mobile.
- Chart containers enforce `min-height: 240px` with responsive width (`100%`).
- Time range filter buttons wrap cleanly on mobile viewports.

### Story 9.4: Storage Usage Panels Mobile Adaptation
As a Tenant Admin on mobile,  
I want `StorageView.tsx` mailbox storage breakdown to render cleanly,  
So that I can identify mailboxes nearing quota limits from a phone.

**Acceptance Criteria**:
- Storage progress bars and percentage text display without clipping.
- Top consumers list transforms from table to mobile cards.

---

## Epic 10: Complex Feature Views

Refactor large, multi-section configuration views to provide intuitive mobile navigation and single-column stacked forms.

### Story 10.1: Security Settings View Mobile Responsive Overhaul
As a Tenant Admin on mobile,  
I want `SecuritySettingsView.tsx` (Account & Domain security tabs, password policies, IP allowlists) to adapt to small screens,  
So that I can configure organization security policies on mobile.

**Acceptance Criteria**:
- Account / Domain sub-tabs display as a full-width segment control.
- Setting rows stack toggle switches below descriptive labels on `< 640px`.
- IP allowlist input and list items format as mobile cards.

### Story 10.2: System Operations Diagnostic Panels Mobile View
As a Super Admin on mobile,  
I want `SystemOperationsView.tsx` diagnostic cards, health checks, and reconciliation tools to stack into a single column,  
So that system operational status is clear and controllable from mobile.

**Acceptance Criteria**:
- Service health badges stack cleanly.
- Stalwart drift audit and auto-repair card adapt to mobile width.
- SMTP relay diagnostic card displays latency and test results legibly.

### Story 10.3: DNS Status Panel & Credentials Form Mobile Adaptation
As a Tenant Admin on mobile,  
I want `DnsStatusPanel.tsx` and `DnsProviderCredentialForm.tsx` to format cleanly on phones,  
So that I can check DNS propagation and enter API credentials from a mobile browser.

**Acceptance Criteria**:
- DNS record status cards stack single column.
- Provider credential form fields expand to full width with clear labels.

---

## Epic 11: Cart, Checkout & Payment Flows

Ensure customer purchasing, plan upgrades, and payment method updates work seamlessly on smartphone screens.

### Story 11.1: Cart Page Mobile Responsive Overhaul
As a customer purchasing mailboxes on a phone,  
I want `CartPage.tsx` item list and order summary to stack vertically,  
So that checkout is clear, fast, and painless on mobile.

**Acceptance Criteria**:
- Cart items stack above the order summary on `< 1024px`.
- Coupon code input and apply button remain side-by-side or stack cleanly without overflow.
- Checkout button spans full width and remains easily tappable.

### Story 11.2: Payment Method Selector Mobile Cards
As a customer choosing a payment method on mobile,  
I want `PaymentMethodSelector.tsx` cards to render in a single-column touch-friendly list,  
So that selecting Credit Card, UPI, or Net Banking is effortless on a touchscreen.

**Acceptance Criteria**:
- Payment options stack vertically with distinct radio/checkbox indicators.
- Payment method cards have minimum 48px height with generous padding.

### Story 11.3: Domain Switcher Touch-Friendly Adaptation
As a Tenant Admin on mobile,  
I want `DomainSwitcher.tsx` to present a touch-friendly dropdown or bottom sheet,  
So that I can switch between tenant domains quickly with one hand.

**Acceptance Criteria**:
- Trigger button is minimum 44x44px.
- Dropdown menu positions within viewport boundaries without overflowing right or bottom.
- Active domain marked with clear checkmark indicator.

---

## Epic 12: Touch Ergonomics, Gestures & Accessibility Polish

Final quality engineering pass ensuring all interactive elements satisfy touch target minimums, gesture smoothness, and accessibility standards.

### Story 12.1: 44x44px Touch Target Standard & iOS Input Zoom Prevention
As a mobile user,  
I want all clickable icons, buttons, and inputs to meet the 44x44px minimum touch target standard and inputs to not trigger iOS auto-zoom,  
So that tapping is accurate and the screen does not unexpectedly zoom in while typing.

**Acceptance Criteria**:
- All interactive elements audited and padded to `≥ 44x44px` on touch screens.
- Form controls specify `font-size: 16px` on viewports `< 768px`.

### Story 12.2: Focus Management & Inert Body Scroll for Mobile Drawers
As an accessibility-focused user,  
I want drawer and modal overlays to lock background scrolling and trap keyboard/screen reader focus,  
So that navigating with assistive technologies or touch gestures does not cause background content to scroll.

**Acceptance Criteria**:
- Opening drawer or modal sets `overflow: hidden` on `document.body`.
- Focus is trapped within the active dialog or drawer.
- Pressing Escape returns focus to the triggering element.

### Story 12.3: Safe Area Insets & Viewport Height (dvh) Normalization
As an iPhone or Android mobile user,  
I want the UI to respect device notches, home bars, and dynamic URL bars (`100dvh`),  
So that buttons and content are never obscured by browser chrome or device hardware.

**Acceptance Criteria**:
- CSS uses `100dvh` (with `100vh` fallback) for full-height modals and shells.
- Bottom padding accommodates `env(safe-area-inset-bottom)` on mobile devices.


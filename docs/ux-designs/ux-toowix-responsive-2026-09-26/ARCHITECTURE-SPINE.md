---
name: Toowix Mail Platform — Responsive & Mobile Architecture Spine
status: final
updated: 2026-09-26
sources:
  - docs/ux-designs/ux-toowix-responsive-2026-09-26/DESIGN.md
  - docs/ux-designs/ux-toowix-responsive-2026-09-26/EXPERIENCE.md
  - docs/ARCHITECTURE.md
  - DESIGN.md
---

# Toowix Mail Platform — Responsive & Mobile Architecture Spine

> **Scope**: Universal mobile & responsive architecture across Super Admin (`apps/super-admin`) and Tenant Admin (`apps/tenant-admin`).
> **Goal**: Establish the non-negotiable structural invariants, shared primitives, and component boundary rules so both portals function natively on smartphones (360px+), tablets (768px+), and desktop screens (1024px+) without diverging.

---

## 🏛️ Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Viewport Surface                                │
│       Mobile (<768px)       │     Tablet (768px-1023px)     │   Desktop (≥1024px)   │
└──────────────┬──────────────┴───────────────┬───────────────┴───────────────┬─┘
               │                              │                               │
               ▼                              ▼                               ▼
┌──────────────────────────────┐┌──────────────────────────────┐┌──────────────────────────────┐
│  Mobile App Shell            ││  Tablet Adaptive Shell       ││  Desktop Permanent Shell     │
│  • Hamburger Navbar          ││  • Collapsible Drawer        ││  • Fixed Sidebar (240px)     │
│  • Off-canvas Drawer (280px) ││  • Compact Topnav            ││  • Sticky Header             │
│  • Full-width Main (pl-0)    ││  • Hybrid Card/Table layout  ││  • Multi-column Viewport     │
│  • Overlay Backdrop          ││  • Max Content Width 1280px  ││  • Desktop Scale (Zoom 1.0)  │
└──────────────┬───────────────┘└──────────────┬───────────────┘└──────────────┬───────────────┘
               │                              │                               │
               └──────────────────────┬───────┴───────────────────────────────┘
                                      ▼
               ┌──────────────────────────────────────────────┐
               │         Shared Responsive Primitives          │
               │  • useMediaQuery / useMobileDetect Hooks     │
               │  • ResponsiveTable / DataCard Adapters       │
               │  • ModalDialog (calc(100dvh - 32px))         │
               │  • BottomSheet / Popover Viewport Handlers   │
               │  • Mobile Gutter & Spacing Tokens            │
               └──────────────────────┬───────────────────────┘
                                      ▼
               ┌──────────────────────────────────────────────┐
               │          Styling Foundation (Dual Layer)     │
               │  • index.css (Core Tokens & CSS Variables)   │
               │  • Tailwind CSS Breakpoints (sm, md, lg, xl) │
               └──────────────────────────────────────────────┘
```

---

## 📐 Architectural Decisions (ADs)

### AD-1: Standardized Breakpoint & Viewport Scaling Invariant
- **Status**: `[ADOPTED]`
- **Binds**: CSS Design tokens in `index.css` and Tailwind classes in `apps/super-admin` and `apps/tenant-admin`.
- **Prevents**: Arbitrary media query thresholds, fragmented tablet behaviors, and horizontal overflow on mobile viewports.
- **Rule**:
  1. Breakpoint tiers are strictly defined as:
     - `sm`: `640px` (large phones in landscape, phablets)
     - `md`: `768px` (tablets portrait, primary mobile-to-desktop inflection point)
     - `lg`: `1024px` (tablets landscape, laptops, sidebar collapse cutoff)
     - `xl`: `1280px` (high-density desktop displays)
  2. Legacy desktop zoom (`zoom: 1.12` or `page-content-scaled`) is unconditionally disabled (`zoom: 1.0`) on all viewports `< 1024px`.
  3. Minimum supported mobile viewport width is `360px` (covers iPhone SE, Samsung Galaxy A/S series).
  4. Root HTML must enforce `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover">`.

### AD-2: Shell Navigation & Off-Canvas Drawer Invariant
- **Status**: `[ADOPTED]`
- **Binds**: `PlatformAdminDashboard.tsx`, `TenantAdminDashboard.tsx`, `TenantHomeView.tsx`.
- **Prevents**: Sidebar obscuring content on mobile or content overflowing with rigid `pl-60` margin offsets.
- **Rule**:
  1. On viewports `< 1024px`:
     - The permanent desktop sidebar (`fixed left-0 w-60 z-30`) transforms into an off-canvas drawer (`fixed top-0 bottom-0 left-0 w-[280px] z-50 transform -translate-x-full transition-transform duration-200 ease-in-out`).
     - Content wrapper offset resets from `pl-60` to `pl-0` across all shells.
     - Top navigation bar renders a persistent `44x44px` hamburger toggle button on the left edge.
  2. When the mobile drawer is open:
     - A backdrop overlay (`fixed inset-0 bg-black/50 backdrop-blur-xs z-40 transition-opacity`) must render.
     - Tapping the backdrop or pressing the `Escape` key closes the drawer immediately.
     - Document body scrolling is locked via `document.body.style.overflow = 'hidden'`.
     - Route navigation or tab switching automatically closes the drawer.

### AD-3: Data Table Transformation & Mobile Density Strategy
- **Status**: `[ADOPTED]`
- **Binds**: All administrative lists (`TenantsManagementView`, `AuditLogView`, `ActiveDevicesView`, `CouponsManagementView`, `DeletedOrganisationsView`, `BillingView`, `BlockedIpsView`, `AllowedIpsView`, `ModeratorsView`, `ApiKeysView`, `TenantDetailView`).
- **Prevents**: Truncated unreadable tables, broken layouts, or jarring horizontal table scrolling without context.
- **Rule**:
  1. **Low-to-Medium Complexity Tables (≤ 4 columns)**:
     - On `< 768px`, table markup transforms into stacked mobile cards (`.data-card`).
     - Card hierarchy:
       - Header: Primary identifier (bold) + Status Badge (top right).
       - Body: 2-column key-value grid for metadata (e.g. Email, Created Date, Plan).
       - Footer: Primary row action buttons expanded to full-width or distinct touchable buttons.
  2. **High-Density Technical Tables (≥ 5 columns or technical listings)**:
     - Retains table representation wrapped in `.data-table-container` with `overflow-x: auto; -webkit-overflow-scrolling: touch;`.
     - First column (e.g., Domain Name, IP Address, Timestamp) remains sticky (`position: sticky; left: 0; background: var(--color-surface); z-index: 10;`).
     - Right edge includes a subtle visual gradient shadow indicating horizontal scrollability.

### AD-4: Modal & Dialog Responsiveness Contract
- **Status**: `[ADOPTED]`
- **Binds**: All modals across `apps/super-admin/src/components/modals/` and `apps/tenant-admin/src/components/modals/`.
- **Prevents**: Modals clipping off the top/bottom of small screens, offscreen action buttons, and inability to dismiss dialogs.
- **Rule**:
  1. Below `768px`, modal container (`.modal-card`) must obey:
     - Width: `calc(100vw - 16px)` with `margin: 8px auto`.
     - Max Height: `calc(100dvh - 32px)` (or `100svh` on supporting browsers).
  2. Structural partitioning:
     - Header: Sticky top with title and prominent `44x44px` close button (`x`).
     - Content body: `overflow-y: auto; flex: 1 1 auto; padding: 16px;`.
     - Footer: Sticky bottom with action buttons stacked vertically (`flex-col-reverse` with primary action first, cancel below, `w-full`).
  3. Multi-step setup wizards (`DomainSetupModal`, `ActivateTenantView`) utilize near-fullscreen viewports (`calc(100dvh - 16px)`) with horizontal scrolling step indicator tabs.

### AD-5: Touch Ergonomics & Form Usability Minimums
- **Status**: `[ADOPTED]`
- **Binds**: All form controls, buttons, icons, and interactive elements.
- **Prevents**: Accidental mis-clicks, frustration on mobile devices, and iOS Safari input auto-zooming.
- **Rule**:
  1. Every interactive element must present a minimum touch target bounding box of `44x44px`.
  2. All text inputs (`<input>`, `<select>`, `<textarea>`) must specify `font-size: 16px;` (or Tailwind `text-base`) on mobile to prevent iOS Safari from automatically zooming into the page on focus.
  3. Action menus on table/card rows must open viewport-aware dropdowns that clamp within viewport boundaries (`left: auto; right: 0;`).

### AD-6: Viewport State Management & Shared React Hooks
- **Status**: `[ADOPTED]`
- **Binds**: State hooks in both frontend applications.
- **Prevents**: Multiple conflicting resize event listeners, performance degradation, and layout thrashing.
- **Rule**:
  1. Viewport detection must use a unified hook `useMediaQuery(query: string): boolean` wrapping `window.matchMedia`.
  2. Pre-canned helper hook `useIsMobile(breakpoint = 768): boolean` provides boolean status.
  3. Hooks must clean up listeners in `useEffect` return functions (`mql.removeEventListener('change', handler)`).

---

## 🧩 Shared Component Architecture

### 1. `useMediaQuery` / `useIsMobile` Hook
Both applications implement a zero-dependency media query listener:
```typescript
// Shared Hook: useMediaQuery.ts
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQueryList = window.matchMedia(query);
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    
    setMatches(mediaQueryList.matches);
    mediaQueryList.addEventListener('change', listener);
    return () => mediaQueryList.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

export function useIsMobile(cutoff = 768): boolean {
  return useMediaQuery(`(max-width: ${cutoff - 1}px)`);
}
```

### 2. Off-Canvas Drawer Layout Pattern
```tsx
// Shell Pattern: Mobile Drawer + Main Content
<div className="min-h-screen bg-slate-50 flex">
  {/* Backdrop */}
  {isDrawerOpen && (
    <div 
      className="fixed inset-0 bg-black/50 z-40 lg:hidden transition-opacity"
      onClick={() => setIsDrawerOpen(false)}
      aria-hidden="true"
    />
  )}

  {/* Sidebar (Desktop fixed, Mobile off-canvas) */}
  <aside 
    className={`fixed top-0 bottom-0 left-0 w-60 bg-white border-r border-slate-200 z-50 transform transition-transform duration-200 ease-in-out lg:translate-x-0 ${
      isDrawerOpen ? 'translate-x-0' : '-translate-x-full'
    }`}
  >
    {/* Sidebar content */}
  </aside>

  {/* Main Content Area */}
  <div className="flex-1 flex flex-col min-w-0 lg:pl-60">
    <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-6">
      <button
        type="button"
        className="lg:hidden p-2 -ml-2 rounded-md text-slate-600 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        onClick={() => setIsDrawerOpen(true)}
        aria-label="Open sidebar"
      >
        <MenuIcon className="h-6 w-6" />
      </button>
      {/* Header controls & user profile */}
    </header>
    
    <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
      {children}
    </main>
  </div>
</div>
```

### 3. Responsive Table-to-Card Pattern
```tsx
// Pattern: Table on Desktop, Cards on Mobile
<div className="space-y-4">
  {/* Mobile View: Cards (<md) */}
  <div className="block md:hidden space-y-3">
    {items.map(item => (
      <div key={item.id} className="card-base p-4 space-y-3 border border-slate-200">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-900">{item.name}</span>
          <StatusBadge status={item.status} />
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
          <div><span className="text-slate-400">Created:</span> {item.createdAt}</div>
          <div><span className="text-slate-400">Mailboxes:</span> {item.mailboxCount}</div>
        </div>
        <div className="pt-2 border-t border-slate-100 flex gap-2">
          <button className="btn-secondary flex-1 py-2 text-sm">Edit</button>
          <button className="btn-primary flex-1 py-2 text-sm">Manage</button>
        </div>
      </div>
    ))}
  </div>

  {/* Desktop View: Full Table (>=md) */}
  <div className="hidden md:block data-table-container">
    <table className="data-table">
      {/* standard table rows */}
    </table>
  </div>
</div>
```

---

## 🛡️ Non-Functional Requirements (NFRs)

1. **Performance**: Zero layout thrashing or render flashes on viewport resize. Media query matches should not trigger unneeded API refetches.
2. **Accessibility (WCAG 2.1 AA)**:
   - Off-canvas drawer must trap focus when open on mobile.
   - Screen readers must announce open/closed drawer state via `aria-expanded`.
   - Contrast ratio for text on all responsive states must exceed `4.5:1`.
3. **Cross-Browser & Device Verification**:
   - iOS Safari (16+), Chrome for Android (120+), Mobile Firefox.
   - Dynamic viewport height (`dvh`) or fallback `calc(100vh - env(safe-area-inset-bottom))` for iPhone notch/home bar accommodation.

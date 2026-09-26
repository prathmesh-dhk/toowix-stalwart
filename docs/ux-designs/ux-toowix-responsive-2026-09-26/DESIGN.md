---
name: Toowix Enterprise Design System
status: final
updated: 2026-09-26
colors:
  primary: '#4f46e5'
  primary-hover: '#4338ca'
  primary-active: '#3730a3'
  primary-tint: '#eef2ff'
  background: '#f8fafc'
  surface: '#ffffff'
  surface-dim: '#f1f5f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f8fafc'
  surface-container: '#f1f5f9'
  surface-container-high: '#e2e8f0'
  surface-container-highest: '#cbd5e1'
  border: '#e2e8f0'
  border-strong: '#cbd5e1'
  outline: '#cbd5e1'
  outline-variant: '#e2e8f0'
  text-primary: '#0f172a'
  text-secondary: '#475569'
  text-muted: '#64748b'
  text-placeholder: '#94a3b8'
  on-primary: '#ffffff'
  on-surface: '#0f172a'
  on-surface-variant: '#475569'
  on-background: '#0f172a'
  success: '#10b981'
  success-bg: '#ecfdf5'
  success-border: '#a7f3d0'
  success-text: '#047857'
  warning: '#f59e0b'
  warning-bg: '#fffbeb'
  warning-border: '#fde68a'
  warning-text: '#b45309'
  error: '#ef4444'
  error-bg: '#fef2f2'
  error-border: '#fecaca'
  error-text: '#b91c1c'
  info: '#4f46e5'
  info-bg: '#eef2ff'
  info-border: '#c7d2fe'
  info-text: '#4338ca'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  title-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.04em
  label-sm:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.05em
  code-md:
    fontFamily: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 4px
  DEFAULT: 8px
  md: 8px
  lg: 12px
  xl: 16px
  full: 9999px
spacing:
  space-2xs: 2px
  space-xs: 4px
  space-sm: 8px
  space-md: 12px
  space-base: 16px
  space-lg: 24px
  space-xl: 32px
  space-2xl: 48px
  sidebar-width: 240px
  sidebar-width-collapsed: 0px
  topnav-height: 64px
  topnav-height-mobile: 56px
  max-content-width: 1280px
  mobile-gutter: 16px
  tablet-gutter: 24px
  desktop-gutter: 32px
components:
  breakpoints:
    sm: 640px
    md: 768px
    lg: 1024px
    xl: 1280px
  sidebar:
    trigger: hamburger-icon
    mobile-behavior: off-canvas-drawer
    tablet-behavior: off-canvas-drawer
    desktop-behavior: fixed-rail
    drawer-width: 280px
    drawer-overlay: 'rgba(15, 23, 42, 0.45)'
    transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
  mobile-card:
    padding: 12px 16px
    gap: 8px
    border-radius: 12px
---

# Toowix Enterprise Design System

## 1. Brand & Aesthetic Movement

The Toowix Enterprise Design System is an authoritative, high-density, mission-critical operational interface crafted for enterprise email routing, domain provisioning, and administrative identity management.

### Design Movement: Crisp Industrial SaaS
- **Visual Character**: Utilitarian, sharp, calm, hyper-organized, and trustworthy.
- **Tone**: Strictly operational. Zero consumer marketing fluff, zero conversational filler. Labels describe concrete actions: "Provision Mailbox", "Deploy DNS Record", "Verify State Drift", "Update Quota".
- **Density**: Medium-high density on desktop, medium density on tablet, comfortable density on mobile — optimized for the form factor's touch target constraints.
- **Color Philosophy**: Disciplined monochromatic Slate foundations with a focused Indigo-600 (`#4F46E5`) operational accent. Semantic green, amber, and red indicators are reserved strictly for system health, verification statuses, and quota limits.

---

## 2. Color Palette & Semantic Tokens

### Primary Brand Colors
- **Primary Base**: `#4F46E5` (`indigo-600`) — Primary call-to-action buttons, active navigation rail accents, key selection outlines.
- **Primary Hover**: `#4338CA` (`indigo-700`) — Hover and focus states for primary interactive elements.
- **Primary Active**: `#3730A3` (`indigo-800`) — Pressed button and active trigger states.
- **Primary Surface Tint**: `#EEF2FF` (`indigo-50`) — Active navigation backgrounds, selected item row highlights, informational badges.

### Neutrals & Slate Scale
- **Global Canvas Background**: `#F8FAFC` (`slate-50`) — Backdrop for all administrative consoles, registration steps, and authentication cards.
- **Elevated Surface**: `#FFFFFF` — Cards, modals, sidebars, top headers, data tables, and input containers.
- **Subdued Background**: `#F1F5F9` (`slate-100`) — Table header rows, code tag containers, inactive pill chips.
- **Border Subtle**: `#E2E8F0` (`slate-200`) — Card borders, internal divider lines, data table row separators.
- **Border Interactive**: `#CBD5E1` (`slate-300`) — Unfocused text inputs, select elements, secondary buttons.
- **Text Primary**: `#0F172A` (`slate-900`) — Headings, active values, metric figures, table cell content.
- **Text Secondary**: `#475569` (`slate-600`) — Descriptive subtext, form labels, secondary action icons.
- **Text Muted / Caption**: `#64748B` (`slate-500`) — Timestamps, section headers, auxiliary metadata.
- **Text Placeholder**: `#94A3B8` (`slate-400`) — Form input placeholders, inactive tab indicators.

### Semantic Status Colors
- **Success (Operational / Verified / Active)**:
  - Text: `#047857` (`emerald-700`)
  - Background: `#ECFDF5` (`emerald-50`)
  - Border: `#A7F3D0` (`emerald-200`)
  - Dot Indicator: `#10B981` (`emerald-500`)
- **Warning (Pending Review / Allocation Limit / Degraded)**:
  - Text: `#B45309` (`amber-700`)
  - Background: `#FFFBEB` (`amber-50`)
  - Border: `#FDE68A` (`amber-200`)
  - Dot Indicator: `#F59E0B` (`amber-500`)
- **Danger (Suspended / Failed / Error / Expired)**:
  - Text: `#B91C1C` (`rose-700`)
  - Background: `#FEF2F2` (`rose-50`)
  - Border: `#FECACA` (`rose-200`)
  - Dot Indicator: `#EF4444` (`rose-500`)
- **Info (New / Processing)**:
  - Text: `#4338CA` (`indigo-700`)
  - Background: `#EEF2FF` (`indigo-50`)
  - Border: `#C7D2FE` (`indigo-200`)
  - Dot Indicator: `#4F46E5` (`indigo-600`)

---

## 3. Typography Hierarchy

The system pairs **Inter** for clean UI readability with clean system monospace for technical data.

### Hierarchy & Scales
- **Page Display Headline**: `Inter`, 24px–32px, Bold (700), Line Height: 1.25, Tracking: `-0.02em`. Used for primary dashboard and wizard view titles.
- **Card / Section Header**: `Inter`, 16px–20px, Semi-Bold (600), Line Height: 1.3, Tracking: `-0.01em`. Used for card headers and modal titles.
- **Sidebar Section Header**: `Inter`, 11px, Bold (700), Line Height: 16px, Tracking: `0.05em`, Uppercase, Color: `#64748B`.
- **Body Regular**: `Inter`, 13px–14px, Regular (400), Line Height: 1.45, Color: `#334155`.
- **Form Label**: `Inter`, 12px, Semi-Bold (600), Line Height: 16px, Tracking: `0.02em`, Color: `#334155`.
- **Technical & Monospace Identifiers**: System monospace (`ui-monospace`, `SFMono-Regular`, `Consolas`), 11px–13px, Medium (500), Line Height: 1.4. Used for raw payloads, DNS records, and cryptographic tokens.

### Responsive Typography Adjustments
- **Mobile (< 768px)**: Page Display Headline scales down to 20px–24px. Card headers scale to 14px–16px. Body remains 13px minimum for readability. `{typography.display-lg.fontSize}` → `24px` on mobile.
- **Stat numbers**: Desktop `28px` → Mobile `22px`. Letter-spacing remains `-0.02em`.
- No font size drops below 12px on any viewport.

---

## 4. Layout & Structural Shell

### Breakpoint System

| Token | Width | Description |
|---|---|---|
| `sm` | 640px | Large phones in landscape, small tablets |
| `md` | 768px | Tablets in portrait — sidebar transition point |
| `lg` | 1024px | Tablets in landscape, small laptops — sidebar becomes fixed |
| `xl` | 1280px | Desktop — maximum content width cap |

### Desktop Layout (≥ 1024px)
- **Canvas**: Viewport background `#F8FAFC`. Maximum content container width `1280px` (`max-w-7xl`), centered with `32px` gutter padding.
- **Sidebar Navigation Rail**:
  - Width: Fixed `240px`.
  - Background: `#FFFFFF` with `1px solid #E2E8F0` right border.
  - Header: 64px height featuring brand mark and subtitle.
  - Nav Items: 40px height, rounded-full, 14px font size.
  - Active Item: Indigo background `#EEF2FF`, indigo text `#4338CA`, font-medium (500).
  - Always visible. Content area offset by `pl-60` (`240px`).
- **Top Header Bar**:
  - Height: Fixed `64px`.
  - Left padding offset matching sidebar (`pl-60`), full-width backdrop blur with `#FFFFFF/90` fill.
  - Contains: role badge, 2FA status, email, devices button, webmail link, logout button.

### Tablet Layout (768px–1023px)
- **Canvas**: Same background. Gutter padding reduces to `24px`.
- **Sidebar**: Collapses off-screen. Activated via hamburger icon in the top header bar.
  - Off-canvas drawer slides from left, `280px` wide, over `{colors.overlay}` backdrop.
  - Transition: `transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)`.
  - Closes on: backdrop tap, nav item selection, Escape key.
- **Top Header Bar**:
  - Height: `56px`.
  - Hamburger menu icon replaces sidebar. No `pl-60` offset.
  - Non-essential items (Webmail link, email text) hidden; accessible via overflow menu (three-dot).
- **Content area**: Full-width with `24px` gutters. `zoom: 1` (desktop zoom: 1.12 disabled).

### Mobile Layout (< 768px)
- **Canvas**: Same background. Gutter padding reduces to `16px`.
- **Sidebar**: Same off-canvas drawer as tablet.
- **Top Header Bar**:
  - Height: `56px`.
  - Shows: hamburger icon, brand logo, role badge (compact), overflow menu icon.
  - Overflow menu contains: 2FA status, Devices, Webmail, Logout.
- **Content area**: Full-width with `16px` gutters. Single-column layout for all grid-based views.
- **Page content zoom**: Disabled (`zoom: 1`). The `page-content-scaled` class has no effect below `1024px`.

### Content Grid System

| Grid Context | Desktop (≥ lg) | Tablet (md–lg) | Mobile (< md) |
|---|---|---|---|
| Dashboard stat cards | 3 columns | 2 columns | 1 column |
| Tenant detail cards | 2–3 columns | 2 columns | 1 column |
| Settings sections | 2 columns (label + control) | 2 columns | 1 column (stacked) |
| Analytics charts | 2 columns | 1 column | 1 column |
| Plan cards | 3 columns | 2 columns | 1 column |

---

## 5. Components & UI Patterns

### Buttons
- **Primary Button (`.btn-primary`)**:
  - Height: 40px (standard), 32px (sm), 48px (lg).
  - Background: `#4F46E5` (`indigo-600`); Hover: `#4338CA`; Text: `#FFFFFF` (font-semibold, 14px).
  - Border radius: `8px`. Box shadow: `0 1px 2px 0 rgba(0, 0, 0, 0.05)`.
  - **Mobile**: Minimum touch target 44×44px. Full-width when sole CTA in a form or modal footer.
- **Secondary Button (`.btn-secondary`)**:
  - Height: 40px (standard).
  - Background: `#FFFFFF`; Hover: `#F8FAFC`; Text: `#334155`; Border: `1px solid #CBD5E1`.
- **Danger Button (`.btn-danger`)**:
  - Background: `#EF4444`; Hover: `#DC2626`; Text: `#FFFFFF`.
- **Icon Buttons**: Centered 14px–16px stroke icons with 1.5 spacing. **Mobile**: min 44×44px touch target with sufficient padding.
- **Button groups on mobile**: Stack vertically, full-width, `8px` gap. Primary action always on top.

### Form Inputs & Controls
- **Standard Input (`.form-input`) & Select (`.form-select`)**:
  - Height: 40px, rounded-lg (`8px`).
  - Border: `1px solid #CBD5E1`; Background: `#FFFFFF`; Text: `#0F172A` (13px).
  - Focus state: `border-color: #4F46E5; box-shadow: 0 0 0 1px #4F46E5; outline: none;`.
  - Placeholder: `#94A3B8`.
  - **Mobile**: Height remains 40px (minimum touch target). Font size 16px on mobile to prevent iOS zoom on focus.
- **Form Group**: Vertical stack with `6px` spacing between label and input, `16px`–`20px` between consecutive fields.
- **Two-column form rows**: Stack to single column below `md` breakpoint. Label above input, never beside.

### Status Badges (`.status-badge`)
- Shape: Fully rounded pill (`rounded-full`), height: 22px, padding: `2px 8px`.
- Typography: 11px font size, semi-bold (600).
- Structure: Includes a `6px` solid circular dot indicator positioned on the left side of the text label.
- No responsive changes — badges are inherently compact.

### Data Tables (`.data-table-container` & `.data-table`)
- Container: Border `1px solid #E2E8F0`, rounded `12px`, background `#FFFFFF`, overflow-x auto.
- Header (`<thead>`): Height: 38px. Background: `#F8FAFC`. Text: 11px uppercase, font-semibold (600), tracking `0.05em`, color `#475569`. Bottom border: `1px solid #E2E8F0`.
- Rows (`<tbody> tr`): Height: 48px. Hover: `#F8FAFC/80`. Bottom border: `1px solid #F1F5F9`. Cells: 13px, vertically centered.

#### Responsive Table Behavior
- **Desktop (≥ lg)**: Standard horizontal table. All columns visible.
- **Tablet (md–lg)**: Horizontal scroll with sticky first column for identity fields (name/email). Action column stays visible.
- **Mobile (< md)**: Two strategies based on column density:
  - **≤ 4 columns**: Convert to **card layout**. Each row becomes a stacked card: primary field as card title, secondary fields as label–value pairs, actions as bottom row of icon buttons.
  - **≥ 5 columns**: Keep horizontal scroll with sticky first column. Scroll indicator shadow on right edge.
- Card layout specs:
  - Container: `{colors.surface}`, `1px solid {colors.border}`, `{rounded.lg}`, padding `12px 16px`.
  - Title field: `{typography.title-md}`, color `{colors.text-primary}`.
  - Detail fields: `{typography.body-sm}`, color `{colors.text-muted}`, displayed as `label: value` pairs.
  - Action buttons: row of icon buttons at card bottom, `8px` gap.

### Stat Cards (`.stat-card`)
- Container: White surface `#FFFFFF`, border `1px solid #E2E8F0`, rounded-xl (`12px`), padding: `20px`.
- Top: Category title + icon chip.
- Center: Prominent numerical value (desktop 28px → mobile 22px).
- Bottom: Subtext, contextual progress bar, or status label.
- **Mobile**: Padding reduces to `16px`. Cards stack single-column with `12px` gap.

### Modals (`.modal-card`)
- Backdrop: `rgba(15, 23, 42, 0.4)` with light backdrop blur (`backdrop-blur-[2px]`).
- Card: White surface, border `1px solid #E2E8F0`, rounded-xl (`12px`), max-width `540px`.
- Header: Title (18px font-bold), close button.
- Body: Padded with `24px` spacing, scrollable if height exceeds viewport.
- Footer: `1px solid #E2E8F0` top border, right-aligned action buttons.

#### Responsive Modal Behavior
- **Desktop**: Centered, max-width per modal variant (384px–1280px), max-height `84vh`.
- **Tablet**: Same centering, max-width constrained by `calc(100vw - 48px)`.
- **Mobile (< md)**:
  - Max-width: `calc(100vw - 16px)`. Padding: `16px`.
  - Max-height: `calc(100dvh - 32px)`. Body scrolls independently.
  - Footer buttons stack vertically, full-width, primary on top.
  - `zoom: 1` always (override tenant-admin's `zoom: 1.12` on `.modal-card`).
  - Large modals (wizards like DomainSetupModal) become near-full-screen: `width: 100vw`, `height: 100dvh`, `border-radius: 0`, slide up from bottom.

### Sidebar Off-Canvas Drawer (Mobile/Tablet)
- Width: `280px`.
- Background: `{colors.surface}`.
- Border: none (covered by overlay shadow).
- Overlay: `{colors.overlay}` (`rgba(15, 23, 42, 0.45)`).
- Header: Brand mark + "TOOWIX MAIL" wordmark, `56px` height.
- Nav items: Same as desktop sidebar — `40px` height, rounded-full, full-width.
- Footer: Same compact telemetry readout.
- Transition: Slide from left, `0.25s`, `cubic-bezier(0.16, 1, 0.3, 1)`.
- Close triggers: backdrop tap, nav item tap, swipe-left, Escape key.
- Z-index: `50` (above content, below modals at `9999`).

### Technical Records & Code Blocks
- DNS and token records are rendered in monospace containers (`font-mono text-xs text-slate-700 bg-white border border-slate-200 rounded px-2.5 py-1.5`) paired with a one-click copy button.
- **Mobile**: Monospace containers use `overflow-x: auto` with `-webkit-overflow-scrolling: touch` for long DNS records. Font size stays at `12px` minimum. Copy button is always visible (not hidden behind hover).

---

## 6. Iconography Standards

- **Icon Set**: Lucide Icons (`lucide-react`) exclusively.
- **Stroke Width**: Consistent 1.5px to 2px stroke width.
- **Sizes**:
  - Navigation icons: 18px–20px.
  - Control / button icons: 14px–16px.
  - Status indicators: 12px–14px.
  - Feature header icons: 20px–24px.
  - **Mobile hamburger icon**: 24px, centered in 44×44px touch target.
- **Rule**: Never use filled Material Symbols or multicolored emojis in production enterprise views.

---

## 7. Elevation & Depth

- **Level 0 (Canvas)**: No shadow. `{colors.background}`.
- **Level 1 (Cards, Tables)**: `0 1px 2px rgba(0, 0, 0, 0.05)` (`{shadow-sm}`).
- **Level 2 (Dropdowns, Popovers)**: `0 4px 6px rgba(0, 0, 0, 0.07)` (`{shadow-md}`).
- **Level 3 (Modals, Drawers)**: `0 20px 25px rgba(0, 0, 0, 0.10)` (`{shadow-xl}`).
- Sidebar drawer uses Level 3 shadow on its right edge when open.

---

## 8. Do's and Don'ts

| Do | Don't |
|---|---|
| Use `{breakpoints}` tokens for responsive behavior consistently | Use ad-hoc pixel values for breakpoints |
| Stack forms and button groups vertically on mobile | Leave horizontal button rows that overflow the viewport |
| Convert dense tables to cards on mobile (≤ 4 cols) | Force a 7-column table into a 320px viewport |
| Use 44×44px minimum touch targets on mobile | Use 32px icon buttons without padding on touch devices |
| Disable `zoom: 1.12` scaling below `lg` breakpoint | Apply desktop zoom on mobile viewports |
| Use `100dvh` for full-height layouts on mobile | Use `100vh` which includes browser chrome on mobile Safari |
| Show copy buttons always on mobile (no hover-to-reveal) | Hide essential actions behind hover states on touch devices |
| Use the off-canvas drawer pattern for sidebar on mobile | Leave the fixed sidebar always visible below `lg` |

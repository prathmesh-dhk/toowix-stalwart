---
name: Toowix Enterprise Design System
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
    fontFamily: JetBrains Mono
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
  topnav-height: 64px
  max-content-width: 1280px
---

# Toowix Enterprise Design System

## 1. Brand & Aesthetic Movement

The Toowix Enterprise Design System is an authoritative, high-density, mission-critical operational interface crafted for enterprise email routing, domain provisioning, and administrative identity management.

### Design Movement: Crisp Industrial SaaS
- **Visual Character**: Utilitarian, sharp, calm, hyper-organized, and trustworthy.
- **Tone**: Strictly operational. Zero consumer marketing fluff, zero conversational filler. Labels describe concrete actions: "Provision Mailbox", "Deploy DNS Record", "Verify State Drift", "Update Quota".
- **Density**: Medium-high density optimized for administrative oversight and bulk record management.
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

The system pairs **Inter** for clean UI readability with **JetBrains Mono** for technical data.

### Hierarchy & Scales
- **Page Display Headline**: `Inter`, 24px–32px, Bold (700), Line Height: 1.25, Tracking: `-0.02em`. Used for primary dashboard and wizard view titles.
- **Card / Section Header**: `Inter`, 16px–20px, Semi-Bold (600), Line Height: 1.3, Tracking: `-0.01em`. Used for card headers and modal titles.
- **Sidebar Section Header**: `Inter`, 11px, Bold (700), Line Height: 16px, Tracking: `0.05em`, Uppercase, Color: `#64748B`.
- **Body Regular**: `Inter`, 13px–14px, Regular (400), Line Height: 1.45, Color: `#334155`.
- **Form Label**: `Inter`, 12px, Semi-Bold (600), Line Height: 16px, Tracking: `0.02em`, Color: `#334155`.
- **Technical & Monospace Identifiers**: `JetBrains Mono`, 11px–13px, Medium (500), Line Height: 1.4. Used for email addresses, domain names, DNS targets (DKIM, SPF, MX), SHA hashes, IPv4/IPv6 addresses, and system ports.

---

## 4. Layout & Structural Shell

### Layout Grid
- **Desktop Canvas**: Viewport background `#F8FAFC`. Maximum content container width `1280px` (`max-w-7xl`), centered with `24px` to `32px` gutter padding.
- **Sidebar Navigation Rail**:
  - Width: Fixed `240px`.
  - Background: `#FFFFFF` with `1px solid #E2E8F0` right border.
  - Header: 64px height featuring brand mark (`w-8 h-8 rounded-lg bg-indigo-600 text-white`) and subtitle.
  - Nav Items: 36px height, rounded-lg (`8px`), 12px font size.
  - Active Item: Indigo background `#EEF2FF`, indigo text `#4F46E5`, bold weight (600), and `3px solid #4F46E5` active right border indicator.
  - Footer: Compact engine telemetry readout (`Stalwart Mail Engine • TLS 1.3 Strict`).
- **Top Header Bar**:
  - Height: Fixed `64px`.
  - Left padding offset matching sidebar (`pl-60`), full-width backdrop blur with `#FFFFFF/90` fill.
  - Contains contextual tenant indicator pill, live cluster status, external webmail action button, and administrator profile avatar.

---

## 5. Components & UI Patterns

### Buttons
- **Primary Button (`.btn-primary`)**:
  - Height: 36px (dense) or 40px (standard).
  - Background: `#4F46E5` (`indigo-600`); Hover: `#4338CA`; Text: `#FFFFFF` (font-semibold, 12px-13px).
  - Border radius: `8px`. Box shadow: `0 1px 2px 0 rgba(0, 0, 0, 0.05)`.
- **Secondary Button (`.btn-secondary`)**:
  - Height: 36px or 40px.
  - Background: `#FFFFFF`; Hover: `#F8FAFC`; Text: `#334155`; Border: `1px solid #CBD5E1`.
- **Danger Button (`.btn-danger`)**:
  - Background: `#EF4444`; Hover: `#DC2626`; Text: `#FFFFFF`.
- **Icon Buttons**: Centered 14px-16px stroke icons with 1.5 spacing.

### Form Inputs & Controls
- **Standard Input (`.form-input`) & Select (`.form-select`)**:
  - Height: 38px–40px, rounded-lg (`8px`).
  - Border: `1px solid #CBD5E1`; Background: `#FFFFFF`; Text: `#0F172A` (13px).
  - Focus state: `border-color: #4F46E5; box-shadow: 0 0 0 1px #4F46E5; outline: none;`.
  - Placeholder: `#94A3B8`.
- **Form Group**: Vertical stack with `6px` spacing between label and input, `16px`–`20px` between consecutive fields.

### Status Badges (`.status-badge`)
- Shape: Fully rounded pill (`rounded-full`), height: 22px, padding: `2px 8px`.
- Typography: 11px font size, semi-bold (600).
- Structure: Includes a `6px` solid circular dot indicator positioned on the left side of the text label.
- States:
  - `active` / `operational` / `verified`: Green dot `#10B981`, Green tint `#ECFDF5`, Green text `#047857`.
  - `pending` / `in_progress` / `review`: Amber dot `#F59E0B`, Amber tint `#FFFBEB`, Amber text `#B45309`.
  - `suspended` / `failed` / `error`: Red dot `#EF4444`, Red tint `#FEF2F2`, Red text `#B91C1C`.
  - `closed` / `archived` / `inactive`: Gray dot `#64748B`, Slate tint `#F1F5F9`, Slate text `#475569`.

### Data Tables (`.data-table-container` & `.data-table`)
- Container: Border `1px solid #E2E8F0`, rounded `8px` or `12px`, background `#FFFFFF`, overflow-x auto.
- Header (`<thead>`):
  - Height: 38px.
  - Background: `#F8FAFC`.
  - Text: 11px uppercase, font-semibold (600), tracking `0.05em`, color `#475569`.
  - Bottom border: `1px solid #E2E8F0`.
- Rows (`<tbody> tr`):
  - Height: 44px–48px.
  - Hover background: `#F8FAFC/80` with smooth transition.
  - Bottom border: `1px solid #F1F5F9`.
  - Cells: 13px font size, vertically centered, right-aligned action buttons.

### Stat Cards (`.stat-card`)
- Container: White surface `#FFFFFF`, border `1px solid #E2E8F0`, rounded-xl (`12px`), padding: `20px`.
- Top: Category title (12px, font-semibold, uppercase, `#64748B`) paired with a `stat-icon-chip` (`32px x 32px` rounded-lg container with light indigo `#EEF2FF` or emerald `#ECFDF5` background).
- Center: Prominent numerical value (24px–28px, font-bold, `#0F172A`).
- Bottom: Subtext, contextual progress bar, or status label.

### Modals (`.modal-card`)
- Backdrop: `rgba(15, 23, 42, 0.4)` with light backdrop blur (`backdrop-blur-[2px]`).
- Card: White surface, border `1px solid #E2E8F0`, rounded-xl (`12px` or `16px`), max-width `540px` (or `640px` for dense wizards).
- Header: Title (15px font-bold, `#0F172A`), close button (`p-1 text-slate-400 hover:text-slate-700`).
- Body: Padded with `24px` spacing, scrollable if height exceeds viewport.
- Footer: `1px solid #E2E8F0` top border, right-aligned action buttons with `Cancel` (secondary) and `Confirm` (primary).

### Technical Records & Code Blocks
- DNS and token records are rendered in monospace containers (`font-mono text-xs text-slate-700 bg-white border border-slate-200 rounded px-2.5 py-1.5`) paired with a one-click copy button (`.btn-secondary btn-sm`) featuring instant visual feedback ("Copied!").

---

## 6. Iconography Standards

- **Icon Set**: Lucide Icons (`lucide-react`) exclusively.
- **Stroke Width**: Consistent 1.5px to 2px stroke width.
- **Sizes**:
  - Navigation icons: 17px–18px.
  - Control / button icons: 13px–15px.
  - Status indicators: 12px–14px.
  - Feature header icons: 20px–24px.
- **Rule**: Never use filled Material Symbols or multicolored emojis in production enterprise views.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  LayoutDashboard,
  Building2,
  Layers,
  Ticket,
  Server,
  Receipt,
  Archive,
  CornerDownLeft,
  Building,
} from 'lucide-react';
import { TenantSummary } from '../types';
import { DashboardTab } from './PlatformAdminDashboard';

interface NavShortcut {
  id: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  tab: DashboardTab;
}

const NAV_SHORTCUTS: NavShortcut[] = [
  { id: 'nav-dashboard', label: 'Dashboard', hint: 'Overview & platform metrics', icon: <LayoutDashboard className="w-4 h-4" />, tab: 'dashboard' },
  { id: 'nav-tenants', label: 'Tenants', hint: 'Manage organisations', icon: <Building2 className="w-4 h-4" />, tab: 'tenants' },
  { id: 'nav-plans', label: 'Plans', hint: 'Billing plans & pricing', icon: <Layers className="w-4 h-4" />, tab: 'plans' },
  { id: 'nav-coupons', label: 'Coupons', hint: 'Trial-extension codes', icon: <Ticket className="w-4 h-4" />, tab: 'coupons' },
  { id: 'nav-operations', label: 'System Health', hint: 'Backups, drift & operations', icon: <Server className="w-4 h-4" />, tab: 'operations' },
  { id: 'nav-audit', label: 'Audit Log', hint: 'Every action, who did it', icon: <Receipt className="w-4 h-4" />, tab: 'audit' },
  { id: 'nav-deleted', label: 'Deleted Archive', hint: 'Removed organisations', icon: <Archive className="w-4 h-4" />, tab: 'deleted-organisations' },
];

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  tenants: TenantSummary[];
  onNavigate: (tab: DashboardTab) => void;
  onSelectTenant: (tenantId: string) => void;
}

/**
 * Global ⌘K / Ctrl+K command palette: jump to any top-level section, or search
 * the already-loaded tenant list by name or id and go straight to its detail view.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  tenants,
  onNavigate,
  onSelectTenant,
}) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      // Autofocus after the dialog paints.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const matchingTenants = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return tenants
      .filter((t) => t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, tenants]);

  const matchingShortcuts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV_SHORTCUTS;
    return NAV_SHORTCUTS.filter((s) => s.label.toLowerCase().includes(q) || s.hint.toLowerCase().includes(q));
  }, [query]);

  // Flat list of selectable items so arrow keys move across both groups.
  type Item =
    | { kind: 'shortcut'; shortcut: NavShortcut }
    | { kind: 'tenant'; tenant: TenantSummary };

  const items: Item[] = useMemo(
    () => [
      ...matchingShortcuts.map((shortcut) => ({ kind: 'shortcut' as const, shortcut })),
      ...matchingTenants.map((tenant) => ({ kind: 'tenant' as const, tenant })),
    ],
    [matchingShortcuts, matchingTenants]
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const runItem = (item: Item) => {
    if (item.kind === 'shortcut') {
      onNavigate(item.shortcut.tab);
    } else {
      onSelectTenant(item.tenant.id);
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[activeIndex];
      if (item) runItem(item);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[12vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        onClick={onClose}
        className="absolute inset-0"
        style={{ backgroundColor: 'var(--overlay-color)', backdropFilter: 'blur(2px)' }}
      />
      <div
        className="relative w-full max-w-lg rounded-xl overflow-hidden flex flex-col"
        style={{
          backgroundColor: 'var(--surface-color)',
          border: '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-xl)',
          maxHeight: '70vh',
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2.5 px-4 shrink-0" style={{ height: 52, borderBottom: '1px solid var(--border-color)' }}>
          <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--slate-400)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a section, or search tenants by name / ID…"
            className="flex-1 text-sm outline-none bg-transparent"
            style={{ color: 'var(--slate-900)' }}
            aria-label="Command palette search"
          />
          <kbd
            className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0"
            style={{ backgroundColor: 'var(--slate-100)', color: 'var(--slate-500)' }}
          >
            Esc
          </kbd>
        </div>

        <div className="overflow-y-auto py-2">
          {matchingShortcuts.length > 0 && (
            <div className="px-2 pb-1">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--slate-400)' }}>
                Go to
              </div>
              {matchingShortcuts.map((shortcut) => {
                const index = items.findIndex((it) => it.kind === 'shortcut' && it.shortcut.id === shortcut.id);
                const active = index === activeIndex;
                return (
                  <button
                    key={shortcut.id}
                    type="button"
                    onClick={() => runItem({ kind: 'shortcut', shortcut })}
                    onMouseEnter={() => setActiveIndex(index)}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left cursor-pointer transition-colors"
                    style={{
                      backgroundColor: active ? 'var(--indigo-50)' : 'transparent',
                      color: active ? 'var(--indigo-700)' : 'var(--slate-700)',
                    }}
                  >
                    <span className="shrink-0" style={{ color: active ? 'var(--indigo-600)' : 'var(--slate-400)' }}>
                      {shortcut.icon}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{shortcut.label}</span>
                      <span className="block text-xs truncate" style={{ color: 'var(--slate-400)' }}>
                        {shortcut.hint}
                      </span>
                    </span>
                    {active && <CornerDownLeft className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--indigo-400)' }} />}
                  </button>
                );
              })}
            </div>
          )}

          {query.trim() && (
            <div className="px-2 pt-1">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--slate-400)' }}>
                Tenants
              </div>
              {matchingTenants.length === 0 ? (
                <div className="px-2.5 py-3 text-xs" style={{ color: 'var(--slate-400)' }}>
                  No tenants match "{query}".
                </div>
              ) : (
                matchingTenants.map((tenant) => {
                  const index = items.findIndex((it) => it.kind === 'tenant' && it.tenant.id === tenant.id);
                  const active = index === activeIndex;
                  return (
                    <button
                      key={tenant.id}
                      type="button"
                      onClick={() => runItem({ kind: 'tenant', tenant })}
                      onMouseEnter={() => setActiveIndex(index)}
                      className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left cursor-pointer transition-colors"
                      style={{
                        backgroundColor: active ? 'var(--indigo-50)' : 'transparent',
                        color: active ? 'var(--indigo-700)' : 'var(--slate-700)',
                      }}
                    >
                      <span className="shrink-0" style={{ color: active ? 'var(--indigo-600)' : 'var(--slate-400)' }}>
                        <Building className="w-4 h-4" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium truncate">{tenant.name}</span>
                        <span className="block text-xs truncate font-mono" style={{ color: 'var(--slate-400)' }}>
                          {tenant.domain?.domainName || tenant.id}
                        </span>
                      </span>
                      {active && <CornerDownLeft className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--indigo-400)' }} />}
                    </button>
                  );
                })
              )}
            </div>
          )}

          {items.length === 0 && !query.trim() && (
            <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--slate-400)' }}>
              Start typing to search…
            </div>
          )}
        </div>

        <div
          className="flex items-center gap-3 px-4 py-2 text-[11px] shrink-0"
          style={{ borderTop: '1px solid var(--border-color)', color: 'var(--slate-400)' }}
        >
          <span className="inline-flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--slate-100)' }}>↑</kbd>
            <kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--slate-100)' }}>↓</kbd>
            to navigate
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--slate-100)' }}>↵</kbd>
            to select
          </span>
        </div>
      </div>
    </div>
  );
};

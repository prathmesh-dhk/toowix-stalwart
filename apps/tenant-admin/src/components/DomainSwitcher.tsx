import React, { useState, useRef, useEffect } from 'react';
import { DomainItem } from '../types';
import { ChevronsUpDown, Plus, Check } from 'lucide-react';

interface DomainSwitcherProps {
  domains: DomainItem[];
  activeDomain: DomainItem | null;
  onSelectDomain: (domain: DomainItem) => void;
  onOpenAddDomain: () => void;
}

export const DomainSwitcher: React.FC<DomainSwitcherProps> = ({
  domains,
  activeDomain,
  onSelectDomain,
  onOpenAddDomain,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // If no domains exist yet, show a clean, crisp action button
  if (domains.length === 0) {
    return (
      <div className="mb-4">
        <button
          type="button"
          onClick={onOpenAddDomain}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 text-slate-800 transition-colors cursor-pointer text-xs font-medium group shadow-2xs"
          id="btn-add-first-domain-sidebar"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Plus className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
            <span className="font-semibold text-slate-800 truncate text-xs">Add Your Domain</span>
          </div>
          <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200/60 px-2 py-0.5 rounded-full shrink-0">
            Setup
          </span>
        </button>
      </div>
    );
  }

  const currentDomainName = activeDomain?.domainName || domains[0]?.domainName || 'Select Domain';
  const currentInitial = currentDomainName.charAt(0).toUpperCase();
  const currentMailboxCount = activeDomain?.mailboxCount ?? 0;
  const currentLimit = activeDomain?.mailboxLimit ?? 10;

  return (
    <div className="relative mb-4" ref={dropdownRef}>
      {/* Top Sidebar Trigger Button (Styled matching the requested pill layout) */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        id="domain-switcher-trigger"
        className={`w-full flex items-center justify-between p-2 rounded-xl border transition-all text-left group cursor-pointer ${
          isOpen
            ? 'bg-slate-50 border-indigo-300 shadow-sm ring-2 ring-indigo-500/10'
            : 'bg-white hover:bg-slate-50 border-slate-200/90 shadow-2xs'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Domain Icon / Avatar */}
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs tracking-wider">
            {currentInitial}
          </div>

          {/* Domain Info */}
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-900 truncate leading-tight group-hover:text-indigo-600 transition-colors">
                {currentDomainName}
              </span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[10px] text-slate-500 font-medium leading-none">
                {activeDomain?.isPrimary ? 'Primary' : 'Domain'} • {currentMailboxCount}/{currentLimit} seats
              </span>
            </div>
          </div>
        </div>

        {/* Right chevrons & count badge */}
        <div className="flex items-center gap-1.5 shrink-0 pl-1">
          <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/80">
            {domains.length}
          </span>
          <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-colors" />
        </div>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5 overflow-hidden ring-1 ring-black/5 animate-in fade-in-50 zoom-in-95 duration-100"
        >
          {/* Header */}
          <div className="px-3 py-1.5 flex items-center justify-between border-b border-slate-100">
            <span className="text-[10px] font-semibold tracking-wider uppercase text-slate-400">
              Your Domains ({domains.length})
            </span>
            <span className="text-[10px] text-slate-400 font-medium">Switch view</span>
          </div>

          {/* Domain List */}
          <div className="max-h-56 overflow-y-auto py-1">
            {domains.map((domain) => {
              const isSelected = activeDomain?.id === domain.id;
              const initial = domain.domainName.charAt(0).toUpperCase();

              return (
                <button
                  key={domain.id}
                  type="button"
                  onClick={() => {
                    onSelectDomain(domain);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors cursor-pointer group ${
                    isSelected
                      ? 'bg-indigo-50/70 text-indigo-950 font-medium'
                      : 'hover:bg-slate-50 text-slate-700 font-normal'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-semibold shrink-0 ${
                        isSelected
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'
                      }`}
                    >
                      {initial}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs truncate">{domain.domainName}</span>
                        {domain.isPrimary && (
                          <span className="text-[9px] font-semibold uppercase tracking-wider bg-slate-100 text-slate-600 px-1 py-0.2 rounded border border-slate-200 shrink-0">
                            Primary
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 mt-0.5">
                        {domain.mailboxCount} / {domain.mailboxLimit} seats used
                      </span>
                    </div>
                  </div>

                  {isSelected && (
                    <Check className="w-4 h-4 text-indigo-600 shrink-0 ml-2" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div className="border-t border-slate-100 my-1" />

          {/* Add New Domain Action Button */}
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              onOpenAddDomain();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50/60 transition-colors cursor-pointer text-left"
            id="btn-add-new-domain-dropdown"
          >
            <div className="w-5 h-5 rounded-md bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <Plus className="w-3.5 h-3.5" />
            </div>
            <span>+ Add New Domain</span>
          </button>
        </div>
      )}
    </div>
  );
};

import React, { useState, useRef, useEffect } from 'react';
import { DomainItem, DnsActivationStatus } from '../types';
import { ChevronDown, Check, Globe } from 'lucide-react';

export function dnsStatusPill(dnsStatus?: DnsActivationStatus) {
  switch (dnsStatus) {
    case 'active':
      return { label: 'Active', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'activating':
      return { label: 'Activating', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    case 'conflict':
      return { label: 'Conflict', className: 'bg-rose-50 text-rose-700 border-rose-200' };
    case 'activation_failed':
      return { label: 'Failed', className: 'bg-rose-50 text-rose-700 border-rose-200' };
    default:
      return { label: 'Not Activated', className: 'bg-slate-100 text-slate-500 border-slate-200' };
  }
}

interface DomainSwitcherProps {
  domains: DomainItem[];
  activeDomain: DomainItem | null;
  onSelectDomain: (domain: DomainItem) => void;
  onOpenAddDomain?: () => void;
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

  if (domains.length === 0) {
    return (
      <div className="mb-3">
        <button
          type="button"
          onClick={onOpenAddDomain}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium cursor-pointer shadow-2xs"
          id="btn-add-first-domain-sidebar"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">Add Domain</span>
          </div>
        </button>
      </div>
    );
  }

  const currentDomainName = activeDomain?.domainName || domains[0]?.domainName || 'Select Domain';

  return (
    <div className="relative mb-3" ref={dropdownRef}>
      {/* Trigger Button: Globe Icon + Domain Name + Chevron */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        id="domain-switcher-trigger"
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all text-left cursor-pointer ${
          isOpen
            ? 'bg-slate-50 border-indigo-300 shadow-sm ring-2 ring-indigo-500/10'
            : 'bg-white hover:bg-slate-50 border-slate-200/90 shadow-2xs'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-800 truncate">
            {currentDomainName}
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ml-1.5 ${
            isOpen ? 'rotate-180 text-slate-600' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu: Globe Icon + Domain Names */}
      {isOpen && (
        <div
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1 overflow-hidden ring-1 ring-black/5"
        >
          <div className="max-h-60 overflow-y-auto">
            {domains.map((domain) => {
              const isSelected = activeDomain?.id === domain.id;

              return (
                <button
                  key={domain.id}
                  type="button"
                  onClick={() => {
                    onSelectDomain(domain);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-50 text-indigo-700 font-semibold'
                      : 'hover:bg-slate-50 text-slate-700 font-normal'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Globe
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isSelected ? 'text-indigo-600' : 'text-slate-400'
                      }`}
                    />
                    <span className="truncate">{domain.domainName}</span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0 ml-2" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

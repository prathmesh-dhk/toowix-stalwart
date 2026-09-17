import React, { useState } from 'react';
import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { DomainItem } from '../types';
import { BlockedIpsView } from './BlockedIpsView';
import { AllowedIpsView } from './AllowedIpsView';

interface DomainSecurityViewProps {
  activeDomain: DomainItem | null;
  initialTab?: 'blocked-ips' | 'allowed-ips';
}

export const DomainSecurityView: React.FC<DomainSecurityViewProps> = ({
  activeDomain,
  initialTab = 'blocked-ips',
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'blocked-ips' | 'allowed-ips'>(initialTab);
  const [prefillAllowedIp, setPrefillAllowedIp] = useState<string | undefined>();

  const domainName = activeDomain?.domainName || '';

  const handleSwitchToAllowed = (ip?: string) => {
    setPrefillAllowedIp(ip);
    setActiveSubTab('allowed-ips');
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
              <Shield className="w-6 h-6 text-indigo-600" />
              <span>Domain Security</span>
            </h1>
            {domainName && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/70 font-mono">
                @{domainName}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            {domainName
              ? `Manage firewall rules, blocked IPs, and trusted networks for @${domainName}.`
              : 'Manage domain-level firewall rules, blocked IPs, and trusted networks.'}
          </p>
        </div>
      </div>

      {/* Sub-Tabs Switcher */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl max-w-fit border border-slate-200/80 shadow-xs">
        <button
          onClick={() => setActiveSubTab('blocked-ips')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            activeSubTab === 'blocked-ips'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
          }`}
          id="tab-domain-blocked-ips"
        >
          <ShieldAlert size={14} className={activeSubTab === 'blocked-ips' ? 'text-rose-600' : 'text-slate-400'} />
          <span>Blocked IPs</span>
        </button>

        <button
          onClick={() => setActiveSubTab('allowed-ips')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            activeSubTab === 'allowed-ips'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
          }`}
          id="tab-domain-allowed-ips"
        >
          <ShieldCheck size={14} className={activeSubTab === 'allowed-ips' ? 'text-emerald-600' : 'text-slate-400'} />
          <span>Allowed IPs</span>
        </button>
      </div>

      {/* View Content */}
      {activeSubTab === 'blocked-ips' && (
        <BlockedIpsView
          domainId={activeDomain?.id}
          domainName={domainName}
          onSwitchToAllowed={handleSwitchToAllowed}
        />
      )}

      {activeSubTab === 'allowed-ips' && (
        <AllowedIpsView
          domainId={activeDomain?.id}
          domainName={domainName}
          initialPrefillIp={prefillAllowedIp}
          onClearPrefillIp={() => setPrefillAllowedIp(undefined)}
        />
      )}
    </div>
  );
};

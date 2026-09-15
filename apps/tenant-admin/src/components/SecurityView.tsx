import React, { useState } from 'react';
import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { UserContext } from '../types';
import { SecuritySettingsView } from './SecuritySettingsView';
import { BlockedIpsView } from './BlockedIpsView';
import { AllowedIpsView } from './AllowedIpsView';

interface SecurityViewProps {
  user: UserContext;
  on2FaStatusChange?: (enabled: boolean) => void;
  initialTab?: 'account' | 'blocked-ips' | 'allowed-ips';
}

export const SecurityView: React.FC<SecurityViewProps> = ({
  user,
  on2FaStatusChange,
  initialTab = 'account',
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'account' | 'blocked-ips' | 'allowed-ips'>(initialTab);
  const [prefillAllowedIp, setPrefillAllowedIp] = useState<string | undefined>();

  const handleSwitchToAllowed = (ip?: string) => {
    setPrefillAllowedIp(ip);
    setActiveSubTab('allowed-ips');
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Section Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
          <Shield className="w-6 h-6 text-indigo-600" />
          <span>Security & Firewall Settings</span>
        </h1>
        <p className="text-xs text-slate-500">
          Manage administrator account authentication, Stalwart firewall IP bans, and trusted IP whitelisting.
        </p>
      </div>

      {/* Sub-Tabs Switcher */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl max-w-fit border border-slate-200/80 shadow-xs">
        <button
          onClick={() => setActiveSubTab('account')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            activeSubTab === 'account'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
          }`}
          id="tab-account-security"
        >
          <Shield size={14} className={activeSubTab === 'account' ? 'text-indigo-600' : 'text-slate-400'} />
          <span>Account Security</span>
        </button>

        <button
          onClick={() => setActiveSubTab('blocked-ips')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            activeSubTab === 'blocked-ips'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
          }`}
          id="tab-blocked-ips"
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
          id="tab-allowed-ips"
        >
          <ShieldCheck size={14} className={activeSubTab === 'allowed-ips' ? 'text-emerald-600' : 'text-slate-400'} />
          <span>Allowed IPs (Whitelist)</span>
        </button>
      </div>

      {/* View Content */}
      {activeSubTab === 'account' && (
        <SecuritySettingsView user={user} on2FaStatusChange={on2FaStatusChange} />
      )}

      {activeSubTab === 'blocked-ips' && (
        <BlockedIpsView onSwitchToAllowed={handleSwitchToAllowed} />
      )}

      {activeSubTab === 'allowed-ips' && (
        <AllowedIpsView
          initialPrefillIp={prefillAllowedIp}
          onClearPrefillIp={() => setPrefillAllowedIp(undefined)}
        />
      )}
    </div>
  );
};

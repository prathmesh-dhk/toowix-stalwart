import React from 'react';
import { UserContext } from '../types';
import { SecuritySettingsView } from './SecuritySettingsView';

interface SecurityViewProps {
  user: UserContext;
  on2FaStatusChange?: (enabled: boolean) => void;
  /** Extra cards (e.g. the danger zone) shown after the settings cards, above the page footer. */
  children?: React.ReactNode;
}

export const SecurityView: React.FC<SecurityViewProps> = ({
  user,
  on2FaStatusChange,
  children,
}) => {
  return (
    <div className="flex flex-col gap-6">
      <SecuritySettingsView user={user} on2FaStatusChange={on2FaStatusChange} />
      {children}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 text-xs text-slate-400 font-normal">
        <div>Toowix Mail Server & Admin Suite · Build 2026.9.1</div>
        <div className="flex items-center gap-3 text-slate-400">
          <span className="hover:text-slate-600 transition-colors cursor-pointer">Security Guide</span>
          <span>·</span>
          <span className="hover:text-slate-600 transition-colors cursor-pointer">RFC 6238</span>
          <span>·</span>
          <span className="hover:text-slate-600 transition-colors cursor-pointer">Support</span>
        </div>
      </div>
    </div>
  );
};


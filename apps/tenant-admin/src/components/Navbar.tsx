import React, { useState } from 'react';
import { UserContext } from '../types';
import { Mail, LogOut, ShieldCheck, Building2, ExternalLink, Laptop, MoreVertical, X } from 'lucide-react';
import toowixLogo from '../assets/toowix-logo.svg';
import { ActiveSessionsModal } from './modals/ActiveSessionsModal';

interface NavbarProps {
  user: UserContext;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ user, onLogout }) => {
  const [showSessionsModal, setShowSessionsModal] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  return (
    <>
      <header className="navbar px-4 sm:px-6 flex items-center justify-between">
        <div className="brand flex items-center gap-2.5">
          <img src={toowixLogo} alt="Toowix" className="w-8 h-8 brand-icon object-contain" />
          <span className="font-semibold text-sm tracking-tight">TOOWIX <span style={{ color: 'var(--primary-light)', fontWeight: 400 }}>ADMIN</span></span>
        </div>

        {/* Desktop Navigation Items (>= 768px) */}
        <div className="hidden md:flex items-center gap-4">
          {user.role === 'SUPER_ADMIN' ? (
            <span className="badge badge-platform">
              <ShieldCheck size={14} /> Super Admin
            </span>
          ) : (
            <span className="badge badge-tenant">
              <Building2 size={14} /> Admin
            </span>
          )}

          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            {user.email}
          </span>

          <button
            onClick={() => setShowSessionsModal(true)}
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Manage logged-in devices and sessions"
          >
            <Laptop size={14} color="var(--primary)" />
            <span>Devices</span>
          </button>

          <a
            href={(import.meta as any).env?.VITE_WEBMAIL_URL || 'http://localhost:8888'}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none', color: 'var(--text-main)' }}
            title="Open Webmail"
          >
            <Mail size={14} color="var(--primary)" />
            <span>Webmail</span>
            <ExternalLink size={12} color="var(--text-dim)" />
          </a>

          <button
            onClick={onLogout}
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Sign out"
          >
            <LogOut size={14} />
            <span>Sign out</span>
          </button>
        </div>

        {/* Mobile Navigation Toggle (< 768px) */}
        <div className="flex md:hidden items-center gap-1 relative">
          <button
            onClick={() => setShowSessionsModal(true)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            title="Devices"
            aria-label="Devices"
          >
            <Laptop size={18} color="var(--primary)" />
          </button>
          <a
            href={(import.meta as any).env?.VITE_WEBMAIL_URL || 'http://localhost:8888'}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            title="Webmail"
            aria-label="Webmail"
          >
            <Mail size={18} color="var(--primary)" />
          </a>
          <button
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="More options"
          >
            {showMobileMenu ? <X size={18} /> : <MoreVertical size={18} />}
          </button>

          {/* Mobile Menu Dropdown */}
          {showMobileMenu && (
            <div className="absolute right-0 top-12 w-56 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="px-3.5 py-2.5 border-b border-slate-100">
                <p className="text-xs font-semibold text-slate-900 truncate">{user.email}</p>
                <p className="text-[11px] text-slate-500 capitalize">{user.role?.replace(/_/g, ' ')?.toLowerCase() || 'admin'}</p>
              </div>
              <button
                onClick={() => {
                  setShowMobileMenu(false);
                  onLogout();
                }}
                className="w-full min-h-[44px] text-left px-3.5 py-2.5 text-xs font-medium text-rose-600 hover:bg-rose-50 flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <LogOut size={16} />
                <span>Sign out</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Active Devices & Sessions Modal */}
      <ActiveSessionsModal
        isOpen={showSessionsModal}
        onClose={() => setShowSessionsModal(false)}
      />
    </>
  );
};

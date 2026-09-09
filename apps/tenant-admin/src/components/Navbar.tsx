import React, { useState } from 'react';
import { UserContext } from '../types';
import { Mail, LogOut, ShieldCheck, Building2, ExternalLink, Laptop } from 'lucide-react';
import toowixLogo from '../assets/toowix-logo.svg';
import { ActiveSessionsModal } from './modals/ActiveSessionsModal';

interface NavbarProps {
  user: UserContext;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ user, onLogout }) => {
  const [showSessionsModal, setShowSessionsModal] = useState(false);

  return (
    <>
      <header className="navbar">
        <div className="brand">
          <img src={toowixLogo} alt="Toowix" className="brand-icon object-contain" />
          <span>TOOWIX <span style={{ color: 'var(--primary-light)', fontWeight: 400 }}>MAIL</span></span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
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
            href="http://localhost:8888"
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
      </header>

      {/* Active Devices & Sessions Modal */}
      <ActiveSessionsModal
        isOpen={showSessionsModal}
        onClose={() => setShowSessionsModal(false)}
      />
    </>
  );
};

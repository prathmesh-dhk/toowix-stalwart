import React from 'react';
import { UserContext } from '../types';
import { Mail, LogOut, ShieldCheck, Building2, ExternalLink } from 'lucide-react';

interface NavbarProps {
  user: UserContext;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ user, onLogout }) => {
  return (
    <header className="navbar">
      <div className="brand">
        <div className="brand-icon">
          <Mail size={20} color="#ffffff" />
        </div>
        <span>TOOWIX <span style={{ color: 'var(--primary-light)', fontWeight: 400 }}>MAIL</span></span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {user.role === 'SUPER_ADMIN' ? (
          <span className="badge badge-platform">
            <ShieldCheck size={14} /> Super Admin
          </span>
        ) : (
          <span className="badge badge-tenant">
            <Building2 size={14} /> Tenant Admin
          </span>
        )}

        <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          {user.email}
        </span>

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
  );
};

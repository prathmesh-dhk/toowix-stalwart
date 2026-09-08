import React, { useState, useEffect } from 'react';
import { TenantSummary } from '../../types';
import { api } from '../../api';
import {
  X,
  Globe,
  Users,
  CheckCircle2,
  PauseCircle,
  PlayCircle,
  KeyRound,
  Sliders,
  Trash2,
} from 'lucide-react';

interface TenantDetailModalProps {
  tenant: TenantSummary | null;
  isOpen: boolean;
  onClose: () => void;
  onActivateTenant?: (tenant: TenantSummary) => void;
  onToggleSuspend?: (tenant: TenantSummary) => void;
  onManageAdmins?: (tenant: TenantSummary) => void;
  onUpdateQuota?: (tenant: TenantSummary) => void;
  onDeleteTenant?: (tenant: TenantSummary) => void;
}

export const TenantDetailModal: React.FC<TenantDetailModalProps> = ({
  tenant,
  isOpen,
  onClose,
  onActivateTenant,
  onToggleSuspend,
  onManageAdmins,
  onUpdateQuota,
  onDeleteTenant,
}) => {
  const [admins, setAdmins] = useState<any[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(true);
  const [resettingAdminId, setResettingAdminId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordResetSuccess, setPasswordResetSuccess] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !tenant) return;
    const loadAdmins = async () => {
      setLoadingAdmins(true);
      try {
        const res = await api.listTenantAdmins(tenant.id);
        setAdmins(res.admins || []);
      } catch (err: any) {
        console.error('Failed to load tenant admins:', err);
      } finally {
        setLoadingAdmins(false);
      }
    };
    loadAdmins();
  }, [isOpen, tenant]);

  if (!isOpen || !tenant) return null;

  const handleResetPassword = async (adminId: string) => {
    if (!newPassword || newPassword.length < 8) {
      setAdminError('Password must be at least 8 characters long.');
      return;
    }
    setAdminError(null);
    try {
      await api.resetTenantAdminPassword(tenant.id, adminId, newPassword);
      setPasswordResetSuccess('Password updated successfully.');
      setResettingAdminId(null);
      setNewPassword('');
      setTimeout(() => setPasswordResetSuccess(null), 3000);
    } catch (err: any) {
      setAdminError(err.message || 'Failed to reset administrator password');
    }
  };

  const usagePercent = Math.min(100, Math.round((tenant.mailboxCount / tenant.mailboxLimit) * 100));

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '680px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Organization Details</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', margin: '4px 0 0 0' }}>
              Tenant ID: <span style={{ fontFamily: 'monospace' }}>{tenant.id}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 }}
          >
            <X size={20} />
          </button>
        </div>

        {passwordResetSuccess && (
          <div style={{ background: 'var(--success-bg)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '10px 14px', borderRadius: 'var(--radius-md)', color: '#6ee7b7', marginBottom: '16px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle2 size={16} />
            <span>{passwordResetSuccess}</span>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Header Card: Status & Quota */}
          <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Organization</span>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)', margin: '2px 0 0 0' }}>{tenant.name}</h2>
              </div>
              <div>
                {tenant.status === 'active' && (
                  <span className="badge badge-success">
                    <CheckCircle2 size={12} /> Active
                  </span>
                )}
                {tenant.status === 'suspended' && (
                  <span className="badge badge-danger">
                    <PauseCircle size={12} /> Suspended
                  </span>
                )}
                {tenant.status === 'approved_pending_setup' && (
                  <span className="badge badge-warning">
                    Pending Activation
                  </span>
                )}
              </div>
            </div>

            {/* Quota Progress */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '6px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Mailbox Allocation</span>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                  {tenant.mailboxCount} / {tenant.mailboxLimit} mailboxes in use ({usagePercent}%)
                </span>
              </div>
              <div style={{ width: '100%', height: '8px', background: 'rgba(255, 255, 255, 0.06)', borderRadius: '9999px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${usagePercent}%`,
                    background: usagePercent >= 90 ? 'var(--danger)' : usagePercent >= 75 ? 'var(--warning)' : 'var(--primary)',
                    borderRadius: '9999px',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Domain Details */}
          <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Globe size={15} color="var(--primary-light)" /> Dedicated Domain
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.85rem' }}>
              <div>
                <span style={{ color: 'var(--text-dim)', display: 'block', fontSize: '0.75rem' }}>Domain Name:</span>
                <span style={{ fontWeight: 600, color: 'var(--primary-light)', fontFamily: 'monospace' }}>
                  {tenant.domain?.domainName || 'No domain linked'}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-dim)', display: 'block', fontSize: '0.75rem' }}>Stalwart ID:</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--text-main)' }}>
                  {tenant.domain?.stalwartDomainId || '—'}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-dim)', display: 'block', fontSize: '0.75rem' }}>Created:</span>
                <span style={{ color: 'var(--text-main)' }}>
                  {new Date(tenant.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-dim)', display: 'block', fontSize: '0.75rem' }}>Status:</span>
                <span style={{ color: tenant.domain?.status === 'active' ? 'var(--success)' : 'var(--warning)', fontWeight: 500 }}>
                  {tenant.domain?.status || '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Administrators List */}
          <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={15} color="var(--accent-light)" /> Tenant Administrators ({admins.length})
            </h4>

            {adminError && (
              <div style={{ background: 'var(--danger-bg)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', color: '#fca5a5', marginBottom: '12px', fontSize: '0.8rem' }}>
                {adminError}
              </div>
            )}

            {loadingAdmins ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', padding: '10px 0' }}>Loading administrators...</div>
            ) : admins.length === 0 ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', padding: '10px 0' }}>No administrators registered for this tenant yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {admins.map((adm) => (
                  <div
                    key={adm._id || adm.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-main)' }}>{adm.email}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                        Role: {adm.role} {adm.twoFactorEnabled ? '• 2FA Active' : ''}
                      </div>
                    </div>

                    {resettingAdminId === (adm._id || adm.id) ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="New password (8+ chars)"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          style={{ padding: '4px 8px', fontSize: '0.75rem', width: '160px' }}
                        />
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleResetPassword(adm._id || adm.id)}
                          style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                        >
                          Save
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => { setResettingAdminId(null); setNewPassword(''); }}
                          style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => { setResettingAdminId(adm._id || adm.id); setNewPassword(''); }}
                        style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        <KeyRound size={12} /> Reset password
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modal Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {onManageAdmins && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { onClose(); onManageAdmins(tenant); }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Users size={14} /> Admins
              </button>
            )}

            {onUpdateQuota && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { onClose(); onUpdateQuota(tenant); }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Sliders size={14} /> Adjust Quota
              </button>
            )}

            {tenant.status === 'approved_pending_setup' && onActivateTenant && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => { onClose(); onActivateTenant(tenant); }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'linear-gradient(135deg, #10b981, #059669)' }}
              >
                <PlayCircle size={14} /> Activate Tenant
              </button>
            )}

            {tenant.status === 'active' && onToggleSuspend && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { onClose(); onToggleSuspend(tenant); }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#fca5a5' }}
              >
                <PauseCircle size={14} /> Suspend Access
              </button>
            )}

            {tenant.status === 'suspended' && onToggleSuspend && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { onClose(); onToggleSuspend(tenant); }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#86efac' }}
              >
                <PlayCircle size={14} /> Reactivate Access
              </button>
            )}

            {onDeleteTenant && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { onClose(); onDeleteTenant(tenant); }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#f87171' }}
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

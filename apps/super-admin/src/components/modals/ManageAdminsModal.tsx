import React, { useState, useEffect } from 'react';
import { X, Users, KeyRound, Plus, AlertTriangle, ShieldCheck, Mail } from 'lucide-react';
import { api } from '../../api';
import { TenantSummary } from '../../types';

interface ManageAdminsModalProps {
  isOpen: boolean;
  tenant: TenantSummary | null;
  onClose: () => void;
  onUpdated?: () => void;
}

export const ManageAdminsModal: React.FC<ManageAdminsModalProps> = ({
  isOpen,
  tenant,
  onClose,
  onUpdated,
}) => {
  const [admins, setAdmins] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // New admin form
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Password reset inline state
  const [resettingAdminId, setResettingAdminId] = useState<string | null>(null);
  const [resetPasswordInput, setResetPasswordInput] = useState('');

  const loadAdmins = async () => {
    if (!tenant) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listTenantAdmins(tenant.id);
      setAdmins(res.admins || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load tenant administrators.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && tenant) {
      loadAdmins();
      setNewEmail('');
      setNewPassword('');
      setError(null);
      setSuccessMsg(null);
      setResettingAdminId(null);
    }
  }, [isOpen, tenant]);

  if (!isOpen || !tenant) return null;

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || !newPassword.trim()) {
      setError('Email and password are required.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setFormLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      await api.createTenantAdmin(tenant.id, {
        email: newEmail.trim().toLowerCase(),
        password: newPassword,
      });
      setNewEmail('');
      setNewPassword('');
      setSuccessMsg(`Administrator account created successfully.`);
      await loadAdmins();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to create tenant administrator.');
    } finally {
      setFormLoading(false);
    }
  };

  const handleExecuteResetPassword = async (adminId: string) => {
    if (!resetPasswordInput || resetPasswordInput.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }

    setFormLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      await api.resetTenantAdminPassword(tenant.id, adminId, resetPasswordInput);
      setSuccessMsg(`Password successfully reset for administrator.`);
      setResettingAdminId(null);
      setResetPasswordInput('');
    } catch (err: any) {
      setError(err.message || 'Failed to reset administrator password.');
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1050 }}>
      <div className="modal-content" style={{ maxWidth: '580px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: 'rgba(99, 102, 241, 0.15)',
              color: '#818cf8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Users size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 600, margin: 0, color: 'var(--text-main)' }}>
                Tenant Administrators
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', margin: '2px 0 0 0' }}>
                {tenant.name} &bull; <code style={{ color: 'var(--primary-light)' }}>{tenant.domain?.domainName || 'No Domain'}</code>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        {error && (
          <div style={{
            background: 'var(--danger-bg)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            color: '#fca5a5',
            marginBottom: '16px',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div style={{
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            color: '#34d399',
            marginBottom: '16px',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <ShieldCheck size={16} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Existing Admins Section */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              Assigned Administrators ({admins.length})
            </span>
          </div>

          {loading ? (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
              Loading administrator accounts...
            </div>
          ) : admins.length === 0 ? (
            <div style={{
              padding: '16px',
              textAlign: 'center',
              background: 'var(--bg-input)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-dim)',
              fontSize: '0.85rem',
            }}>
              No tenant administrators registered for this organization yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
              {admins.map((adm) => (
                <div
                  key={adm.id}
                  style={{
                    padding: '12px 14px',
                    background: 'var(--bg-input)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Mail size={14} color="var(--primary-light)" />
                        {adm.email}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '2px' }}>
                        Role: {adm.role || 'TENANT_ADMIN'} &bull; Status: <span style={{ color: adm.status === 'active' ? 'var(--success)' : 'var(--text-dim)' }}>{adm.status || 'Active'}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setResettingAdminId(resettingAdminId === adm.id ? null : adm.id);
                        setResetPasswordInput('');
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
                    >
                      <KeyRound size={13} />
                      {resettingAdminId === adm.id ? 'Cancel' : 'Reset Password'}
                    </button>
                  </div>

                  {resettingAdminId === adm.id && (
                    <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '4px', display: 'block' }}>
                        Set new password for {adm.email}:
                      </label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="password"
                          className="form-input"
                          placeholder="Min 8 characters"
                          value={resetPasswordInput}
                          onChange={(e) => setResetPasswordInput(e.target.value)}
                          style={{ fontSize: '0.82rem' }}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={formLoading || resetPasswordInput.length < 8}
                          onClick={() => handleExecuteResetPassword(adm.id)}
                        >
                          Confirm
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add Administrator Form */}
        <form onSubmit={handleCreateAdmin} style={{ borderTop: '1px solid var(--border)', paddingTop: '18px' }}>
          <h4 style={{ fontSize: '0.92rem', fontWeight: 600, marginBottom: '12px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Plus size={16} /> Add Administrator
          </h4>

          <div className="form-group" style={{ marginBottom: '12px' }}>
            <label className="form-label" style={{ fontSize: '0.82rem' }}>Administrator Email</label>
            <input
              type="email"
              className="form-input"
              placeholder={`admin@${tenant.domain?.domainName || 'company.com'}`}
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label className="form-label" style={{ fontSize: '0.82rem' }}>Temporary Password (min 8 characters)</label>
            <input
              type="password"
              className="form-input"
              placeholder="••••••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              Close
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={formLoading || !newEmail.trim() || newPassword.length < 8}
            >
              {formLoading ? 'Adding...' : 'Add Administrator'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

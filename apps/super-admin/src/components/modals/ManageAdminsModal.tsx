import React, { useState, useEffect } from 'react';
import { X, Users, KeyRound, Plus } from 'lucide-react';
import { api } from '../../api';
import { TenantSummary } from '../../types';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';

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
      setSuccessMsg('Tenant administrator created successfully.');
      await loadAdmins();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to create administrator.');
    } finally {
      setFormLoading(false);
    }
  };

  const handleResetPassword = async (adminId: string) => {
    if (!resetPasswordInput || resetPasswordInput.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setFormLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      await api.resetTenantAdminPassword(tenant.id, adminId, resetPasswordInput);
      setSuccessMsg('Administrator password reset successfully.');
      setResettingAdminId(null);
      setResetPasswordInput('');
      await loadAdmins();
    } catch (err: any) {
      setError(err.message || 'Failed to reset password.');
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="modal-backdrop-mock">
      <div className="modal-card max-w-xl">
        {/* Header */}
        <div className="modal-header">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
              <Users size={16} />
            </div>
            <div>
              <h3 className="modal-title">Manage Administrators</h3>
              <p className="text-xs text-slate-500 mt-0.5 font-mono">{tenant.name} ({tenant.domain?.domainName})</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close-btn">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body space-y-4">
          {error && <Alert type="error" message={error} onClose={() => setError(null)} />}
          {successMsg && <Alert type="success" message={successMsg} onClose={() => setSuccessMsg(null)} />}

          {/* Current Admins List */}
          <div>
            <div className="text-xs font-semibold text-slate-800 mb-2">Active Administrators</div>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              {loading ? (
                <div className="p-6 text-center text-xs text-slate-400">Loading administrators...</div>
              ) : admins.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">No administrators assigned yet.</div>
              ) : (
                <div className="divide-y divide-slate-100 text-xs">
                  {admins.map((adm) => (
                    <div key={adm._id || adm.id} className="p-3 flex items-center justify-between hover:bg-slate-50">
                      <div>
                        <div className="font-semibold text-slate-900">{adm.email}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          ID: {(adm._id || adm.id).slice(-8)} · Role: {adm.role || 'TENANT_ADMIN'}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setResettingAdminId(resettingAdminId === (adm._id || adm.id) ? null : (adm._id || adm.id));
                          setResetPasswordInput('');
                        }}
                      >
                        <KeyRound size={12} />
                        <span>Reset Password</span>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Inline Reset Password Form */}
          {resettingAdminId && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
              <label className="field-label mb-1">Set New Password for Selected Admin</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="Min. 8 characters"
                  value={resetPasswordInput}
                  onChange={(e) => setResetPasswordInput(e.target.value)}
                  className="form-input flex-1 h-8 text-xs font-mono"
                />
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => handleResetPassword(resettingAdminId)}
                  loading={formLoading}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setResettingAdminId(null);
                    setResetPasswordInput('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Add New Admin Form */}
          <form onSubmit={handleCreateAdmin} className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
            <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
              <Plus size={14} className="text-indigo-600" />
              <span>Add Tenant Administrator</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="newAdminEmail">Admin Email</label>
                <input
                  id="newAdminEmail"
                  type="email"
                  required
                  placeholder={`admin@${tenant.domain?.domainName || 'domain.com'}`}
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="form-input text-xs"
                />
              </div>

              <div>
                <label className="field-label" htmlFor="newAdminPass">Initial Password</label>
                <input
                  id="newAdminPass"
                  type="password"
                  required
                  minLength={8}
                  placeholder="Min. 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="form-input text-xs font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={formLoading}
              >
                Create Administrator
              </Button>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};

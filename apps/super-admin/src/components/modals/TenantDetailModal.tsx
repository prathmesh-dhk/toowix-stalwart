import React, { useState, useEffect } from 'react';
import { TenantSummary } from '../../types';
import { api } from '../../api';
import {
  X,
  Users,
  PauseCircle,
  PlayCircle,
  KeyRound,
  Sliders,
  Trash2,
  Building2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { StatusBadge } from '../ui/StatusBadge';

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

  const usagePercent = Math.min(100, Math.round(((tenant.mailboxCount || 0) / Math.max(1, tenant.mailboxLimit)) * 100));

  return (
    <div className="modal-backdrop-mock">
      <div className="modal-card max-w-2xl">
        {/* Header */}
        <div className="modal-header">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
              <Building2 size={16} />
            </div>
            <div>
              <h3 className="modal-title">{tenant.name}</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Tenant ID: <span className="font-medium text-slate-700">{tenant.id}</span>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close-btn">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body space-y-4">
          {passwordResetSuccess && (
            <Alert type="success" message={passwordResetSuccess} />
          )}
          {adminError && (
            <Alert type="error" message={adminError} onClose={() => setAdminError(null)} />
          )}

          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-3 gap-3">
            {/* Status */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-[11px] text-slate-500 mb-1">Tenant Status</div>
              {tenant.status === 'active' && <StatusBadge status="success">Active</StatusBadge>}
              {tenant.status === 'approved_pending_setup' && <StatusBadge status="warning">Pending Setup</StatusBadge>}
              {tenant.status === 'suspended' && <StatusBadge status="danger">Suspended</StatusBadge>}
            </div>

            {/* Quota */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-[11px] text-slate-500 mb-1">Mailbox Quota</div>
              <div className="font-semibold text-slate-900 text-xs tabular-nums">
                {tenant.mailboxCount || 0} / {tenant.mailboxLimit} ({usagePercent}%)
              </div>
              <div className="progress-bar-bg mt-2">
                <div
                  className={`h-full rounded-full ${usagePercent > 85 ? 'bg-red-500' : 'bg-indigo-600'}`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
            </div>

            {/* Domain */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-[11px] text-slate-500 mb-1">Primary Domain</div>
              <div className="font-semibold text-indigo-600 text-xs truncate">
                {tenant.domain?.domainName || 'No domain'}
              </div>
            </div>
          </div>

          {/* Administrators Section */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-900">Assigned Administrators</span>
              <span className="text-[11px] text-slate-400 tabular-nums">{admins.length} total</span>
            </div>

            {loadingAdmins ? (
              <div className="p-6 text-center text-xs text-slate-400">Loading administrators...</div>
            ) : admins.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">No administrators assigned yet.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {admins.map((adm) => (
                  <div key={adm._id || adm.id} className="p-3 flex items-center justify-between text-xs hover:bg-slate-50">
                    <div>
                      <div className="font-medium text-slate-900">{adm.email}</div>
                      <div className="text-[10px] text-slate-400">Role: {adm.role || 'TENANT_ADMIN'}</div>
                    </div>
                    <div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setResettingAdminId(resettingAdminId === (adm._id || adm.id) ? null : (adm._id || adm.id))}
                      >
                        <KeyRound size={12} />
                        <span>Reset Password</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Inline Reset Password Form */}
          {resettingAdminId && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
              <label className="field-label mb-1">New Password for Administrator</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="Min. 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="form-input flex-1 h-8 text-xs"
                />
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => handleResetPassword(resettingAdminId)}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setResettingAdminId(null);
                    setNewPassword('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer with Actions */}
        <div className="modal-footer flex justify-between items-center">
          <div className="flex gap-1.5">
            {onToggleSuspend && tenant.status === 'active' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onToggleSuspend(tenant)}
                className="text-amber-600 hover:text-amber-700"
              >
                <PauseCircle size={13} />
                <span>Suspend</span>
              </Button>
            )}
            {onToggleSuspend && tenant.status === 'suspended' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onToggleSuspend(tenant)}
                className="text-emerald-600 hover:text-emerald-700"
              >
                <PlayCircle size={13} />
                <span>Reactivate</span>
              </Button>
            )}
            {onUpdateQuota && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onUpdateQuota(tenant)}
              >
                <Sliders size={13} />
                <span>Quota</span>
              </Button>
            )}
            {onManageAdmins && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onManageAdmins(tenant)}
              >
                <Users size={13} />
                <span>Admins</span>
              </Button>
            )}
            {onDeleteTenant && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDeleteTenant(tenant)}
                className="text-red-500 hover:text-red-700 hover:bg-red-50"
              >
                <Trash2 size={13} />
              </Button>
            )}
          </div>

          <Button
            size="md"
            variant="secondary"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};

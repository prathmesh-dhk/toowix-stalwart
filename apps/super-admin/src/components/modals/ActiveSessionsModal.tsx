import React, { useState, useEffect, useCallback } from 'react';
import {
  Smartphone,
  Tablet,
  Laptop,
  Globe,
  Clock,
  LogOut,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  MapPin,
} from 'lucide-react';
import { api } from '../../api';
import { SessionItem } from '../../types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';

interface ActiveSessionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ActiveSessionsModal: React.FC<ActiveSessionsModalProps> = ({ isOpen, onClose }) => {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirmRevokeOthers, setConfirmRevokeOthers] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listSessions();
      setSessions(res.sessions || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load active sessions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchSessions();
      setConfirmRevokeOthers(false);
      setFeedback(null);
    }
  }, [isOpen, fetchSessions]);

  const handleRevokeSingle = async (sessionId: string) => {
    setRevokingId(sessionId);
    setError(null);
    setFeedback(null);
    try {
      await api.revokeSession(sessionId);
      setFeedback('Device signed out successfully.');
      // Update state locally
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    } catch (err: any) {
      setError(err.message || 'Failed to revoke device session.');
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeOthers = async () => {
    setRevokingOthers(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await api.revokeOtherSessions();
      setFeedback(res.message || 'Signed out from all other devices.');
      setConfirmRevokeOthers(false);
      // Keep only current session
      setSessions((prev) => prev.filter((s) => s.isCurrent));
    } catch (err: any) {
      setError(err.message || 'Failed to revoke other sessions.');
    } finally {
      setRevokingOthers(false);
    }
  };

  const getDeviceIcon = (deviceType: string) => {
    switch (deviceType?.toLowerCase()) {
      case 'mobile':
        return <Smartphone className="w-5 h-5 text-indigo-500" />;
      case 'tablet':
        return <Tablet className="w-5 h-5 text-indigo-500" />;
      case 'desktop':
      default:
        return <Laptop className="w-5 h-5 text-indigo-600" />;
    }
  };

  const formatActivityTime = (dateStr: string, isCurrent: boolean) => {
    if (isCurrent) return 'Active now (This device)';
    if (!dateStr) return 'Recently active';
    try {
      const date = new Date(dateStr);
      const diffMs = Date.now() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 2) return 'Active 1 minute ago';
      if (diffMins < 60) return `Active ${diffMins} minutes ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `Active ${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays === 1) return 'Active yesterday';
      return `Active on ${date.toLocaleDateString()}`;
    } catch {
      return 'Recently active';
    }
  };

  const otherSessionsCount = sessions.filter((s) => !s.isCurrent).length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Active Devices & Sessions" maxWidth="max-w-2xl">
      <div className="space-y-4">
        {/* Banner with Overview & Bulk Revoke */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900">
                {sessions.length} Logged-in {sessions.length === 1 ? 'Session' : 'Sessions'}
              </h4>
              <p className="text-xs text-slate-500">
                Manage and terminate active sessions across browsers and devices.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchSessions}
              disabled={loading}
              className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors"
              title="Refresh sessions list"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {otherSessionsCount > 0 && !confirmRevokeOthers && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmRevokeOthers(true)}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
              >
                <LogOut className="w-3.5 h-3.5 mr-1.5" />
                Sign out other devices ({otherSessionsCount})
              </Button>
            )}
          </div>
        </div>

        {/* Confirmation bar for revoking others */}
        {confirmRevokeOthers && (
          <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-red-900 text-xs">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
              <span>
                Are you sure you want to sign out of <strong>{otherSessionsCount}</strong> other device{otherSessionsCount === 1 ? '' : 's'}? You will remain signed in here.
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="danger"
                size="sm"
                loading={revokingOthers}
                onClick={handleRevokeOthers}
              >
                Confirm Sign Out
              </Button>
              <button
                type="button"
                onClick={() => setConfirmRevokeOthers(false)}
                className="px-2.5 py-1 text-slate-600 hover:text-slate-900 font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Error / Feedback Alerts */}
        {error && <Alert type="error" message={error} onClose={() => setError(null)} />}
        {feedback && <Alert type="success" message={feedback} onClose={() => setFeedback(null)} />}

        {/* Sessions List */}
        <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
          {loading && sessions.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
              <span>Loading logged-in devices...</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              No active sessions detected.
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.sessionId}
                className={`p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  session.isCurrent
                    ? 'bg-emerald-50/40 border-emerald-200 shadow-sm'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${
                      session.isCurrent
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    {getDeviceIcon(session.deviceType)}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-slate-900 truncate">
                        {session.browser || 'Web Browser'} on {session.os || 'Unknown OS'}
                      </span>

                      {session.isCurrent && (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          This Device
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3 text-xs text-slate-500 mt-1 flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <Globe className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-mono">{session.ipAddress}</span>
                      </span>

                      {session.location && (
                        <>
                          <span className="hidden sm:inline">•</span>
                          <span className="inline-flex items-center gap-1 text-slate-600 font-medium">
                            <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                            <span>{session.location}</span>
                          </span>
                        </>
                      )}

                      <span className="hidden sm:inline">•</span>

                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>{formatActivityTime(session.lastActiveAt, session.isCurrent)}</span>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end w-full sm:w-auto flex-shrink-0 pt-1 sm:pt-0">
                  {session.isCurrent ? (
                    <span className="text-xs text-emerald-600 font-medium px-2 py-1">
                      Current
                    </span>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={revokingId === session.sessionId}
                      onClick={() => handleRevokeSingle(session.sessionId)}
                      className="w-full sm:w-auto min-h-[38px] text-slate-600 hover:text-red-600 hover:bg-red-50 border-slate-200 hover:border-red-200 text-xs"
                      title="Log out this device"
                    >
                      <LogOut className="w-3.5 h-3.5 mr-1" />
                      Sign out
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer info note */}
        <div className="pt-2 border-t border-slate-100 text-xs text-slate-400 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          <span>
            Sessions automatically expire after 8 hours (or 30 days if "Remember me" was selected).
          </span>
          <Button variant="secondary" size="md" className="w-full sm:w-auto min-h-[44px]" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
};

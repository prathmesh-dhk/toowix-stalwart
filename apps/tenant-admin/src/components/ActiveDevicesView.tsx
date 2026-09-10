import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Laptop,
  Smartphone,
  Tablet,
  Globe,
  Clock,
  LogOut,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Search,
  Monitor,
  MapPin,
} from 'lucide-react';
import { api } from '../api';
import { SessionItem } from '../types';
import { Button } from './ui/Button';
import { Alert } from './ui/Alert';

export const ActiveDevicesView: React.FC = () => {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirmRevokeOthers, setConfirmRevokeOthers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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
    fetchSessions();
  }, [fetchSessions]);

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingId(sessionId);
    setError(null);
    setFeedback(null);
    try {
      await api.revokeSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
      setFeedback('Device signed out successfully.');
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
      setSessions((prev) => prev.filter((s) => s.isCurrent));
      setConfirmRevokeOthers(false);
      setFeedback(res.message || 'Signed out from all other devices.');
    } catch (err: any) {
      setError(err.message || 'Failed to sign out other devices.');
    } finally {
      setRevokingOthers(false);
    }
  };

  const getDeviceIcon = (deviceType: string) => {
    switch (deviceType?.toLowerCase()) {
      case 'mobile':
        return <Smartphone size={20} className="text-indigo-600" />;
      case 'tablet':
        return <Tablet size={20} className="text-purple-600" />;
      case 'desktop':
        return <Laptop size={20} className="text-indigo-600" />;
      default:
        return <Globe size={20} className="text-slate-600" />;
    }
  };

  const formatActivity = (dateStr: string, isCurrent: boolean) => {
    if (isCurrent) return 'Active now (This device)';
    try {
      const date = new Date(dateStr);
      const diffMs = Date.now() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    } catch {
      return dateStr;
    }
  };

  const currentSession = useMemo(() => sessions.find((s) => s.isCurrent), [sessions]);
  const otherSessions = useMemo(() => sessions.filter((s) => !s.isCurrent), [sessions]);
  const otherSessionsCount = otherSessions.length;

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase().trim();
    return sessions.filter(
      (s) =>
        s.browser?.toLowerCase().includes(q) ||
        s.os?.toLowerCase().includes(q) ||
        s.ipAddress?.toLowerCase().includes(q) ||
        s.location?.toLowerCase().includes(q) ||
        s.deviceType?.toLowerCase().includes(q)
    );
  }, [sessions, searchQuery]);

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100 shrink-0">
            <Monitor size={26} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">
              Active Devices & Logged-in Sessions
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Manage browsers, mobile devices, and active administrative sessions logged in to your tenant account.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={fetchSessions}
            disabled={loading}
            icon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
          >
            Refresh
          </Button>

          {otherSessionsCount > 0 && !confirmRevokeOthers && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmRevokeOthers(true)}
              icon={<LogOut size={14} />}
            >
              Sign out other devices ({otherSessionsCount})
            </Button>
          )}
        </div>
      </div>

      {/* Confirmation Banner for Revoking Others */}
      {confirmRevokeOthers && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-4 text-xs animate-in fade-in">
          <div className="flex items-center gap-2.5 text-red-800">
            <AlertTriangle size={18} className="text-red-600 shrink-0" />
            <span>
              Are you sure you want to sign out of <strong>{otherSessionsCount}</strong> other device
              {otherSessionsCount === 1 ? '' : 's'}? You will remain signed in on this current browser.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmRevokeOthers(false)}
              disabled={revokingOthers}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleRevokeOthers}
              loading={revokingOthers}
            >
              Confirm Sign Out All
            </Button>
          </div>
        </div>
      )}

      {/* Alert Feedbacks */}
      {feedback && (
        <Alert type="success" message={feedback} onClose={() => setFeedback(null)} />
      )}
      {error && (
        <Alert type="error" message={error} onClose={() => setError(null)} />
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Active Sessions</span>
            <div className="text-2xl font-bold text-slate-900 mt-1">{sessions.length}</div>
          </div>
          <div className="h-10 w-10 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600">
            <Monitor size={20} />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Current Device</span>
            <div className="text-sm font-semibold text-slate-900 mt-1">
              {currentSession ? `${currentSession.browser || 'Browser'} on ${currentSession.os || 'OS'}` : 'This Browser'}
            </div>
            <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Active Now ({currentSession?.ipAddress || '127.0.0.1'})
            </span>
          </div>
          <div className="h-10 w-10 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-600">
            <ShieldCheck size={20} />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Other Authorized Devices</span>
            <div className="text-2xl font-bold text-slate-900 mt-1">{otherSessionsCount}</div>
            <span className="text-[11px] text-slate-400">Can be revoked remotely anytime</span>
          </div>
          <div className="h-10 w-10 bg-amber-50 rounded-lg flex items-center justify-center text-amber-600">
            <Smartphone size={20} />
          </div>
        </div>
      </div>

      {/* Main Sessions Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Table Controls */}
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50/50">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by browser, OS, device, or IP..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
            />
          </div>

          <div className="text-xs text-slate-500">
            Showing <strong className="text-slate-800">{filteredSessions.length}</strong> of{' '}
            <strong className="text-slate-800">{sessions.length}</strong> session{sessions.length === 1 ? '' : 's'}
          </div>
        </div>

        {/* Sessions List */}
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-3">
            <RefreshCw size={24} className="animate-spin text-indigo-600" />
            <span className="text-xs font-medium text-slate-600">Loading authorized devices...</span>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-2">
            <Globe size={32} className="text-slate-300" />
            <span className="text-sm font-semibold text-slate-700">No active devices found</span>
            <span className="text-xs text-slate-500">
              {searchQuery ? 'Try clearing your search query.' : 'There are no active sessions registered.'}
            </span>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredSessions.map((session) => {
              const isCurrent = session.isCurrent;
              const isRevokingThis = revokingId === session.sessionId;

              return (
                <div
                  key={session.sessionId}
                  className={`p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                    isCurrent ? 'bg-indigo-50/20' : 'hover:bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs shrink-0 mt-0.5">
                      {getDeviceIcon(session.deviceType)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-900">
                          {session.browser || 'Unknown Browser'} on {session.os || 'Unknown OS'}
                        </span>
                        {isCurrent ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            This Device (Current Session)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 uppercase tracking-wider">
                            {session.deviceType}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-500 flex-wrap">
                        <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px] text-slate-700 border border-slate-200/60 tabular-nums font-medium">
                          IP: {session.ipAddress}
                        </span>
                        {session.location && (
                          <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px] text-slate-700 border border-slate-200/60 font-medium inline-flex items-center gap-1">
                            <MapPin size={11} className="text-indigo-500 shrink-0" />
                            <span>{session.location}</span>
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock size={12} className="text-slate-400" />
                          <span>{formatActivity(session.lastActiveAt, isCurrent)}</span>
                        </span>
                        <span className="text-slate-400">•</span>
                        <span>Signed in: {new Date(session.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                    {isCurrent ? (
                      <span className="text-xs text-slate-400 italic px-3 py-1 bg-slate-50 rounded-md border border-slate-200/60">
                        Current active device
                      </span>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleRevokeSession(session.sessionId)}
                        loading={isRevokingThis}
                        disabled={isRevokingThis || revokingOthers}
                        icon={<LogOut size={13} />}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 hover:border-red-200"
                      >
                        Sign out device
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

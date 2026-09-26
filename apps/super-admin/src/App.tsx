import React, { useState, useEffect } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { api, getStoredToken, clearStoredToken } from './api';
import { UserContext } from './types';
import { SuperAdminLoginView } from './components/SuperAdminLoginView';
import { ForgotPasswordView } from './components/ForgotPasswordView';
import { PlatformAdminDashboard, DashboardTab } from './components/PlatformAdminDashboard';
import { TenantDetailSubTab } from './components/views/TenantDetailView';
import { ErrorBoundary } from './components/ErrorBoundary';

interface DashboardRouteProps {
  tab: DashboardTab;
  user: UserContext;
  onLogout: () => void;
  onUserUpdated: (u: UserContext) => void;
}

const DashboardRoute: React.FC<DashboardRouteProps> = ({
  tab,
  user,
  onLogout,
  onUserUpdated,
}) => {
  const navigate = useNavigate();

  return (
    <ErrorBoundary fallbackTitle="Unable to load dashboard" onReset={() => navigate('/dashboard')}>
      <PlatformAdminDashboard
        user={user}
        onLogout={onLogout}
        onUserUpdated={onUserUpdated}
        activeTab={tab}
        onTabChange={(newTab) => navigate(`/${newTab}`)}
        selectedTenantId={null}
        onSelectTenant={(tenantId) => {
          if (tenantId) {
            navigate(`/tenants/${tenantId}`);
          } else {
            navigate('/tenants');
          }
        }}
      />
    </ErrorBoundary>
  );
};

interface TenantDetailRouteProps {
  user: UserContext;
  onLogout: () => void;
  onUserUpdated: (u: UserContext) => void;
}

const TenantDetailRoute: React.FC<TenantDetailRouteProps> = ({
  user,
  onLogout,
  onUserUpdated,
}) => {
  const { tenantId, subTab } = useParams<{ tenantId: string; subTab?: string }>();
  const navigate = useNavigate();

  const validSubTabs: TenantDetailSubTab[] = ['domains', 'mailboxes', 'admins', 'audit', 'governance'];
  const activeSubTab: TenantDetailSubTab = validSubTabs.includes(subTab as TenantDetailSubTab)
    ? (subTab as TenantDetailSubTab)
    : 'domains';

  return (
    <ErrorBoundary fallbackTitle="Unable to load tenant details" onReset={() => navigate('/tenants')}>
      <PlatformAdminDashboard
        user={user}
        onLogout={onLogout}
        onUserUpdated={onUserUpdated}
        activeTab="tenants"
        onTabChange={(tab) => navigate(`/${tab}`)}
        selectedTenantId={tenantId || null}
        onSelectTenant={(tId) => {
          if (tId) {
            navigate(`/tenants/${tId}`);
          } else {
            navigate('/tenants');
          }
        }}
        tenantSubTab={activeSubTab}
        onTenantSubTabChange={(st) => {
          if (tenantId) {
            navigate(`/tenants/${tenantId}/${st}`);
          }
        }}
      />
    </ErrorBoundary>
  );
};

const AppContent: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<UserContext | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState<string | undefined>();
  const navigate = useNavigate();

  useEffect(() => {
    const initAuth = async () => {
      const token = getStoredToken();
      if (!token) {
        setCheckingAuth(false);
        return;
      }

      try {
        const res = await api.getMe();
        if (res.user.role === 'SUPER_ADMIN') {
          setCurrentUser(res.user);
        } else {
          console.warn('Non-Super-Admin user attempted session on Super Admin portal');
          clearStoredToken();
          setCurrentUser(null);
        }
      } catch (err) {
        console.warn('Stored session invalid or expired:', err);
        clearStoredToken();
        setCurrentUser(null);
      } finally {
        setCheckingAuth(false);
      }
    };

    initAuth();
  }, []);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    } finally {
      try {
        sessionStorage.removeItem('toowix_dismissed_2fa_banner');
      } catch {
        // ignore
      }
      clearStoredToken();
      setCurrentUser(null);
      navigate('/login');
    }
  };

  if (checkingAuth) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-base)',
          color: 'var(--text-muted)',
        }}
      >
        Loading...
      </div>
    );
  }

  return (
    <Routes>
      {/* Public Auth Routes */}
      <Route
        path="/login"
        element={
          currentUser ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <SuperAdminLoginView
              onSuccess={(user) => {
                setCurrentUser(user);
                navigate('/dashboard');
              }}
              onForgotPassword={(email?: string) => {
                setForgotPasswordEmail(email);
                navigate('/forgot-password');
              }}
            />
          )
        }
      />
      <Route
        path="/forgot-password"
        element={
          currentUser ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <ForgotPasswordView
              onBackToLogin={() => {
                setForgotPasswordEmail(undefined);
                navigate('/login');
              }}
              portalName="Super Admin"
              themeColor="#6366f1"
              initialEmail={forgotPasswordEmail}
            />
          )
        }
      />

      {/* Protected Dashboard Routes */}
      <Route
        path="/dashboard"
        element={
          currentUser ? (
            <DashboardRoute
              tab="dashboard"
              user={currentUser}
              onLogout={handleLogout}
              onUserUpdated={(u) => setCurrentUser(u)}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/deleted-organisations"
        element={
          currentUser ? (
            <DashboardRoute
              tab="deleted-organisations"
              user={currentUser}
              onLogout={handleLogout}
              onUserUpdated={(u) => setCurrentUser(u)}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/tenants"
        element={
          currentUser ? (
            <DashboardRoute
              tab="tenants"
              user={currentUser}
              onLogout={handleLogout}
              onUserUpdated={(u) => setCurrentUser(u)}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/tenants/:tenantId"
        element={
          currentUser ? (
            <TenantDetailRoute
              user={currentUser}
              onLogout={handleLogout}
              onUserUpdated={(u) => setCurrentUser(u)}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/tenants/:tenantId/:subTab"
        element={
          currentUser ? (
            <TenantDetailRoute
              user={currentUser}
              onLogout={handleLogout}
              onUserUpdated={(u) => setCurrentUser(u)}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/plans"
        element={
          currentUser ? (
            <DashboardRoute
              tab="plans"
              user={currentUser}
              onLogout={handleLogout}
              onUserUpdated={(u) => setCurrentUser(u)}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/coupons"
        element={
          currentUser ? (
            <DashboardRoute
              tab="coupons"
              user={currentUser}
              onLogout={handleLogout}
              onUserUpdated={(u) => setCurrentUser(u)}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/analytics"
        element={
          currentUser ? (
            <DashboardRoute
              tab="analytics"
              user={currentUser}
              onLogout={handleLogout}
              onUserUpdated={(u) => setCurrentUser(u)}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/operations"
        element={
          currentUser ? (
            <DashboardRoute
              tab="operations"
              user={currentUser}
              onLogout={handleLogout}
              onUserUpdated={(u) => setCurrentUser(u)}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/audit"
        element={
          currentUser ? (
            <DashboardRoute
              tab="audit"
              user={currentUser}
              onLogout={handleLogout}
              onUserUpdated={(u) => setCurrentUser(u)}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/devices"
        element={
          currentUser ? (
            <DashboardRoute
              tab="devices"
              user={currentUser}
              onLogout={handleLogout}
              onUserUpdated={(u) => setCurrentUser(u)}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      {/* Aliases & Redirects */}
      <Route path="/health" element={<Navigate to="/operations" replace />} />
      <Route path="/system-health" element={<Navigate to="/operations" replace />} />
      <Route path="/" element={<Navigate to={currentUser ? '/dashboard' : '/login'} replace />} />
      <Route path="*" element={<Navigate to={currentUser ? '/dashboard' : '/login'} replace />} />
    </Routes>
  );
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
};

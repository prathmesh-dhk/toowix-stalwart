import React, { useState, useEffect } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
  useParams,
} from 'react-router-dom';
import { api, getStoredToken, clearStoredToken } from './api';
import { UserContext } from './types';
import { TenantAdminLoginView } from './components/TenantAdminLoginView';
import { RegisterView } from './components/RegisterView';
import { ActivateTenantView } from './components/ActivateTenantView';
import { TenantAdminDashboard } from './components/TenantAdminDashboard';
import { TenantHomeView } from './components/TenantHomeView';
import { ForgotPasswordView } from './components/ForgotPasswordView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CartPage } from './components/cart/CartPage';

const DomainRouteWrapper: React.FC<{
  user: UserContext;
  onLogout: () => void;
  onNavigateHome: () => void;
  onSelectDomain: (dId: string) => void;
  onNavChange: (dId: string, nav: string) => void;
}> = ({ user, onLogout, onNavigateHome, onSelectDomain, onNavChange }) => {
  const { domainId, nav } = useParams<{ domainId: string; nav?: string }>();
  const isModerator = user.role === 'TENANT_MODERATOR';

  // Map sub-route names to valid activeNav values
  let activeNav: 'dashboard' | 'mailboxes' | 'storage' | 'billing' | 'domains' | 'security' | 'team' =
    isModerator ? 'mailboxes' : 'dashboard';

  if (nav === 'mailboxes') activeNav = 'mailboxes';
  else if (nav === 'security') activeNav = 'security';
  else if (nav === 'dns') activeNav = 'domains';
  else if (nav === 'storage' && !isModerator) activeNav = 'storage';
  else if (nav === 'billing' && !isModerator) activeNav = 'billing';
  else if (nav === 'dashboard' && !isModerator) activeNav = 'dashboard';

  const handleNavChange = (newNav: 'dashboard' | 'mailboxes' | 'storage' | 'billing' | 'domains' | 'security' | 'team') => {
    const subpath = newNav === 'domains' ? 'dns' : newNav;
    onNavChange(domainId || '', subpath);
  };

  return (
    <ErrorBoundary fallbackTitle="Unable to load domain view" onReset={onNavigateHome}>
      <TenantAdminDashboard
        domainId={domainId || ''}
        user={user}
        onLogout={onLogout}
        onNavigateHome={onNavigateHome}
        onSelectDomain={onSelectDomain}
        activeNav={activeNav}
        onNavChange={handleNavChange}
      />
    </ErrorBoundary>
  );
};

export const AppContent: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<UserContext | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState<string | undefined>();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const initAuth = async () => {
      const token = getStoredToken();
      if (!token) {
        setCheckingAuth(false);
        return;
      }

      try {
        const res = await api.getMe();
        if (res.user.role === 'TENANT_ADMIN' || res.user.role === 'TENANT_MODERATOR') {
          setCurrentUser(res.user);
        } else {
          console.warn('Unauthorized role attempted session on Tenant Admin portal');
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

  const handleCartBack = () => {
    const params = new URLSearchParams(location.search);
    const returnTo = params.get('returnTo') || (location.state as any)?.returnTo;
    if (returnTo && returnTo !== '/cart') {
      navigate(returnTo);
    } else if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/overview');
    }
  };

  if (checkingAuth) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
        color: 'var(--text-muted)'
      }}>
        Loading...
      </div>
    );
  }

  // Unauthenticated routes
  if (!currentUser) {
    return (
      <Routes>
        <Route
          path="/activate"
          element={
            <ActivateTenantView
              onSuccess={(user) => {
                setCurrentUser(user);
                navigate('/overview');
              }}
              onBackToLogin={() => navigate('/login')}
            />
          }
        />
        <Route
          path="/register"
          element={
            <RegisterView
              onBackToLogin={() => navigate('/login')}
              onSuccess={(user) => {
                setCurrentUser(user);
                navigate('/overview');
              }}
            />
          }
        />
        <Route
          path="/forgot-password"
          element={
            <ForgotPasswordView
              onBackToLogin={() => navigate('/login')}
              portalName="Admin"
              themeColor="#10b981"
              initialEmail={forgotPasswordEmail}
            />
          }
        />
        <Route
          path="*"
          element={
            <TenantAdminLoginView
              onSuccess={(user) => {
                setCurrentUser(user);
                if (user.role === 'TENANT_MODERATOR') {
                  navigate('/domains');
                } else {
                  navigate('/overview');
                }
              }}
              onGoToRegister={() => navigate('/register')}
              onForgotPassword={(email) => {
                setForgotPasswordEmail(email);
                navigate('/forgot-password');
              }}
            />
          }
        />
      </Routes>
    );
  }

  // Authenticated routes
  const isModerator = currentUser.role === 'TENANT_MODERATOR';

  return (
    <Routes>
      {/* Cart Page */}
      <Route
        path="/cart"
        element={
          isModerator ? (
            <Navigate to="/domains" replace />
          ) : (
            <ErrorBoundary fallbackTitle="Unable to load your cart" onReset={() => navigate('/overview')}>
              <CartPage onBack={handleCartBack} user={currentUser} onLogout={handleLogout} />
            </ErrorBoundary>
          )
        }
      />

      {/* Domain Routes */}
      <Route
        path="/domains/:domainId/:nav?"
        element={
          <DomainRouteWrapper
            user={currentUser}
            onLogout={handleLogout}
            onNavigateHome={() => navigate(isModerator ? '/domains' : '/overview')}
            onSelectDomain={(dId) => navigate(`/domains/${dId}/${isModerator ? 'mailboxes' : 'dashboard'}`)}
            onNavChange={(dId, nav) => navigate(`/domains/${dId}/${nav}`)}
          />
        }
      />

      {/* Organization Routes (Tenant Admin only) */}
      <Route
        path="/overview"
        element={
          isModerator ? (
            <Navigate to="/domains" replace />
          ) : (
            <ErrorBoundary fallbackTitle="Unable to load workspace" onReset={() => navigate('/overview')}>
              <TenantHomeView
                user={currentUser}
                onLogout={handleLogout}
                onNavigateToDomain={(dId) => navigate(`/domains/${dId}/dashboard`)}
                activeTab="overview"
                onTabChange={(tab) => navigate(`/${tab}`)}
              />
            </ErrorBoundary>
          )
        }
      />
      <Route
        path="/domains"
        element={
          isModerator ? (
            // For a moderator, /domains with no domainId resolves through TenantAdminDashboard domainId=""
            <ErrorBoundary fallbackTitle="Unable to load domain view" onReset={() => navigate('/domains')}>
              <TenantAdminDashboard
                domainId=""
                user={currentUser}
                onLogout={handleLogout}
                onNavigateHome={() => navigate('/domains')}
                onSelectDomain={(dId) => navigate(`/domains/${dId}/mailboxes`)}
                activeNav="mailboxes"
                onNavChange={(_nav) => {}}
              />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary fallbackTitle="Unable to load workspace" onReset={() => navigate('/overview')}>
              <TenantHomeView
                user={currentUser}
                onLogout={handleLogout}
                onNavigateToDomain={(dId) => navigate(`/domains/${dId}/dashboard`)}
                activeTab="domains"
                onTabChange={(tab) => navigate(`/${tab}`)}
              />
            </ErrorBoundary>
          )
        }
      />
      <Route
        path="/billing"
        element={
          isModerator ? (
            <Navigate to="/domains" replace />
          ) : (
            <ErrorBoundary fallbackTitle="Unable to load workspace" onReset={() => navigate('/overview')}>
              <TenantHomeView
                user={currentUser}
                onLogout={handleLogout}
                onNavigateToDomain={(dId) => navigate(`/domains/${dId}/dashboard`)}
                activeTab="billing"
                onTabChange={(tab) => navigate(`/${tab}`)}
              />
            </ErrorBoundary>
          )
        }
      />
      <Route
        path="/security"
        element={
          isModerator ? (
            <Navigate to="/domains" replace />
          ) : (
            <ErrorBoundary fallbackTitle="Unable to load workspace" onReset={() => navigate('/overview')}>
              <TenantHomeView
                user={currentUser}
                onLogout={handleLogout}
                onNavigateToDomain={(dId) => navigate(`/domains/${dId}/dashboard`)}
                activeTab="security"
                onTabChange={(tab) => navigate(`/${tab}`)}
              />
            </ErrorBoundary>
          )
        }
      />
      <Route
        path="/team"
        element={
          isModerator ? (
            <Navigate to="/domains" replace />
          ) : (
            <ErrorBoundary fallbackTitle="Unable to load workspace" onReset={() => navigate('/overview')}>
              <TenantHomeView
                user={currentUser}
                onLogout={handleLogout}
                onNavigateToDomain={(dId) => navigate(`/domains/${dId}/dashboard`)}
                activeTab="team"
                onTabChange={(tab) => navigate(`/${tab}`)}
              />
            </ErrorBoundary>
          )
        }
      />
      <Route
        path="/apikeys"
        element={
          isModerator ? (
            <Navigate to="/domains" replace />
          ) : (
            <ErrorBoundary fallbackTitle="Unable to load workspace" onReset={() => navigate('/overview')}>
              <TenantHomeView
                user={currentUser}
                onLogout={handleLogout}
                onNavigateToDomain={(dId) => navigate(`/domains/${dId}/dashboard`)}
                activeTab="apikeys"
                onTabChange={(tab) => navigate(`/${tab}`)}
              />
            </ErrorBoundary>
          )
        }
      />
      <Route
        path="/audit"
        element={
          isModerator ? (
            <Navigate to="/domains" replace />
          ) : (
            <ErrorBoundary fallbackTitle="Unable to load workspace" onReset={() => navigate('/overview')}>
              <TenantHomeView
                user={currentUser}
                onLogout={handleLogout}
                onNavigateToDomain={(dId) => navigate(`/domains/${dId}/dashboard`)}
                activeTab="audit"
                onTabChange={(tab) => navigate(`/${tab}`)}
              />
            </ErrorBoundary>
          )
        }
      />
      <Route
        path="/devices"
        element={
          isModerator ? (
            <Navigate to="/domains" replace />
          ) : (
            <ErrorBoundary fallbackTitle="Unable to load workspace" onReset={() => navigate('/overview')}>
              <TenantHomeView
                user={currentUser}
                onLogout={handleLogout}
                onNavigateToDomain={(dId) => navigate(`/domains/${dId}/dashboard`)}
                activeTab="devices"
                onTabChange={(tab) => navigate(`/${tab}`)}
              />
            </ErrorBoundary>
          )
        }
      />

      {/* Root redirect */}
      <Route
        path="/"
        element={
          <Navigate to={isModerator ? '/domains' : '/overview'} replace />
        }
      />

      {/* Fallback */}
      <Route
        path="*"
        element={
          <Navigate to={isModerator ? '/domains' : '/overview'} replace />
        }
      />
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

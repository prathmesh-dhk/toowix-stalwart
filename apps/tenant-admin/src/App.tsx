import React, { useState, useEffect } from 'react';
import { api, getStoredToken, clearStoredToken } from './api';
import { UserContext } from './types';
import { TenantAdminLoginView } from './components/TenantAdminLoginView';
import { RegisterView } from './components/RegisterView';
import { ActivateTenantView } from './components/ActivateTenantView';
import { TenantAdminDashboard } from './components/TenantAdminDashboard';
import { ForgotPasswordView } from './components/ForgotPasswordView';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<UserContext | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState<string | undefined>();
  const [currentPath, setCurrentPath] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname;
    }
    return '/';
  });

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateToRegister = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/register');
    }
    setCurrentPath('/register');
  };

  const navigateToForgotPassword = (email?: string) => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/forgot-password');
    }
    setForgotPasswordEmail(email);
    setCurrentPath('/forgot-password');
  };

  const navigateToLogin = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/');
    }
    setCurrentPath('/');
  };

  useEffect(() => {
    const initAuth = async () => {
      const token = getStoredToken();
      if (!token) {
        setCheckingAuth(false);
        return;
      }

      try {
        const res = await api.getMe();
        if (res.user.role === 'TENANT_ADMIN') {
          setCurrentUser(res.user);
        } else {
          console.warn('Non-Tenant-Admin user attempted session on Tenant Admin portal');
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
      clearStoredToken();
      setCurrentUser(null);
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

  if (!currentUser) {
    if (currentPath === '/activate') {
      return (
        <ActivateTenantView
          onSuccess={(user) => {
            setCurrentUser(user);
            if (typeof window !== 'undefined') {
              window.history.pushState({}, '', '/');
              setCurrentPath('/');
            }
          }}
          onBackToLogin={navigateToLogin}
        />
      );
    }

    if (currentPath === '/register') {
      return <RegisterView onBackToLogin={navigateToLogin} />;
    }

    if (currentPath === '/forgot-password') {
      return (
        <ForgotPasswordView
          onBackToLogin={navigateToLogin}
          portalName="Tenant Admin"
          themeColor="#10b981"
          initialEmail={forgotPasswordEmail}
        />
      );
    }

    return (
      <TenantAdminLoginView
        onSuccess={(user) => setCurrentUser(user)}
        onGoToRegister={navigateToRegister}
        onForgotPassword={navigateToForgotPassword}
      />
    );
  }

  return (
    <TenantAdminDashboard user={currentUser} onLogout={handleLogout} />
  );
};

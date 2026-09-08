import React, { useState, useEffect } from 'react';
import { api, getStoredToken, clearStoredToken } from './api';
import { UserContext } from './types';
import { SuperAdminLoginView } from './components/SuperAdminLoginView';
import { ForgotPasswordView } from './components/ForgotPasswordView';
import { PlatformAdminDashboard } from './components/PlatformAdminDashboard';
import { ErrorBoundary } from './components/ErrorBoundary';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<UserContext | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState<string | undefined>();

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
    if (isForgotPassword) {
      return (
        <ForgotPasswordView
          onBackToLogin={() => {
            setIsForgotPassword(false);
            setForgotPasswordEmail(undefined);
          }}
          portalName="Super Admin"
          themeColor="#6366f1"
          initialEmail={forgotPasswordEmail}
        />
      );
    }

    return (
      <SuperAdminLoginView
        onSuccess={(user) => setCurrentUser(user)}
        onForgotPassword={(email?: string) => {
          setForgotPasswordEmail(email);
          setIsForgotPassword(true);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-quartz-900 font-sans antialiased">
      <ErrorBoundary fallbackTitle="Unable to load dashboard">
        <PlatformAdminDashboard
          user={currentUser}
          onLogout={handleLogout}
          onUserUpdated={(updated) => setCurrentUser(updated)}
        />
      </ErrorBoundary>
    </div>
  );
};

import React from 'react';
import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { APP_CONFIG } from '../lib/constants';

interface ProtectedRouteProps {
  children?: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, profile, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6 space-y-4">
        <div className="w-12 h-12 rounded-xl bg-primary text-white flex items-center justify-center shadow-md animate-pulse">
          <span className="material-symbols-outlined text-[28px]">school</span>
        </div>
        <div className="text-center space-y-1">
          <h3 className="font-display text-base font-bold text-slate-800">{APP_CONFIG.name}</h3>
          <p className="text-xs text-slate-500 font-mono">Verifying institutional credentials & session state...</p>
        </div>
        <div className="w-48 h-1 bg-surface-container rounded-full overflow-hidden">
          <div className="w-full h-full bg-primary animate-indeterminate"></div>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
};


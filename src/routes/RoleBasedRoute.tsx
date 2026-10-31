import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types/auth';

interface RoleBasedRouteProps {
  allowedRoles: UserRole[];
  children?: React.ReactNode;
}

export const RoleBasedRoute: React.FC<RoleBasedRouteProps> = ({ allowedRoles, children }) => {
  const { role, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!role || !allowedRoles.includes(role)) {
    // Redirect to the appropriate home workspace based on authenticated role
    if (role === 'student') {
      return <Navigate to="/student/dashboard" replace />;
    } else if (role === 'mentor') {
      return <Navigate to="/mentor/dashboard" replace />;
    } else if (role === 'admin') {
      return <Navigate to="/admin/dashboard" replace />;
    }
    return <Navigate to="/login" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
};


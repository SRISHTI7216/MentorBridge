import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { APP_CONFIG } from '../../lib/constants';
import { useAuth } from '../../context/AuthContext';
import { UserRole } from '../../types/auth';

interface NavbarProps {
  currentRole: UserRole;
  userName?: string;
  avatarUrl?: string;
  subtitle?: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentRole,
  userName,
  avatarUrl,
  subtitle,
}) => {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const displayName = userName || profile?.name || 'Institutional User';
  const displayAvatar = avatarUrl || profile?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=3525CD&color=fff`;

  const handleSignOut = async () => {
    setShowUserMenu(false);
    await signOut();
    navigate('/login', { replace: true });
  };

  const getRoleLabel = (role: UserRole) => {
    switch (role) {
      case 'mentor':
        return 'Faculty Mentor Portal';
      case 'student':
        return 'Student Development Portal';
      case 'admin':
        return 'Institutional Administration';
      default:
        return 'Academic Portal';
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'mentor':
        return 'Faculty Mentor';
      case 'student':
        return 'CSE Student';
      case 'admin':
        return 'Administrator';
      default:
        return role;
    }
  };

  return (
    <header className="bg-surface border-b border-outline-variant shadow-sm z-30 sticky top-0">
      <div className="flex justify-between items-center w-full px-4 sm:px-6 py-2.5 max-w-[1600px] mx-auto">
        {/* Left: Brand & Accreditation */}
        <div className="flex items-center gap-4">
          <Link to={`/${currentRole}/dashboard`} className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-lg bg-primary text-white flex items-center justify-center shadow-sm group-hover:bg-primary-hover transition-colors">
              <span className="material-symbols-outlined text-[22px]">terminal</span>
            </div>
            <div>
              <span className="font-display text-lg font-bold text-primary block leading-tight">
                {APP_CONFIG.name}
              </span>
              <span className="text-[10px] text-on-surface-variant font-medium hidden sm:block">
                {APP_CONFIG.shortName} • {APP_CONFIG.department}
              </span>
            </div>
          </Link>

          {/* Portal badge */}
          <div className="hidden lg:flex items-center space-x-2 pl-3 border-l border-outline-variant text-xs">
            <span className="px-2 py-0.5 rounded bg-primary-fixed text-primary font-semibold text-[11px] uppercase tracking-wide">
              {getRoleLabel(currentRole)}
            </span>
            <span className="text-on-surface-variant hidden xl:inline">|</span>
            <span className="text-on-surface-variant text-[11px] hidden xl:inline">
              {subtitle || APP_CONFIG.accreditation}
            </span>
          </div>
        </div>

        {/* Right: SSO status, Authenticated Role Badge, and User Menu with Logout */}
        <div className="flex items-center gap-3">
          {/* SSO Badge */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-lowest border border-outline-variant text-on-surface-variant text-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-tertiary"></span>
            </span>
            <span className="font-semibold text-[11px]">{APP_CONFIG.systemStatus}</span>
          </div>

          {/* Authenticated Role Tag (Read-only, reflecting verified session) */}
          <div className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-surface-container-low text-primary border border-outline-variant">
            <span className="material-symbols-outlined text-sm">
              {currentRole === 'mentor' ? 'psychology' : currentRole === 'student' ? 'school' : 'admin_panel_settings'}
            </span>
            <span className="text-slate-800 text-[11px]">{getRoleBadge(currentRole)}</span>
          </div>

          {/* User Menu & Logout */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 pl-2 border-l border-outline-variant hover:opacity-85 transition-opacity"
              title="Account Options"
            >
              <img
                src={displayAvatar}
                alt={displayName}
                className="w-8 h-8 rounded-full object-cover ring-2 ring-primary/20"
              />
              <div className="hidden md:block text-left">
                <p className="text-xs font-semibold text-slate-900 leading-tight truncate max-w-[120px]">
                  {displayName}
                </p>
                <p className="text-[10px] text-slate-500 capitalize">{currentRole}</p>
              </div>
              <span className="material-symbols-outlined text-xs text-slate-400">arrow_drop_down</span>
            </button>

            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg py-2 z-50 text-xs">
                <div className="px-3 py-2 border-b border-outline-variant">
                  <p className="font-semibold text-slate-900 truncate">{displayName}</p>
                  <p className="text-[11px] text-slate-500 truncate">{profile?.email || 'Authenticated User'}</p>
                </div>

                <div className="px-2 py-1">
                  <Link
                    to={`/${currentRole}/settings`}
                    onClick={() => setShowUserMenu(false)}
                    className="w-full text-left px-3 py-2 flex items-center gap-2 rounded-lg text-slate-700 hover:bg-surface-container-low transition-colors"
                  >
                    <span className="material-symbols-outlined text-base text-slate-500">settings</span>
                    <span>Account Settings</span>
                  </Link>
                </div>

                <div className="border-t border-outline-variant my-1"></div>

                <div className="px-2">
                  <button
                    onClick={handleSignOut}
                    className="w-full text-left px-3 py-2 flex items-center gap-2 rounded-lg hover:bg-red-50 text-error font-semibold transition-colors"
                  >
                    <span className="material-symbols-outlined text-base">logout</span>
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

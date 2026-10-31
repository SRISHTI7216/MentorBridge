import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { APP_CONFIG } from '../../lib/constants';

interface AdminSidebarProps {
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  isOpenMobile = false,
  onCloseMobile,
}) => {
  const { profile } = useAuth();
  const adminName = profile?.name || 'Institutional Administrator';
  const avatarUrl =
    profile?.avatarUrl ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(adminName)}&background=3525CD&color=fff`;

  const navItems = [
    {
      to: '/admin/dashboard',
      icon: 'dashboard',
      label: 'Overview',
      badge: 'Live',
      badgeColor: 'bg-indigo-500/30 text-indigo-200',
    },
    {
      to: '/admin/students',
      icon: 'school',
      label: 'Students',
    },
    {
      to: '/admin/mentors',
      icon: 'supervisor_account',
      label: 'Mentors',
    },
    {
      to: '/admin/allocation',
      icon: 'swap_horiz',
      label: 'Mentor Allocation',
      badge: 'Core',
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
    },
    {
      to: '/admin/academic',
      icon: 'account_balance',
      label: 'Academic Management',
    },
    {
      to: '/admin/settings',
      icon: 'settings',
      label: 'Settings',
    },
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full justify-between select-none">
      {/* Top Section */}
      <div>
        {/* Workspace Badge */}
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <span className="material-symbols-outlined text-xl">admin_panel_settings</span>
            </div>
            <div>
              <p className="font-display text-sm font-semibold text-white tracking-tight leading-tight">
                Admin Control
              </p>
              <p className="text-xs text-slate-400 truncate max-w-[140px]">
                {APP_CONFIG.shortName} • Institutional
              </p>
            </div>
          </div>
          <span
            className="inline-block w-2 h-2 rounded-full bg-emerald-400 ring-4 ring-emerald-500/20"
            title="Database Connected"
          ></span>
        </div>

        {/* Navigation Items */}
        <nav className="px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onCloseMobile}
              className={({ isActive }) =>
                `flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-primary text-white font-semibold shadow-md shadow-primary/20'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`
              }
            >
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[19px]">{item.icon}</span>
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${item.badgeColor}`}>
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Bottom Section - Active Admin Profile Card */}
      <div className="p-4 border-t border-slate-800/80">
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-3 flex items-center gap-3">
          <img
            src={avatarUrl}
            alt={adminName}
            className="w-9 h-9 rounded-full object-cover ring-2 ring-indigo-500/40"
          />
          <div className="overflow-hidden min-w-0">
            <p className="text-xs font-semibold text-white truncate leading-tight">
              {adminName}
            </p>
            <p className="text-[10px] text-slate-400 truncate">System Administrator</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-slate-900 border-r border-slate-800 shrink-0 min-h-[calc(100vh-64px)]">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity"
            onClick={onCloseMobile}
          />
          <aside className="relative flex flex-col w-72 max-w-[85vw] bg-slate-900 border-r border-slate-800 shadow-2xl z-10">
            <div className="p-3 flex justify-end border-b border-slate-800">
              <button
                onClick={onCloseMobile}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
};

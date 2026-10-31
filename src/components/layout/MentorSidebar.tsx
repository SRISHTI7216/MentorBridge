import React from 'react';
import { NavLink } from 'react-router-dom';
import { CURRENT_MENTOR } from '../../services/mockData';
import { APP_CONFIG } from '../../lib/constants';
import { useAuth } from '../../context/AuthContext';

interface MentorSidebarProps {
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
}

export const MentorSidebar: React.FC<MentorSidebarProps> = ({
  isOpenMobile = false,
  onCloseMobile,
}) => {
  const { profile } = useAuth();
  const mentorName = profile?.name || CURRENT_MENTOR.name;
  const avatarUrl = profile?.avatarUrl || CURRENT_MENTOR.avatarUrl;
  const department = profile?.mentorDetails?.department || CURRENT_MENTOR.department;
  const navItems = [
    {
      to: "/mentor/dashboard",
      icon: "dashboard",
      label: "Dashboard",
      badge: "Live",
      badgeColor: "bg-indigo-500/30 text-indigo-200",
    },
    {
      to: "/mentor/mentees",
      icon: "group",
      label: "My Mentees",
      badge: "42",
      badgeColor: "bg-indigo-600 text-white font-semibold",
    },
    {
      to: "/mentor/assessments",
      icon: "assignment",
      label: "Assessments",
      badge: "3 Active",
      badgeColor: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
    },
    {
      to: "/mentor/reports",
      icon: "monitoring",
      label: "Performance Reports",
    },
    {
      to: "/mentor/learning",
      icon: "auto_stories",
      label: "Learning Modules",
    },
    {
      to: "/mentor/rankings",
      icon: "leaderboard",
      label: "Rankings & Leaderboard",
    },
    {
      to: "/mentor/coding",
      icon: "code",
      label: "Coding Practice",
      badge: "GitSync",
      badgeColor: "bg-slate-800 text-slate-400",
    },
    {
      to: "/mentor/settings",
      icon: "settings",
      label: "Settings & Preferences",
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
              <span className="material-symbols-outlined text-xl">school</span>
            </div>
            <div>
              <p className="font-display text-sm font-semibold text-white tracking-tight leading-tight">
                Faculty Workspace
              </p>
              <p className="text-xs text-slate-400">
                CSE Dept. • Year 2024
              </p>
            </div>
          </div>
          <span
            className="inline-block w-2 h-2 rounded-full bg-emerald-400 ring-4 ring-emerald-500/20"
            title="System Operational"
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
                `flex items-center justify-between px-3 py-2.5 rounded-lg font-medium text-xs transition-all duration-150 ${
                  isActive
                    ? "bg-indigo-600/20 text-indigo-300 font-semibold border-l-4 border-indigo-500 shadow-sm"
                    : "text-slate-300 hover:text-white hover:bg-slate-800/60"
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

      {/* Bottom Sidebar: Academic Term & Compact Profile */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/40">
        <div className="mb-3 px-3 py-2 rounded-lg bg-slate-800/80 border border-slate-700/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-400 text-sm">
              event_available
            </span>
            <span className="text-[11px] font-medium text-slate-300 truncate">
              {APP_CONFIG.academicYear}
            </span>
          </div>
          <span className="text-emerald-400 font-semibold text-[10px] uppercase tracking-wider bg-emerald-950/70 border border-emerald-600/30 px-1.5 py-0.5 rounded">
            Active
          </span>
        </div>

        <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center gap-3">
          <img
            src={avatarUrl}
            alt={mentorName}
            className="w-9 h-9 rounded-full object-cover ring-2 ring-indigo-500/50 shrink-0"
          />
          <div className="overflow-hidden">
            <p className="text-xs font-semibold text-white truncate">{mentorName}</p>
            <p className="text-[10px] text-slate-400 truncate">{department}</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sticky Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 text-slate-300 shrink-0 hidden md:flex flex-col h-[calc(100vh-53px)] sticky top-[53px]">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobile}
          ></div>
          <div className="relative w-72 bg-slate-900 border-r border-slate-800 text-slate-300 flex flex-col h-full z-10 shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <span className="font-bold text-white text-sm">Navigation Menu</span>
              <button
                onClick={onCloseMobile}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
};


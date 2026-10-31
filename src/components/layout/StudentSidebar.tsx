import React from 'react';
import { NavLink } from 'react-router-dom';
import { CURRENT_STUDENT } from '../../services/mockData';
import { useAuth } from '../../context/AuthContext';

interface StudentSidebarProps {
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
}

export const StudentSidebar: React.FC<StudentSidebarProps> = ({
  isOpenMobile = false,
  onCloseMobile,
}) => {
  const { profile } = useAuth();
  const studentName = profile?.name || CURRENT_STUDENT.name;
  const avatarUrl = profile?.avatarUrl || CURRENT_STUDENT.avatarUrl;
  const rollNo = profile?.studentDetails?.rollNumber || CURRENT_STUDENT.rollOrEmpId;
  const navItems = [
    {
      to: "/student/dashboard",
      icon: "dashboard",
      label: "Dashboard",
      badge: "Active",
      badgeColor: "bg-indigo-500/30 text-indigo-200",
    },
    {
      to: "/student/assessments",
      icon: "assignment_turned_in",
      label: "My Assessments",
      badge: "2 Due",
      badgeColor: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
    },
    {
      to: "/student/reports",
      icon: "insights",
      label: "Performance Reports",
    },
    {
      to: "/student/learning",
      icon: "menu_book",
      label: "Learning Modules",
      badge: "Wk 8",
      badgeColor: "bg-indigo-600 text-white font-mono",
    },
    {
      to: "/student/certificates",
      icon: "verified",
      label: "Certificates",
      badge: "3 Verified",
      badgeColor: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
    },
    {
      to: "/student/coding",
      icon: "terminal",
      label: "Coding Practice",
      badge: "142 Solved",
      badgeColor: "bg-slate-800 text-slate-300 font-mono",
    },
    {
      to: "/student/rankings",
      icon: "military_tech",
      label: "Rankings & Standings",
      badge: "Top 5%",
      badgeColor: "bg-indigo-500/30 text-indigo-200",
    },
    {
      to: "/student/mentor",
      icon: "supervisor_account",
      label: "My Mentor",
      badge: "1:1 Ready",
      badgeColor: "bg-emerald-500/20 text-emerald-300",
    },
    {
      to: "/student/settings",
      icon: "settings",
      label: "Settings",
    },
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full justify-between select-none">
      {/* Top Section */}
      <div>
        {/* Workspace Badge */}
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-600/30 border border-sky-500/40 flex items-center justify-center text-sky-400">
              <span className="material-symbols-outlined text-xl">school</span>
            </div>
            <div>
              <p className="font-display text-sm font-semibold text-white tracking-tight leading-tight">
                Student Portal
              </p>
              <p className="text-xs text-slate-400">
                {CURRENT_STUDENT.cohort}
              </p>
            </div>
          </div>
          <span
            className="inline-block w-2 h-2 rounded-full bg-emerald-400 ring-4 ring-emerald-500/20"
            title="Active Enrollment"
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

      {/* Bottom Sidebar: Student Card & Mentor Link */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/40">
        <div className="mb-3 px-3 py-2 rounded-lg bg-slate-800/80 border border-slate-700/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-400 text-sm">
              badge
            </span>
            <span className="text-[11px] font-medium text-slate-300">
              Roll: {rollNo}
            </span>
          </div>
          <span className="text-indigo-300 font-semibold text-[10px] uppercase tracking-wider bg-indigo-950/70 border border-indigo-600/30 px-1.5 py-0.5 rounded">
            Enrolled
          </span>
        </div>

        <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center gap-3">
          <img
            src={avatarUrl}
            alt={studentName}
            className="w-9 h-9 rounded-full object-cover ring-2 ring-sky-500/50 shrink-0"
          />
          <div className="overflow-hidden">
            <p className="text-xs font-semibold text-white truncate">{studentName}</p>
            <p className="text-[10px] text-slate-400 truncate">Roll: {rollNo}</p>
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

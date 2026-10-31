import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';
import { MentorSidebar } from './MentorSidebar';
import { Footer } from './Footer';
import { useAuth } from '../../context/AuthContext';

export const MentorLayout: React.FC = () => {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { profile } = useAuth();

  const mentorName = profile?.name || 'Faculty Mentor';
  const avatarUrl = profile?.avatarUrl;

  return (
    <div className="min-h-screen flex flex-col bg-surface text-on-surface">
      <Navbar
        currentRole="mentor"
        userName={mentorName}
        avatarUrl={avatarUrl}
        subtitle="Faculty Portal • ABET Criterion 3 & 5 Tracking"
      />

      {/* Mobile Top Sub-bar with Drawer Toggle */}
      <div className="md:hidden bg-slate-900 border-b border-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs">
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="flex items-center gap-2 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
        >
          <span className="material-symbols-outlined text-sm">menu</span>
          <span>Mentor Menu</span>
        </button>
        <span className="font-medium text-slate-300">Faculty Workspace</span>
      </div>

      <div className="flex flex-1 w-full max-w-[1600px] mx-auto overflow-hidden">
        <MentorSidebar
          isOpenMobile={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />
        <main className="flex-1 flex flex-col min-w-0 bg-surface overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <Footer />
    </div>
  );
};

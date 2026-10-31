import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { StatCard } from '../../components/ui/StatCard';
import { Button } from '../../components/ui/Button';
import { apiClient } from '../../services/apiClient';
import { APP_CONFIG } from '../../lib/constants';

interface AdminStats {
  totalStudents: number;
  totalMentors: number;
  activeAccounts: number;
  inactiveAccounts: number;
  unassignedStudents: number;
  totalActiveAssignments: number;
  currentTerm: {
    id: string;
    code: string;
    name: string;
    start_date: string;
    end_date: string;
  } | null;
  recentRegistrations: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    is_active: boolean;
    created_at: string;
  }>;
  recentAssignments: Array<{
    id: string;
    assigned_date: string;
    created_at: string;
    is_active: boolean;
    student?: { id: string; name: string; email: string };
    mentor?: { id: string; name: string; email: string };
    academic_term?: { name: string; code: string };
  }>;
}

export const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.getAdminStats();
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        setStats(res.data);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch admin stats');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
              Institutional Admin Dashboard
            </h1>
            <Badge variant="primary">ABET Coordinator</Badge>
          </div>
          <p className="text-xs text-on-surface-variant mt-1">
            {APP_CONFIG.department} • Active Database Statistics & Governance
          </p>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate('/admin/students?action=create')}
            className="flex items-center gap-1.5 text-xs"
          >
            <span className="material-symbols-outlined text-sm">person_add</span>
            Invite Student
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate('/admin/mentors?action=create')}
            className="flex items-center gap-1.5 text-xs"
          >
            <span className="material-symbols-outlined text-sm">group_add</span>
            Invite Mentor
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => navigate('/admin/allocation')}
            className="flex items-center gap-1.5 text-xs shadow-sm shadow-primary/25"
          >
            <span className="material-symbols-outlined text-sm">swap_horiz</span>
            Allocate Mentors
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={fetchStats}
            title="Refresh statistics"
            className="p-1.5 text-slate-500 hover:text-slate-800"
          >
            <span className="material-symbols-outlined text-base">refresh</span>
          </Button>
        </div>
      </div>

      {/* Error Notice */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-rose-600">error</span>
            <span>{error}</span>
          </div>
          <Button size="sm" variant="outline" onClick={fetchStats}>
            Retry
          </Button>
        </div>
      )}

      {/* Loading Skeletons */}
      {isLoading && !stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 animate-pulse">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-28 bg-slate-100 rounded-2xl border border-slate-200/60" />
          ))}
        </div>
      )}

      {/* Live Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard
            title="Total Students"
            value={stats.totalStudents}
            subtext="Enrolled Mentees"
            iconName="school"
            iconColor="primary"
          />
          <StatCard
            title="Total Mentors"
            value={stats.totalMentors}
            subtext="Faculty Mentors"
            iconName="supervisor_account"
            iconColor="sky"
          />
          <StatCard
            title="Active Accounts"
            value={stats.activeAccounts}
            subtext="Operational"
            iconName="check_circle"
            iconColor="emerald"
          />
          <StatCard
            title="Inactive Accounts"
            value={stats.inactiveAccounts}
            subtext="Suspended / On Leave"
            iconName="pause_circle"
            iconColor="amber"
          />
          <StatCard
            title="Unassigned"
            value={stats.unassignedStudents}
            subtext={stats.unassignedStudents > 0 ? "Action Required" : "All Assigned"}
            iconName="person_off"
            iconColor={stats.unassignedStudents > 0 ? "amber" : "emerald"}
          />
          <StatCard
            title="Active Pairings"
            value={stats.totalActiveAssignments}
            subtext={stats.currentTerm ? stats.currentTerm.code : "Term Assignments"}
            iconName="swap_horiz"
            iconColor="primary"
          />
        </div>
      )}

      {/* Current Academic Term Banner */}
      {stats?.currentTerm && (
        <div className="bg-gradient-to-r from-indigo-900 via-indigo-850 to-slate-900 text-white rounded-2xl p-5 border border-indigo-700/50 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 shrink-0">
              <span className="material-symbols-outlined text-2xl">event_available</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
                  Active Academic Term
                </span>
                <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                  CURRENT
                </span>
              </div>
              <p className="text-base font-bold text-white mt-0.5">
                {stats.currentTerm.name} ({stats.currentTerm.code})
              </p>
              <p className="text-xs text-indigo-200/80">
                Duration: {stats.currentTerm.start_date} to {stats.currentTerm.end_date}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate('/admin/academic')}
            className="border-indigo-400/40 text-white hover:bg-indigo-800/40 shrink-0 text-xs"
          >
            Manage Academic Terms
          </Button>
        </div>
      )}

      {/* Main Dual Grid: Recent Registrations & Recent Assignments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Account Registrations */}
        <Card className="p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">how_to_reg</span>
                <h3 className="text-sm font-bold text-slate-900">Recent Account Registrations</h3>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate('/admin/students')}
                className="text-xs text-primary hover:text-primary-dark"
              >
                View All
              </Button>
            </div>

            <div className="divide-y divide-slate-100 mt-2">
              {!stats?.recentRegistrations?.length ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  No accounts registered yet. Click &quot;Invite Student&quot; or &quot;Invite Mentor&quot; to begin.
                </div>
              ) : (
                stats.recentRegistrations.map((user) => (
                  <div key={user.id} className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 shrink-0">
                        <span className="material-symbols-outlined text-sm">
                          {user.role === 'mentor' ? 'supervisor_account' : user.role === 'admin' ? 'admin_panel_settings' : 'school'}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{user.name}</p>
                        <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${
                          user.role === 'admin'
                            ? 'bg-purple-100 text-purple-700'
                            : user.role === 'mentor'
                            ? 'bg-sky-100 text-sky-700'
                            : 'bg-indigo-100 text-indigo-700'
                        }`}
                      >
                        {user.role}
                      </span>
                      <span
                        className={`w-2 h-2 rounded-full ${
                          user.is_active ? 'bg-emerald-500' : 'bg-slate-300'
                        }`}
                        title={user.is_active ? 'Active' : 'Inactive'}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>

        {/* Recent Mentor Assignments */}
        <Card className="p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600 text-xl">assignment_ind</span>
                <h3 className="text-sm font-bold text-slate-900">Recent Mentor Allocations</h3>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate('/admin/allocation')}
                className="text-xs text-primary hover:text-primary-dark"
              >
                View Allocations
              </Button>
            </div>

            <div className="divide-y divide-slate-100 mt-2">
              {!stats?.recentAssignments?.length ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  No mentor allocations recorded yet. Allocate students in the Mentor Allocation workspace.
                </div>
              ) : (
                stats.recentAssignments.map((asgn) => (
                  <div key={asgn.id} className="py-3 flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                        <span className="truncate">{asgn.student?.name || 'Student'}</span>
                        <span className="material-symbols-outlined text-slate-400 text-sm">arrow_forward</span>
                        <span className="text-primary truncate">{asgn.mentor?.name || 'Mentor'}</span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {asgn.academic_term?.code || 'Term'} • Assigned on {asgn.assigned_date}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        asgn.is_active
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-500 line-through'
                      }`}
                    >
                      {asgn.is_active ? 'Active' : 'Archived'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Governance & Institutional Security Notice */}
      <Card className="p-5 border-l-4 border-l-primary bg-slate-50/50">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 text-primary flex items-center justify-center shrink-0 mt-0.5">
            <span className="material-symbols-outlined text-lg">verified_user</span>
          </div>
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Institutional Governance Integrity (ABET Criterion 3 & 5)
            </h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              MentorBridge strictly governs user provisioning and faculty advising. All mentor–mentee pairings are
              subject to PostgreSQL partial unique constraints (
              <code className="text-primary bg-indigo-50 px-1 py-0.5 rounded font-mono text-[11px]">
                idx_unique_active_student_term_assignment
              </code>
              ). Role escalation is blocked at the database trigger layer, preventing unauthorized modification of user
              roles or active status.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};

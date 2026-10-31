import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { fetchMentorMentees } from '../../services/dataService';
import { AssignedMentee } from '../../types/auth';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

export const MentorMentees: React.FC = () => {
  const { user, isConfigured } = useAuth();
  const [mentees, setMentees] = useState<AssignedMentee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterDivision, setFilterDivision] = useState('all');

  useEffect(() => {
    let isMounted = true;

    const loadMentees = async () => {
      if (!user?.id) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const data = await fetchMentorMentees(user.id);
        if (isMounted) {
          setMentees(data);
        }
      } catch (err) {
        console.error('[MentorMentees] Error loading mentees:', err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadMentees();

    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  const filteredMentees = mentees.filter((m) => {
    const matchDivision = filterDivision === 'all' || m.division.toLowerCase() === filterDivision.toLowerCase();
    const matchSearch =
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.rollNumber.toLowerCase().includes(search.toLowerCase()) ||
      m.branch.toLowerCase().includes(search.toLowerCase());
    return matchDivision && matchSearch;
  });

  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
              My Assigned Mentees Directory
            </h1>
            <Badge variant="primary">Real-Time DB Sync</Badge>
          </div>
          <p className="text-xs text-on-surface-variant mt-1">
            Institutional mentor assignments verified via PostgreSQL Row Level Security (RLS).
          </p>
        </div>
      </div>

      {!isConfigured && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-700 text-lg mt-0.5">warning</span>
          <div>
            <p className="font-semibold">Supabase Environment Configuration Pending</p>
            <p className="text-[11px] mt-0.5">
              Live mentee records require valid <code className="bg-amber-100 px-1 py-0.5 rounded font-mono">VITE_SUPABASE_URL</code> and <code className="bg-amber-100 px-1 py-0.5 rounded font-mono">VITE_SUPABASE_ANON_KEY</code>.
            </p>
          </div>
        </div>
      )}

      {/* Filter Row */}
      <div className="flex flex-wrap items-center gap-3 text-xs bg-surface-container-lowest p-3 rounded-xl border border-outline-variant">
        <div className="relative flex-1 min-w-[200px]">
          <span className="material-symbols-outlined absolute left-2.5 top-2 text-slate-400 text-base">search</span>
          <input
            type="text"
            placeholder="Search by student name, roll number, or branch..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-outline-variant bg-surface placeholder-slate-400 focus:border-primary outline-none"
          />
        </div>

        <select
          value={filterDivision}
          onChange={(e) => setFilterDivision(e.target.value)}
          className="rounded-lg border border-outline-variant bg-surface px-2.5 py-1.5 text-xs font-semibold cursor-pointer"
        >
          <option value="all">All Divisions</option>
          <option value="A">Division A</option>
          <option value="B">Division B</option>
          <option value="C">Division C</option>
        </select>
      </div>

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-5 space-y-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-slate-200"></div>
                <div className="space-y-1.5 flex-1">
                  <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                  <div className="h-3 bg-slate-200 rounded w-1/2"></div>
                </div>
              </div>
              <div className="h-14 bg-slate-100 rounded-lg"></div>
            </Card>
          ))}
        </div>
      ) : filteredMentees.length === 0 ? (
        /* Empty State */
        <Card className="p-12 text-center space-y-3 border-dashed border-2">
          <div className="w-14 h-14 rounded-full bg-surface-container-high mx-auto flex items-center justify-center text-on-surface-variant">
            <span className="material-symbols-outlined text-3xl">school</span>
          </div>
          <h3 className="font-display font-bold text-base text-slate-800">
            {search ? 'No Matching Students Found' : 'No Mentees Assigned'}
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {search
              ? 'Try modifying your search query or division filter.'
              : 'You do not have any active student assignments for the current academic term. Institutional assignments are provisioned by the Department Coordinator.'}
          </p>
        </Card>
      ) : (
        /* Grid of Real Mentee Cards */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMentees.map((mentee) => (
            <Card key={mentee.assignmentId} hoverEffect className="p-5 flex flex-col justify-between space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img
                    src={mentee.avatarUrl}
                    alt={mentee.name}
                    className="w-12 h-12 rounded-full object-cover ring-2 ring-primary/20"
                  />
                  <div>
                    <h3 className="font-semibold text-slate-900 text-sm">{mentee.name}</h3>
                    <p className="text-xs font-mono text-slate-500">Roll: {mentee.rollNumber}</p>
                    <p className="text-[11px] text-slate-400">
                      {mentee.branch} • Div {mentee.division} • Sem {mentee.semester}
                    </p>
                  </div>
                </div>
                <Badge variant={mentee.isActive ? 'success' : 'neutral'}>
                  {mentee.isActive ? 'Active' : 'Archived'}
                </Badge>
              </div>

              {/* Academic Metrics Row */}
              <div className="grid grid-cols-3 gap-2 py-2 border-y border-slate-100 text-center text-xs">
                <div className="bg-slate-50 p-2 rounded-lg">
                  <p className="text-[10px] text-slate-500 uppercase font-semibold">Overall</p>
                  <p className="font-bold text-slate-900 text-sm mt-0.5">{mentee.overallScore}%</p>
                </div>
                <div className="bg-slate-50 p-2 rounded-lg">
                  <p className="text-[10px] text-slate-500 uppercase font-semibold">DSA Score</p>
                  <p className="font-bold text-indigo-700 text-sm mt-0.5">{mentee.dsaProficiency}%</p>
                </div>
                <div className="bg-slate-50 p-2 rounded-lg">
                  <p className="text-[10px] text-slate-500 uppercase font-semibold">Attendance</p>
                  <p className="font-bold text-emerald-700 text-sm mt-0.5">{mentee.attendanceRate}%</p>
                </div>
              </div>

              {mentee.cohortName && (
                <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px] text-slate-400">groups</span>
                  <span>{mentee.cohortName}</span>
                </div>
              )}

              {/* Card Footer */}
              <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100">
                <span className="text-[11px] text-slate-400">Assigned: {mentee.assignedDate}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="text-xs px-2.5 py-1">
                    Review History
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

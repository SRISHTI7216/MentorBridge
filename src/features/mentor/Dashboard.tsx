import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CURRENT_MENTOR, MOCK_MENTEES } from '../../services/mockData';
import { useAuth } from '../../context/AuthContext';
import { StatCard } from '../../components/ui/StatCard';
import { Button } from '../../components/ui/Button';

export const MentorDashboard: React.FC = () => {
  const { profile } = useAuth();
  const [cohortFilter, setCohortFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewState, setViewState] = useState<'default' | 'loading' | 'empty'>('default');

  const mentorName = profile?.name || CURRENT_MENTOR.name;

  const filteredMentees = MOCK_MENTEES.filter((m) => {
    const matchesCohort = cohortFilter === 'all' || m.cohort.toLowerCase().includes(cohortFilter.toLowerCase());
    const matchesSearch = m.name.toLowerCase().includes(searchQuery.toLowerCase()) || m.rollNo.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCohort && matchesSearch;
  });

  const supportQueueMentees = MOCK_MENTEES.filter((m) => m.status === 'needs_attention');

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-surface">
      {/* Dashboard Sub-Header / Filter Top Bar */}
      <div className="bg-surface-container-lowest border-b border-outline-variant px-6 py-3.5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 sticky top-[53px] z-20 shadow-xs">
        <div>
          <div className="flex items-center gap-2 text-on-surface-variant text-[11px] mb-0.5">
            <span className="hover:text-primary cursor-pointer">Faculty Portal</span>
            <span>/</span>
            <span>Mentorship Cohorts</span>
            <span>/</span>
            <span className="text-primary font-semibold">Performance Tracking</span>
          </div>
          <h1 className="text-xl font-bold font-display text-on-surface tracking-tight">
            Mentor Overview: {mentorName} ({filteredMentees.length} Mentees Active)
          </h1>
        </div>

        {/* Filters and Actions */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <div className="inline-flex items-center rounded-lg border border-outline-variant bg-surface px-2.5 py-1.5 shadow-xs">
            <span className="material-symbols-outlined text-slate-400 text-sm mr-1.5">splitscreen</span>
            <select
              value={cohortFilter}
              onChange={(e) => setCohortFilter(e.target.value)}
              className="bg-transparent border-0 p-0 text-xs font-semibold text-on-surface focus:ring-0 cursor-pointer pr-3"
            >
              <option value="all">Cohort: All (42 Students)</option>
              <option value="cse-a">Cohort: CSE-A Only (22 Students)</option>
              <option value="cse-b">Cohort: CSE-B Only (20 Students)</option>
            </select>
          </div>

          <div className="relative w-44 sm:w-56">
            <span className="material-symbols-outlined absolute left-2.5 top-2 text-slate-400 text-base">search</span>
            <input
              type="text"
              placeholder="Search mentees, roll..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-outline-variant bg-surface placeholder-slate-400 focus:border-primary focus:ring-1 focus:ring-primary outline-none"
            />
          </div>

          <Button
            size="sm"
            variant="outline"
            leftIcon={<span className="material-symbols-outlined text-base">download</span>}
            onClick={() => alert('ABET Criterion 3 & 5 Compliance Report generation simulated (Phase 1).')}
          >
            Export ABET Report
          </Button>
        </div>
      </div>

      {/* State Switcher Bar */}
      <div className="bg-indigo-50/70 border-b border-indigo-100 px-6 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-indigo-900 font-medium">
          <span className="material-symbols-outlined text-indigo-600 text-sm">tune</span>
          <span className="font-semibold">Interactive Prototype View:</span>
          <span className="text-slate-500 hidden sm:inline">Inspect dashboard behavior under different states</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setViewState('default')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
              viewState === 'default'
                ? 'bg-primary text-white font-semibold shadow-xs'
                : 'bg-white text-slate-700 border border-indigo-200 hover:bg-indigo-50'
            }`}
          >
            Default Active
          </button>
          <button
            onClick={() => setViewState('loading')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
              viewState === 'loading'
                ? 'bg-primary text-white font-semibold shadow-xs'
                : 'bg-white text-slate-700 border border-indigo-200 hover:bg-indigo-50'
            }`}
          >
            Loading Skeleton
          </button>
          <button
            onClick={() => setViewState('empty')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
              viewState === 'empty'
                ? 'bg-primary text-white font-semibold shadow-xs'
                : 'bg-white text-slate-700 border border-indigo-200 hover:bg-indigo-50'
            }`}
          >
            Empty Filter State
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
        {viewState === 'loading' ? (
          <div className="space-y-6 animate-pulse">
            <div className="h-32 bg-slate-200 rounded-2xl"></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="h-28 bg-slate-200 rounded-xl"></div>
              <div className="h-28 bg-slate-200 rounded-xl"></div>
              <div className="h-28 bg-slate-200 rounded-xl"></div>
              <div className="h-28 bg-slate-200 rounded-xl"></div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 h-72 bg-slate-200 rounded-xl"></div>
              <div className="lg:col-span-5 h-72 bg-slate-200 rounded-xl"></div>
            </div>
          </div>
        ) : viewState === 'empty' ? (
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <span className="material-symbols-outlined text-2xl">filter_list_off</span>
            </div>
            <h3 className="font-display font-bold text-slate-900 text-lg">No Mentees Match Current Criteria</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              No students were found matching the selected cohort or search filter. Try clearing filters or selecting all cohorts.
            </p>
            <Button size="sm" variant="outline" onClick={() => { setCohortFilter('all'); setSearchQuery(''); setViewState('default'); }}>
              Reset Filters
            </Button>
          </div>
        ) : (
          <>
            {/* Welcome Banner Bento Block */}
            <div className="rounded-2xl border border-outline-variant bg-gradient-to-r from-surface-container-lowest via-white to-indigo-50/40 p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden">
              <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-primary/5 rounded-full pointer-events-none blur-2xl"></div>
              <div className="space-y-1.5 z-10">
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-indigo-100/80 border border-indigo-200 text-indigo-800 text-[11px] font-semibold mb-1">
                  <span className="material-symbols-outlined text-sm">timeline</span>
                  <span>Sprint 8 of 14 • Mid-term Evaluation in 12 Days</span>
                </div>
                <h2 className="font-display text-2xl lg:text-3xl text-slate-900 font-bold tracking-tight">
                  Good morning, Dr. Vance!
                </h2>
                <p className="text-slate-600 max-w-2xl text-xs sm:text-sm leading-relaxed">
                  Here is an overview of your <strong className="text-primary font-semibold">42 assigned mentees</strong>. Cohort assessment averages are trending up by +4.2%, with 5 students flagged for tailored algorithm guidance prior to ABET review week.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 z-10 shrink-0">
                <Link to="/mentor/mentees">
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<span className="material-symbols-outlined text-primary text-base">video_call</span>}
                  >
                    + Schedule 1:1 Review
                  </Button>
                </Link>
                <Link to="/mentor/assessments">
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<span className="material-symbols-outlined text-base">add_task</span>}
                  >
                    + Create Assessment
                  </Button>
                </Link>
              </div>
            </div>

            {/* 4 High-Impact KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Total Mentees"
                value={CURRENT_MENTOR.totalMentees}
                change="+3 this term"
                isPositive={true}
                subtext="Cohort capacity: 95%"
                actionText="Active quota"
                iconName="school"
                iconColor="primary"
              />
              <StatCard
                title="Avg Assessment Score"
                value={`${CURRENT_MENTOR.avgCohortScore}%`}
                change="+4.2%"
                isPositive={true}
                subtext="Dept Benchmark: 70.0%"
                actionText="Above target"
                iconName="trending_up"
                iconColor="emerald"
              />
              <StatCard
                title="Submissions Evaluated"
                value={CURRENT_MENTOR.submissionsEvaluated}
                change="94.2% rate"
                isPositive={true}
                subtext={`Pending reviews: ${CURRENT_MENTOR.pendingReviews}`}
                actionText="On-time SLA"
                iconName="check_circle"
                iconColor="sky"
              />
              <StatCard
                title="Targeted Support Queue"
                value={CURRENT_MENTOR.supportQueueCount}
                change="Action needed"
                isPositive={false}
                subtext="Focus: OS Threads & DSA"
                actionText="Intervention ready"
                iconName="support_agent"
                iconColor="amber"
              />
            </div>

            {/* Charts & Analytics */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Weekly Performance Trajectory Chart */}
              <div className="lg:col-span-7 bg-surface-container-lowest rounded-xl border border-outline-variant p-5 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-2">
                  <div>
                    <h3 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
                      <span>Weekly Assessment Performance Trajectory</span>
                      <span className="text-[11px] font-normal text-slate-400 font-mono">(Weeks 1–6)</span>
                    </h3>
                    <p className="text-[11px] text-slate-500">Continuous score evaluation mapped against ABET Criterion 3.b</p>
                  </div>
                  <div className="flex items-center gap-3 text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-1 bg-indigo-600 rounded"></span>
                      <span className="text-slate-600 font-medium">Cohort Mean</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-0.5 border-b border-dashed border-slate-400"></span>
                      <span className="text-slate-500">Target (70%)</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 relative h-60 w-full">
                  <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 540 220">
                    <defs>
                      <linearGradient id="cohortGradient" x1="0%" x2="0%" y1="0%" y2="100%">
                        <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.25"></stop>
                        <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.0"></stop>
                      </linearGradient>
                    </defs>
                    {/* Grid horizontal markers */}
                    <line stroke="#f1f5f9" strokeWidth="1" x1="40" x2="520" y1="20" y2="20"></line>
                    <text fill="#94a3b8" fontSize="10" textAnchor="end" x="32" y="24">90%</text>
                    <line stroke="#f1f5f9" strokeWidth="1" x1="40" x2="520" y1="65" y2="65"></line>
                    <text fill="#94a3b8" fontSize="10" textAnchor="end" x="32" y="69">80%</text>
                    <line stroke="#cbd5e1" strokeDasharray="4 4" strokeWidth="1.5" x1="40" x2="520" y1="110" y2="110"></line>
                    <text fill="#64748b" fontSize="10" fontWeight="600" textAnchor="end" x="32" y="114">70%</text>
                    <line stroke="#f1f5f9" strokeWidth="1" x1="40" x2="520" y1="155" y2="155"></line>
                    <text fill="#94a3b8" fontSize="10" textAnchor="end" x="32" y="159">60%</text>
                    <line stroke="#e2e8f0" strokeWidth="1" x1="40" x2="520" y1="200" y2="200"></line>
                    <text fill="#94a3b8" fontSize="10" textAnchor="end" x="32" y="204">50%</text>

                    {/* Area fill */}
                    <polygon fill="url(#cohortGradient)" points="65,200 65,119 155,105 245,96 335,101 425,87 505,81 505,200"></polygon>

                    {/* Line Path */}
                    <path d="M 65 119 L 155 105 L 245 96 L 335 101 L 425 87 L 505 81" fill="none" stroke="#4f46e5" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3"></path>

                    {/* Data Points */}
                    {[
                      { x: 65, y: 119, val: "68%", label: "W1" },
                      { x: 155, y: 105, val: "71%", label: "W2" },
                      { x: 245, y: 96, val: "73%", label: "W3" },
                      { x: 335, y: 101, val: "72%", label: "W4" },
                      { x: 425, y: 87, val: "75%", label: "W5" },
                      { x: 505, y: 81, val: "76.4%", label: "W6 (Current)" },
                    ].map((pt, idx) => (
                      <g key={idx} className="cursor-pointer">
                        <circle cx={pt.x} cy={pt.y} fill="#ffffff" r="4.5" stroke="#4f46e5" strokeWidth="2.5"></circle>
                        <text fill="#312e81" fontSize="9" fontWeight="600" textAnchor="middle" x={pt.x} y={pt.y - 8}>{pt.val}</text>
                        <text fill="#64748b" fontSize="9" textAnchor="middle" x={pt.x} y="214">{pt.label}</text>
                      </g>
                    ))}
                  </svg>
                </div>
                <div className="mt-2 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <span>Consistent gain observed since Week 4 code restructuring module.</span>
                  <Link to="/mentor/reports" className="text-primary hover:text-indigo-800 font-semibold flex items-center gap-1">
                    <span>View Full Psychometrics</span>
                    <span className="material-symbols-outlined text-xs">chevron_right</span>
                  </Link>
                </div>
              </div>

              {/* Technical Competencies Breakdown */}
              <div className="lg:col-span-5 bg-surface-container-lowest rounded-xl border border-outline-variant p-5 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div>
                      <h3 className="font-display text-sm font-bold text-slate-900">Technical Competencies</h3>
                      <p className="text-[11px] text-slate-500">Core curricular sub-disciplines</p>
                    </div>
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">ABET SO-1</span>
                  </div>

                  <div className="mt-4 space-y-3.5 text-xs">
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="font-semibold text-slate-800">Data Structures & Algorithms</span>
                        <span className="font-bold text-indigo-700">82% <span className="text-[10px] text-slate-400 font-normal">/ 75% Target</span></span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div className="bg-indigo-600 h-full rounded-full" style={{ width: '82%' }}></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="font-semibold text-slate-800">Database Management (SQL/NoSQL)</span>
                        <span className="font-bold text-indigo-700">78% <span className="text-[10px] text-slate-400 font-normal">/ 75% Target</span></span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div className="bg-indigo-500 h-full rounded-full" style={{ width: '78%' }}></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="font-semibold text-slate-800 flex items-center gap-1">
                          <span>Operating Systems & Concurrency</span>
                          <span className="text-[9px] bg-amber-100 text-amber-800 px-1 py-0.2 rounded font-medium">Needs Review</span>
                        </span>
                        <span className="font-bold text-amber-600">69% <span className="text-[10px] text-slate-400 font-normal">/ 75% Target</span></span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div className="bg-amber-500 h-full rounded-full" style={{ width: '69%' }}></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="font-semibold text-slate-800">Computer Networks & Protocols</span>
                        <span className="font-bold text-indigo-700">74% <span className="text-[10px] text-slate-400 font-normal">/ 70% Target</span></span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div className="bg-indigo-500 h-full rounded-full" style={{ width: '74%' }}></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="font-semibold text-slate-800">OOP & Low-Level System Design</span>
                        <span className="font-bold text-indigo-700">80% <span className="text-[10px] text-slate-400 font-normal">/ 75% Target</span></span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div className="bg-indigo-600 h-full rounded-full" style={{ width: '80%' }}></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-3 rounded-lg bg-indigo-50/50 border border-indigo-100 flex items-start gap-2 text-xs text-indigo-900">
                  <span className="material-symbols-outlined text-indigo-600 text-sm mt-0.5">lightbulb</span>
                  <span><strong>Faculty Action:</strong> Lab drill on POSIX thread synchronization scheduled for next Tuesday.</span>
                </div>
              </div>
            </div>

            {/* Targeted Support Queue Section */}
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-5 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-sm font-bold text-slate-900">Students Flagged for Guidance</h3>
                  <span className="bg-amber-100 text-amber-800 text-[11px] px-2 py-0.5 rounded-full font-bold">
                    {supportQueueMentees.length} active in queue
                  </span>
                </div>
                <Link to="/mentor/mentees" className="text-xs font-semibold text-primary hover:underline">
                  View All Directory
                </Link>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {supportQueueMentees.map((mentee) => (
                  <div
                    key={mentee.id}
                    className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-indigo-200 transition-all flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={mentee.avatarUrl}
                        alt={mentee.name}
                        className="w-10 h-10 rounded-full object-cover border border-slate-200"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-slate-900">{mentee.name}</p>
                          <span className="text-[10px] font-mono text-slate-500">{mentee.rollNo}</span>
                        </div>
                        <p className="text-[11px] text-amber-700 font-medium mt-0.5">
                          Flag: {mentee.flaggedTopic || "Score dip in recent assessment"}
                        </p>
                      </div>
                    </div>
                    <Link to="/mentor/coding">
                      <button className="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-primary font-semibold text-xs border border-indigo-200 transition-colors">
                        Assign Drill
                      </button>
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

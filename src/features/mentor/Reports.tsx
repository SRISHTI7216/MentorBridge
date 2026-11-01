import React, { useEffect, useState, useCallback } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { apiClient } from '../../services/apiClient';
import type {
  MentorOverviewMetrics,
  MenteePerformanceListItem,
  AtRiskStudentItem,
  AdminTopicAnalyticsItem,
  PerformanceMetricSummary,
  TopicAnalyticsItem,
  TrendDataPoint,
} from '../../types/analytics';

export const MentorReports: React.FC = () => {
  const [overview, setOverview] = useState<MentorOverviewMetrics | null>(null);
  const [mentees, setMentees] = useState<MenteePerformanceListItem[]>([]);
  const [atRiskList, setAtRiskList] = useState<AtRiskStudentItem[]>([]);
  const [cohortTopics, setCohortTopics] = useState<AdminTopicAnalyticsItem[]>([]);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterAtRiskOnly, setFilterAtRiskOnly] = useState<boolean>(false);

  // Individual Mentee Detail Modal
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedMentee, setSelectedMentee] = useState<MenteePerformanceListItem | null>(null);
  const [menteeSummary, setMenteeSummary] = useState<PerformanceMetricSummary | null>(null);
  const [menteeTopics, setMenteeTopics] = useState<TopicAnalyticsItem[]>([]);
  const [menteeTrends, setMenteeTrends] = useState<TrendDataPoint[]>([]);
  const [isDetailLoading, setIsDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Page Global State
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadMentorReports = useCallback(async () => {
    let isMounted = true;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [overviewRes, menteesRes, atRiskRes, topicsRes] = await Promise.all([
        apiClient.getMentorAnalyticsOverview(),
        apiClient.getMentorMenteesList(),
        apiClient.getMentorAtRiskMentees(),
        apiClient.getMentorCohortTopics(),
      ]);

      if (!isMounted) return;

      if (overviewRes.error) {
        setErrorMessage(overviewRes.error);
      } else if (overviewRes.data?.overview) {
        setOverview(overviewRes.data.overview);
      }

      if (menteesRes.data?.mentees) {
        setMentees(menteesRes.data.mentees);
      }

      if (atRiskRes.data?.atRiskStudents) {
        setAtRiskList(atRiskRes.data.atRiskStudents);
      }

      if (topicsRes.data?.topics) {
        setCohortTopics(topicsRes.data.topics);
      }
    } catch (err: any) {
      if (isMounted) {
        setErrorMessage(err.message || 'Failed to connect to mentor analytics engine.');
      }
    } finally {
      if (isMounted) {
        setIsLoading(false);
      }
    }

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    loadMentorReports();
  }, [loadMentorReports]);

  // Load Individual Mentee Drilldown
  const handleOpenMenteeDetail = async (m: MenteePerformanceListItem) => {
    setSelectedStudentId(m.studentId);
    setSelectedMentee(m);
    setIsDetailLoading(true);
    setDetailError(null);

    try {
      const [summaryRes, topicsRes, trendsRes] = await Promise.all([
        apiClient.getIndividualMenteeSummary(m.studentId),
        apiClient.getIndividualMenteeTopics(m.studentId),
        apiClient.getIndividualMenteeTrends(m.studentId),
      ]);

      if (summaryRes.data?.summary) {
        setMenteeSummary(summaryRes.data.summary);
      }
      if (topicsRes.data?.topics) {
        setMenteeTopics(topicsRes.data.topics);
      }
      if (trendsRes.data?.timeline) {
        setMenteeTrends(trendsRes.data.timeline);
      }
    } catch (err: any) {
      setDetailError(err.message || 'Could not load mentee analytics drilldown.');
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleCloseMenteeDetail = () => {
    setSelectedStudentId(null);
    setSelectedMentee(null);
    setMenteeSummary(null);
    setMenteeTopics([]);
    setMenteeTrends([]);
    setDetailError(null);
  };

  // Filtered Mentees
  const atRiskMap = new Map<string, AtRiskStudentItem>();
  atRiskList.forEach((ar) => atRiskMap.set(ar.studentId, ar));

  const filteredMentees = mentees.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.rollNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.cohortName.toLowerCase().includes(searchQuery.toLowerCase());

    const isAtRisk = atRiskMap.has(m.studentId);
    if (filterAtRiskOnly && !isAtRisk) return false;
    return matchesSearch;
  });

  // Loading Skeletons
  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl w-full mx-auto space-y-6 animate-pulse">
        <div className="h-10 bg-slate-200 rounded-lg w-1/3"></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-slate-100 rounded-2xl border border-slate-200"></div>
          ))}
        </div>
        <div className="h-64 bg-slate-100 rounded-2xl border border-slate-200"></div>
        <div className="h-72 bg-slate-100 rounded-2xl border border-slate-200"></div>
      </div>
    );
  }

  // Error State
  if (errorMessage) {
    return (
      <div className="p-6 max-w-7xl w-full mx-auto">
        <Card className="p-8 text-center space-y-4 border-red-200 bg-red-50/50">
          <div className="w-12 h-12 mx-auto rounded-full bg-red-100 text-red-600 flex items-center justify-center">
            <span className="material-symbols-outlined text-2xl">error</span>
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900">Unable to load mentor cohort analytics</h2>
            <p className="text-xs text-slate-600 max-w-md mx-auto">{errorMessage}</p>
          </div>
          <Button size="sm" variant="primary" onClick={loadMentorReports}>
            Retry Cohort Load
          </Button>
        </Card>
      </div>
    );
  }

  const dist = overview?.distribution || {
    below50: 0,
    between50And59: 0,
    between60And69: 0,
    between70And79: 0,
    between80And89: 0,
    above90: 0,
  };

  const distributionBars = [
    { range: '< 50%', count: dist.below50, color: 'bg-red-400' },
    { range: '50-59%', count: dist.between50And59, color: 'bg-amber-400' },
    { range: '60-69%', count: dist.between60And69, color: 'bg-indigo-400' },
    { range: '70-79%', count: dist.between70And79, color: 'bg-indigo-600' },
    { range: '80-89%', count: dist.between80And89, color: 'bg-emerald-400' },
    { range: '90-100%', count: dist.above90, color: 'bg-emerald-600' },
  ];

  const maxDistCount = Math.max(1, ...distributionBars.map((b) => b.count));

  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 text-[11px] font-semibold mb-1">
            <span className="material-symbols-outlined text-sm">group</span>
            <span>Faculty Mentorship Cohort</span>
          </div>
          <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
            Cohort Performance & Mentee Review
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Official performance metrics aggregated strictly from assigned active mentees in your roster.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            leftIcon={<span className="material-symbols-outlined text-base">refresh</span>}
            onClick={loadMentorReports}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Overview KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 space-y-2 border-slate-200">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Assigned Mentees</span>
          <div className="flex items-baseline justify-between">
            <p className="text-3xl font-extrabold font-display text-slate-900">{overview?.activeMenteesCount ?? 0}</p>
            <span className="material-symbols-outlined text-indigo-500 text-2xl">supervisor_account</span>
          </div>
          <p className="text-xs text-slate-400">Strictly active institutional pairings</p>
        </Card>

        <Card className="p-5 space-y-2 border-slate-200">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cohort Average</span>
          <div className="flex items-baseline justify-between">
            <p className="text-3xl font-extrabold font-display text-indigo-700">
              {overview?.cohortAveragePercentage !== null && overview?.cohortAveragePercentage !== undefined
                ? `${overview.cohortAveragePercentage}%`
                : 'N/A'}
            </p>
            <span className="material-symbols-outlined text-indigo-500 text-2xl">analytics</span>
          </div>
          <p className="text-xs text-slate-400">Published evaluations baseline</p>
        </Card>

        <Card className="p-5 space-y-2 border-slate-200">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Completion Rate</span>
          <div className="flex items-baseline justify-between">
            <p className="text-3xl font-extrabold font-display text-emerald-600">{overview?.completionRate ?? 0}%</p>
            <span className="material-symbols-outlined text-emerald-500 text-2xl">task_alt</span>
          </div>
          <p className="text-xs text-slate-400">Assigned tests evaluated</p>
        </Card>

        <Card className="p-5 space-y-2 border-slate-200">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Review Indicators</span>
          <div className="flex items-baseline justify-between">
            <p className="text-3xl font-extrabold font-display text-amber-600">{overview?.atRiskCount ?? 0}</p>
            <span className="material-symbols-outlined text-amber-500 text-2xl">flag</span>
          </div>
          <p className="text-[11px] text-slate-400">Mentees flagged for guidance review</p>
        </Card>
      </div>

      {/* Cohort Score Distribution Histogram (Gaussian / Bell Curve) */}
      <Card className="p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Cohort Score Distribution</h3>
            <p className="text-xs text-slate-500">
              Distribution of published evaluation scores across your active mentee cohort.
            </p>
          </div>
          <span className="text-xs text-slate-400 font-medium">
            Total Samples: {distributionBars.reduce((acc, b) => acc + b.count, 0)}
          </span>
        </div>

        {distributionBars.every((b) => b.count === 0) ? (
          <div className="h-44 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 flex flex-col items-center justify-center p-6 text-center space-y-1">
            <span className="material-symbols-outlined text-slate-400 text-3xl">bar_chart</span>
            <p className="text-xs font-semibold text-slate-600">Distribution Graph Awaiting Published Scores</p>
            <p className="text-[11px] text-slate-400">
              As student assessments are evaluated and published, the score histogram will render here.
            </p>
          </div>
        ) : (
          <div className="h-48 bg-slate-50 rounded-xl border border-slate-200 flex items-end justify-between p-6 gap-2">
            {distributionBars.map((bar, i) => {
              const heightPct = bar.count > 0 ? Math.max(15, (bar.count / maxDistCount) * 100) : 4;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                  <span className="text-[11px] font-bold text-slate-700">{bar.count}</span>
                  <div
                    className={`w-full max-w-[50px] rounded-t-md ${bar.color} transition-all duration-300`}
                    style={{ height: `${heightPct}%` }}
                  ></div>
                  <span className="text-[10px] text-slate-500 font-mono text-center">{bar.range}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Cohort Topic Strengths & Weaknesses */}
      <Card className="p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Cohort Topic Strengths & Weaknesses</h3>
            <p className="text-xs text-slate-500">
              Aggregated topic-level competency across all active mentees in your mentorship roster.
            </p>
          </div>
          <span className="text-xs text-slate-400 font-medium">
            {cohortTopics.length} topic{cohortTopics.length === 1 ? '' : 's'} tracked
          </span>
        </div>

        {cohortTopics.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
            No cohort topic evaluation records exist yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cohortTopics.map((ct, idx) => {
              const isInsufficient = ct.status === 'insufficient_data';
              const badgeVariant =
                ct.status === 'strong'
                  ? 'success'
                  : ct.status === 'needs_improvement'
                  ? 'warning'
                  : ct.status === 'developing'
                  ? 'primary'
                  : 'neutral';

              const badgeLabel =
                ct.status === 'strong'
                  ? 'Strong'
                  : ct.status === 'needs_improvement'
                  ? 'Needs Review'
                  : ct.status === 'developing'
                  ? 'Developing'
                  : 'Insufficient Data';

              return (
                <div key={idx} className="p-4 rounded-xl border border-slate-200 bg-white space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="truncate">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        {ct.subject}
                      </span>
                      <h4 className="text-xs font-bold text-slate-900 truncate" title={ct.topic}>
                        {ct.topic}
                      </h4>
                    </div>
                    <Badge variant={badgeVariant}>{badgeLabel}</Badge>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Cohort Average</span>
                      <span className="font-bold text-slate-800">
                        {isInsufficient ? 'Pending' : `${ct.overallTopicPercentage}%`}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          ct.overallTopicPercentage >= 75
                            ? 'bg-emerald-500'
                            : ct.overallTopicPercentage >= 60
                            ? 'bg-indigo-500'
                            : 'bg-amber-500'
                        }`}
                        style={{ width: `${Math.min(100, ct.overallTopicPercentage)}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 text-[10px]">
                    <div>
                      <span className="text-slate-400 block font-medium">MCQ Accuracy</span>
                      <span className="font-semibold text-slate-700">
                        {ct.mcqAccuracy !== null ? `${ct.mcqAccuracy}%` : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">Descriptive</span>
                      <span className="font-semibold text-slate-700">
                        {ct.descriptivePercentage !== null ? `${ct.descriptivePercentage}%` : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Mentee Roster & Performance Table */}
      <Card className="p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Assigned Mentee Performance Roster</h3>
            <p className="text-xs text-slate-500">
              Live records strictly isolated to students actively assigned to your mentorship account.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setFilterAtRiskOnly(!filterAtRiskOnly)}
              className={`px-2.5 py-1 text-xs rounded-lg border font-semibold transition-colors flex items-center gap-1 ${
                filterAtRiskOnly
                  ? 'bg-amber-100 border-amber-300 text-amber-900'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="material-symbols-outlined text-sm">flag</span>
              <span>Review Indicators Only ({atRiskList.length})</span>
            </button>

            <div className="relative w-48 sm:w-60">
              <span className="material-symbols-outlined absolute left-2.5 top-2 text-slate-400 text-sm">
                search
              </span>
              <input
                type="text"
                placeholder="Search by name, roll..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        </div>

        {filteredMentees.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
            {mentees.length === 0
              ? 'No active mentees assigned to your profile.'
              : 'No mentees match your search or filter criteria.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Student Name</th>
                  <th className="py-2.5 px-3">Roll & Cohort</th>
                  <th className="py-2.5 px-3">Published Score</th>
                  <th className="py-2.5 px-3">Trajectory</th>
                  <th className="py-2.5 px-3">Advisory Status</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {filteredMentees.map((m) => {
                  const arInfo = atRiskMap.get(m.studentId);
                  const isFlagged = Boolean(arInfo);
                  const score = m.summary.overallPercentage;

                  return (
                    <tr key={m.studentId} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3 px-3">
                        <span className="font-bold text-slate-900 block">{m.name}</span>
                        <span className="text-[11px] text-slate-400">{m.email}</span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-mono text-slate-700 block">{m.rollNumber}</span>
                        <span className="text-[11px] text-slate-400">{m.cohortName}</span>
                      </td>
                      <td className="py-3 px-3 font-semibold">
                        {score !== null && score !== undefined ? (
                          <span className={score >= 75 ? 'text-emerald-700' : score >= 60 ? 'text-indigo-700' : 'text-amber-700'}>
                            {score}%
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">No published scores</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <Badge
                          variant={
                            m.summary.trendDirection === 'improving'
                              ? 'success'
                              : m.summary.trendDirection === 'declining'
                              ? 'warning'
                              : 'neutral'
                          }
                        >
                          {m.summary.trendDirection}
                        </Badge>
                      </td>
                      <td className="py-3 px-3">
                        {isFlagged ? (
                          <div className="space-y-0.5">
                            <Badge variant="warning">Indicator for Review</Badge>
                            <span className="text-[10px] text-slate-400 block truncate max-w-xs" title={arInfo?.riskReasons.join(', ')}>
                              {arInfo?.riskReasons[0]}
                            </span>
                          </div>
                        ) : (
                          <Badge variant="success">Satisfactory</Badge>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOpenMenteeDetail(m)}
                        >
                          Inspect Detail
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Individual Mentee Detail Modal */}
      {selectedStudentId && selectedMentee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-6 shadow-xl border border-slate-200">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-3 border-b border-slate-200">
              <div>
                <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">
                  Mentee Advisory Dossier
                </span>
                <h2 className="text-xl font-bold font-display text-slate-900">{selectedMentee.name}</h2>
                <p className="text-xs text-slate-500">
                  {selectedMentee.rollNumber} • {selectedMentee.cohortName} • Semester {selectedMentee.semester}
                </p>
              </div>
              <button
                onClick={handleCloseMenteeDetail}
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition-colors"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {isDetailLoading ? (
              <div className="p-8 text-center text-xs text-slate-400 space-y-2 animate-pulse">
                <span className="material-symbols-outlined text-2xl animate-spin">progress_activity</span>
                <p>Loading mentee performance dossier...</p>
              </div>
            ) : detailError ? (
              <div className="p-4 rounded-xl bg-red-50 text-red-700 text-xs border border-red-200">
                {detailError}
              </div>
            ) : (
              <div className="space-y-6">
                {/* Advisory Notice Indicator if Flagged */}
                {atRiskMap.has(selectedMentee.studentId) && (
                  <div className="p-3.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs space-y-1">
                    <p className="font-bold flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-base text-amber-600">flag</span>
                      <span>Review Indicators Noted (For Faculty Guidance, Not Definitive Judgments)</span>
                    </p>
                    <ul className="list-disc list-inside space-y-0.5 text-amber-800 text-[11px] pl-1">
                      {atRiskMap.get(selectedMentee.studentId)?.riskReasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Score Summary Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Published Score</span>
                    <p className="text-xl font-extrabold text-slate-900 mt-0.5">
                      {menteeSummary?.overallPercentage !== null && menteeSummary?.overallPercentage !== undefined
                        ? `${menteeSummary.overallPercentage}%`
                        : 'N/A'}
                    </p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Completed</span>
                    <p className="text-xl font-extrabold text-emerald-600 mt-0.5">
                      {menteeSummary?.completed ?? 0} / {menteeSummary?.totalAssigned ?? 0}
                    </p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Missed Tests</span>
                    <p className="text-xl font-extrabold text-red-600 mt-0.5">
                      {menteeSummary?.missed ?? 0}
                    </p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Trajectory</span>
                    <p className="text-base font-bold text-indigo-700 mt-0.5 capitalize">
                      {menteeSummary?.trendDirection ?? 'insufficient_data'}
                    </p>
                  </div>
                </div>

                {/* Performance Trajectory Line/Bars */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Score History Trajectory ({menteeTrends.length} Evaluations)
                  </h4>
                  {menteeTrends.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No published evaluation history available to graph.</p>
                  ) : (
                    <div className="h-32 bg-slate-50 rounded-xl border border-slate-200 flex items-end justify-between p-4 gap-2">
                      {menteeTrends.map((pt, i) => (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                          <span className="text-[10px] font-bold text-slate-700">{pt.percentage}%</span>
                          <div
                            className={`w-full max-w-[36px] rounded-t-md ${
                              pt.percentage >= 75 ? 'bg-emerald-500' : pt.percentage >= 60 ? 'bg-indigo-500' : 'bg-amber-500'
                            }`}
                            style={{ height: `${Math.max(10, pt.percentage)}%` }}
                          ></div>
                          <span className="text-[9px] text-slate-400 truncate max-w-[45px]">{pt.subject}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Topic Breakdown */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Topic Competency Matrix
                  </h4>
                  {menteeTopics.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No topic evaluations recorded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {menteeTopics.map((t, i) => (
                        <div key={i} className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 flex items-center justify-between text-xs">
                          <div>
                            <span className="font-bold text-slate-900 block">{t.subject}: {t.topic}</span>
                            <span className="text-[11px] text-slate-500">
                              MCQ: {t.mcqAccuracy !== null ? `${t.mcqAccuracy}%` : 'N/A'} • Descriptive: {t.descriptivePercentage !== null ? `${t.descriptivePercentage}%` : 'N/A'}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-slate-800 block">{t.overallTopicPercentage}%</span>
                            <Badge variant={t.status === 'strong' ? 'success' : t.status === 'needs_improvement' ? 'warning' : 'neutral'}>
                              {t.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Modal Footer */}
            <div className="pt-3 border-t border-slate-200 flex justify-end">
              <Button size="sm" variant="outline" onClick={handleCloseMenteeDetail}>
                Close Dossier
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

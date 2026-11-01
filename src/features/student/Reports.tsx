import React, { useEffect, useState, useCallback } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { apiClient } from '../../services/apiClient';
import type {
  PerformanceMetricSummary,
  StudentCounts,
  TopicAnalyticsItem,
  TrendDataPoint,
  AssessmentHistoryItem,
} from '../../types/analytics';

export const StudentReports: React.FC = () => {
  const [summary, setSummary] = useState<PerformanceMetricSummary | null>(null);
  const [counts, setCounts] = useState<StudentCounts | null>(null);
  const [topics, setTopics] = useState<TopicAnalyticsItem[]>([]);
  const [trends, setTrends] = useState<TrendDataPoint[]>([]);
  const [historyItems, setHistoryItems] = useState<AssessmentHistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState<number>(0);
  const [historyPage, setHistoryPage] = useState<number>(1);
  const historyLimit = 5;

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isHistoryLoading, setIsHistoryLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch initial summary, counts, topics, trends, and first page of history
  const loadDashboardData = useCallback(async () => {
    let isMounted = true;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [summaryRes, countsRes, topicsRes, trendsRes, historyRes] = await Promise.all([
        apiClient.getStudentAnalyticsSummary(),
        apiClient.getStudentAnalyticsCounts(),
        apiClient.getStudentAnalyticsTopics(),
        apiClient.getStudentAnalyticsTrends(),
        apiClient.getStudentAnalyticsHistory({ page: 1, limit: historyLimit }),
      ]);

      if (!isMounted) return;

      if (summaryRes.error) {
        setErrorMessage(summaryRes.error);
      } else if (summaryRes.data?.summary) {
        setSummary(summaryRes.data.summary);
      }

      if (countsRes.data?.counts) {
        setCounts(countsRes.data.counts);
      }

      if (topicsRes.data?.topics) {
        setTopics(topicsRes.data.topics);
      }

      if (trendsRes.data?.timeline) {
        setTrends(trendsRes.data.timeline);
      }

      if (historyRes.data) {
        setHistoryItems(historyRes.data.items || []);
        setHistoryTotal(historyRes.data.total || 0);
        setHistoryPage(1);
      }
    } catch (err: any) {
      if (isMounted) {
        setErrorMessage(err.message || 'Failed to connect to analytics engine.');
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
    loadDashboardData();
  }, [loadDashboardData]);

  // Fetch paginated history when page changes
  const handlePageChange = async (newPage: number) => {
    if (newPage < 1 || (newPage - 1) * historyLimit >= historyTotal) return;
    setIsHistoryLoading(true);
    try {
      const res = await apiClient.getStudentAnalyticsHistory({ page: newPage, limit: historyLimit });
      if (res.data) {
        setHistoryItems(res.data.items || []);
        setHistoryTotal(res.data.total || 0);
        setHistoryPage(newPage);
      }
    } catch (err) {
      console.error('Failed to change history page:', err);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const totalPages = Math.ceil(historyTotal / historyLimit) || 1;

  // Render Loading Skeletons
  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl w-full mx-auto space-y-6 animate-pulse">
        <div className="h-10 bg-slate-200 rounded-lg w-1/3"></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 bg-slate-100 rounded-2xl border border-slate-200"></div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-72 bg-slate-100 rounded-2xl border border-slate-200"></div>
          <div className="h-72 bg-slate-100 rounded-2xl border border-slate-200"></div>
        </div>
        <div className="h-64 bg-slate-100 rounded-2xl border border-slate-200"></div>
      </div>
    );
  }

  // Render Global Error State
  if (errorMessage) {
    return (
      <div className="p-6 max-w-7xl w-full mx-auto">
        <Card className="p-8 text-center space-y-4 border-red-200 bg-red-50/50">
          <div className="w-12 h-12 mx-auto rounded-full bg-red-100 text-red-600 flex items-center justify-center">
            <span className="material-symbols-outlined text-2xl">error</span>
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900">Unable to load analytics report</h2>
            <p className="text-xs text-slate-600 max-w-md mx-auto">{errorMessage}</p>
          </div>
          <Button size="sm" variant="primary" onClick={loadDashboardData}>
            Retry Data Load
          </Button>
        </Card>
      </div>
    );
  }

  const overallPct = summary?.overallPercentage;
  const trendDir = summary?.trendDirection || 'insufficient_data';
  const hasConsecutivePoor = Boolean(summary?.hasConsecutivePoorResults);

  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      {/* Top Banner Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 text-[11px] font-semibold mb-1">
            <span className="material-symbols-outlined text-sm">verified</span>
            <span>Published Institutional Record</span>
          </div>
          <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
            My Academic & Performance Analytics
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Official performance metrics derived strictly from published assessment evaluations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            leftIcon={<span className="material-symbols-outlined text-base">refresh</span>}
            onClick={loadDashboardData}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Consecutive Poor Alert Indicator (if active) */}
      {hasConsecutivePoor && (
        <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-600 text-xl mt-0.5">warning</span>
          <div className="text-xs space-y-1">
            <p className="font-bold">Academic Notice: Focus Recommended</p>
            <p className="text-amber-800">
              Your last two published evaluations scored under 60% (
              {summary?.consecutivePoorDetails?.previousPercentage}% and {summary?.consecutivePoorDetails?.latestPercentage}%).
              Reach out to your faculty mentor to schedule a 1:1 guidance review.
            </p>
          </div>
        </div>
      )}

      {/* Assessment Status KPI Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="p-4 space-y-1 border-slate-200">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Assigned</span>
          <p className="text-2xl font-bold font-display text-slate-900">{counts?.totalAssigned ?? 0}</p>
          <span className="text-[10px] text-slate-400">Total assigned tests</span>
        </Card>

        <Card className="p-4 space-y-1 border-slate-200">
          <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Published</span>
          <p className="text-2xl font-bold font-display text-emerald-600">{counts?.publishedResults ?? 0}</p>
          <span className="text-[10px] text-slate-400">Official results ready</span>
        </Card>

        <Card className="p-4 space-y-1 border-slate-200">
          <span className="text-[11px] font-bold text-sky-700 uppercase tracking-wider">In Progress</span>
          <p className="text-2xl font-bold font-display text-sky-600">{counts?.inProgress ?? 0}</p>
          <span className="text-[10px] text-slate-400">Active test window</span>
        </Card>

        <Card className="p-4 space-y-1 border-slate-200">
          <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider">Under Review</span>
          <p className="text-2xl font-bold font-display text-indigo-600">{counts?.submitted ?? 0}</p>
          <span className="text-[10px] text-slate-400">Pending mentor grading</span>
        </Card>

        <Card className="p-4 space-y-1 border-slate-200">
          <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Pending Start</span>
          <p className="text-2xl font-bold font-display text-amber-600">{counts?.pending ?? 0}</p>
          <span className="text-[10px] text-slate-400">Awaiting your attempt</span>
        </Card>

        <Card className="p-4 space-y-1 border-slate-200">
          <span className="text-[11px] font-bold text-red-600 uppercase tracking-wider">Missed</span>
          <p className="text-2xl font-bold font-display text-red-600">{counts?.missed ?? 0}</p>
          <span className="text-[10px] text-slate-400">Expired unattempted</span>
        </Card>
      </div>

      {/* Main Analytics Row: Overall Score & Trend Visualization */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Overall Score Summary Card */}
        <Card className="p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Overall Published Score
              </span>
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-primary flex items-center justify-center">
                <span className="material-symbols-outlined text-lg">insights</span>
              </div>
            </div>

            {overallPct !== null && overallPct !== undefined ? (
              <div className="space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold font-display text-slate-900">{overallPct}%</span>
                  <Badge
                    variant={
                      trendDir === 'improving' ? 'success' : trendDir === 'declining' ? 'warning' : 'neutral'
                    }
                  >
                    {trendDir === 'improving' && '▲ Improving'}
                    {trendDir === 'declining' && '▼ Declining'}
                    {trendDir === 'stable' && '— Stable'}
                    {trendDir === 'insufficient_data' && 'Initial Sample'}
                  </Badge>
                </div>
                <p className="text-xs text-slate-500">
                  Calculated from highest evaluated attempt across {summary?.publishedResults} published assessments.
                </p>
              </div>
            ) : (
              <div className="py-6 text-center space-y-1">
                <p className="text-base font-bold text-slate-700">No Published Scores Yet</p>
                <p className="text-xs text-slate-400">
                  Scores will populate here as soon as your mentor evaluates and publishes test results.
                </p>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-400 block text-[11px]">Marks Obtained</span>
              <span className="font-bold text-slate-800">
                {summary?.totalMarksObtained ?? 0} / {summary?.totalMaxMarks ?? 0}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Highest Score</span>
              <span className="font-bold text-slate-800">
                {summary?.highestScore !== null && summary?.highestScore !== undefined ? `${summary.highestScore}%` : 'N/A'}
              </span>
            </div>
          </div>
        </Card>

        {/* Trajectory / Performance Trend Chart */}
        <Card className="p-6 lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Performance Trajectory</h3>
              <p className="text-xs text-slate-500">Chronological history of evaluated published scores</p>
            </div>
            <span className="text-xs font-semibold text-slate-400">
              {trends.length} evaluation{trends.length === 1 ? '' : 's'}
            </span>
          </div>

          {trends.length === 0 ? (
            <div className="h-44 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 flex flex-col items-center justify-center p-6 text-center space-y-2">
              <span className="material-symbols-outlined text-slate-400 text-3xl">show_chart</span>
              <p className="text-xs font-semibold text-slate-600">Trajectory Chart Awaiting Published Data</p>
              <p className="text-[11px] text-slate-400 max-w-sm">
                As you complete evaluations and results are officially published, your chronological performance curve will be visualized here.
              </p>
            </div>
          ) : (
            <div className="h-44 flex items-end justify-between gap-3 pt-6 pb-2 px-2 border-b border-slate-200">
              {trends.map((pt, idx) => {
                const heightPct = Math.max(10, Math.min(100, pt.percentage));
                const barColor =
                  pt.percentage >= 75 ? 'bg-emerald-500' : pt.percentage >= 60 ? 'bg-indigo-500' : 'bg-amber-500';

                return (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group relative">
                    {/* Tooltip on Hover */}
                    <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] rounded px-2 py-1 pointer-events-none whitespace-nowrap z-20">
                      {pt.title}: {pt.percentage}% ({pt.score}/{pt.maxMarks})
                    </div>
                    <span className="text-[11px] font-bold text-slate-700">{pt.percentage}%</span>
                    <div
                      className={`w-full max-w-[42px] rounded-t-md ${barColor} transition-all duration-300`}
                      style={{ height: `${heightPct}%` }}
                    ></div>
                    <span className="text-[10px] text-slate-400 truncate max-w-[60px]" title={pt.title}>
                      {pt.subject}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Subject & Topic Mastery Matrix */}
      <Card className="p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Subject & Topic Competency Breakdown</h3>
            <p className="text-xs text-slate-500">
              Granular breakdown distinguishing objective MCQ accuracy from descriptive evaluative marks.
            </p>
          </div>
          <span className="text-xs text-slate-400 font-medium">
            {topics.length} topic{topics.length === 1 ? '' : 's'} tracked
          </span>
        </div>

        {topics.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
            No topic evaluation data recorded yet. Topic mastery will populate after published assessments.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {topics.map((t, idx) => {
              const isInsufficient = t.status === 'insufficient_data';
              const badgeVariant =
                t.status === 'strong'
                  ? 'success'
                  : t.status === 'needs_improvement'
                  ? 'warning'
                  : t.status === 'developing'
                  ? 'primary'
                  : 'neutral';

              const badgeLabel =
                t.status === 'strong'
                  ? 'Strong (>= 75%)'
                  : t.status === 'needs_improvement'
                  ? 'Needs Focus (< 60%)'
                  : t.status === 'developing'
                  ? 'Developing (60-74%)'
                  : 'Insufficient Data (< 3 questions)';

              return (
                <div key={idx} className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                        {t.subject}
                      </span>
                      <h4 className="text-sm font-bold text-slate-900">{t.topic}</h4>
                    </div>
                    <Badge variant={badgeVariant}>{badgeLabel}</Badge>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Overall Mastery</span>
                      <span className="font-bold text-slate-800">
                        {isInsufficient ? 'Pending Data' : `${t.overallTopicPercentage}%`}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          t.overallTopicPercentage >= 75
                            ? 'bg-emerald-500'
                            : t.overallTopicPercentage >= 60
                            ? 'bg-indigo-500'
                            : 'bg-amber-500'
                        }`}
                        style={{ width: `${Math.min(100, t.overallTopicPercentage)}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Distinct MCQ Accuracy & Descriptive Score Separation */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-[11px]">
                    <div className="space-y-0.5">
                      <span className="text-slate-400 block font-medium">MCQ Objective Accuracy</span>
                      <span className="font-semibold text-slate-800">
                        {t.mcqAccuracy !== null
                          ? `${t.mcqAccuracy}% (${t.mcqCorrectCount}/${t.mcqAttemptedCount} correct)`
                          : 'No MCQs'}
                      </span>
                    </div>

                    <div className="space-y-0.5">
                      <span className="text-slate-400 block font-medium">Descriptive Rubric Score</span>
                      <span className="font-semibold text-slate-800">
                        {t.descriptivePercentage !== null
                          ? `${t.descriptivePercentage}% (${t.descriptiveMarksObtained}/${t.descriptiveMaxMarks} marks)`
                          : 'No Descriptive'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                    <span>Questions Tracked: {t.totalQuestions}</span>
                    <span className="capitalize">Confidence: {t.confidenceLevel}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Assessment History with Pagination & Unpublished Safeguard */}
      <Card className="p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Assessment History Log</h3>
            <p className="text-xs text-slate-500">
              Verified record of all attempted assessments. Unpublished scores remain confidential until released.
            </p>
          </div>
          <span className="text-xs text-slate-400">Total Attempts: {historyTotal}</span>
        </div>

        {historyItems.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
            No assessment attempts on record yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Assessment Title</th>
                  <th className="py-2.5 px-3">Subject / Topic</th>
                  <th className="py-2.5 px-3">Attempt</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Official Score</th>
                  <th className="py-2.5 px-3">Mentor Feedback</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {historyItems.map((item) => (
                  <tr key={item.attemptId} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-3 px-3 font-medium text-slate-900">{item.title}</td>
                    <td className="py-3 px-3">
                      <span className="font-bold text-[11px] text-indigo-700 uppercase">{item.subject}</span>
                      <p className="text-slate-500 text-[11px]">{item.topic}</p>
                    </td>
                    <td className="py-3 px-3 font-mono">#{item.attemptNumber}</td>
                    <td className="py-3 px-3">
                      {item.isResultsPublished ? (
                        <Badge variant="success">Published</Badge>
                      ) : item.isEvaluated ? (
                        <Badge variant="primary">Awaiting Release</Badge>
                      ) : (
                        <Badge variant="neutral">Under Review</Badge>
                      )}
                    </td>
                    <td className="py-3 px-3 font-semibold">
                      {item.isResultsPublished ? (
                        <span className={item.passed ? 'text-emerald-700' : 'text-amber-700'}>
                          {item.totalScore} / {item.maxMarks} ({item.percentage}%)
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Hidden until publication</span>
                      )}
                    </td>
                    <td className="py-3 px-3 max-w-xs text-slate-600 truncate">
                      {item.isResultsPublished && item.mentorFeedback ? item.mentorFeedback : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-slate-100 text-xs text-slate-500">
            <span>
              Page {historyPage} of {totalPages} ({historyTotal} items)
            </span>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={historyPage <= 1 || isHistoryLoading}
                onClick={() => handlePageChange(historyPage - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={historyPage >= totalPages || isHistoryLoading}
                onClick={() => handlePageChange(historyPage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

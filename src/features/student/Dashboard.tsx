import React from 'react';
import { Link } from 'react-router-dom';
import { CURRENT_STUDENT, MOCK_ASSESSMENTS, MOCK_LEARNING_MODULES } from '../../services/mockData';
import { useAuth } from '../../context/AuthContext';
import { StatCard } from '../../components/ui/StatCard';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

export const StudentDashboard: React.FC = () => {
  const { profile } = useAuth();
  const studentName = profile?.name || CURRENT_STUDENT.name;
  const cohortName = profile?.studentDetails?.cohortName || CURRENT_STUDENT.cohort;
  const semester = profile?.studentDetails?.semester || CURRENT_STUDENT.semester;
  const overallScore = profile?.studentDetails?.overallScore ?? CURRENT_STUDENT.overallScore;

  const activeAssessments = MOCK_ASSESSMENTS.filter((a) => a.status === 'active');
  const currentModule = MOCK_LEARNING_MODULES[0];

  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      {/* Student Welcome Banner */}
      <div className="rounded-2xl border border-outline-variant bg-gradient-to-r from-surface-container-lowest via-white to-sky-50/40 p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden">
        <div className="space-y-1.5 z-10">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-sky-100/80 border border-sky-200 text-sky-800 text-[11px] font-semibold mb-1">
            <span className="material-symbols-outlined text-sm">school</span>
            <span>{cohortName} • Semester {semester}</span>
          </div>
          <h1 className="font-display text-2xl lg:text-3xl text-slate-900 font-bold tracking-tight">
            Welcome back, {studentName}!
          </h1>
          <p className="text-slate-600 max-w-2xl text-xs sm:text-sm leading-relaxed">
            Your technical performance trajectory is tracked via verified institutional metrics. Your next 1:1 code review with your assigned faculty advisor is accessible in the advisor portal.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 z-10 shrink-0">
          <Link to="/student/mentor">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<span className="material-symbols-outlined text-primary text-base">forum</span>}
            >
              Message Advisor
            </Button>
          </Link>
          <Link to="/student/coding">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<span className="material-symbols-outlined text-base">terminal</span>}
            >
              Resume Coding Drill
            </Button>
          </Link>
        </div>
      </div>

      {/* 4 High Impact Student KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Overall Performance"
          value={`${overallScore}%`}
          change="+3.1% this month"
          isPositive={true}
          subtext="Batch Avg: 76.4%"
          actionText="Distinction tier"
          iconName="insights"
          iconColor="primary"
        />
        <StatCard
          title="DSA Problems Solved"
          value={CURRENT_STUDENT.dsaSolved}
          change="+12 this sprint"
          isPositive={true}
          subtext="Goal: 200 before placement"
          actionText="71% completed"
          iconName="code"
          iconColor="sky"
        />
        <StatCard
          title="Assessments Completed"
          value={CURRENT_STUDENT.assessmentsCompleted}
          change="100% on-time"
          isPositive={true}
          subtext="2 active assessments due"
          actionText="On-track"
          iconName="fact_check"
          iconColor="emerald"
        />
        <StatCard
          title="Batch Standing"
          value={`#${CURRENT_STUDENT.rank}`}
          change="Top 5.0%"
          isPositive={true}
          subtext={`Out of ${CURRENT_STUDENT.totalStudents} students`}
          actionText="Gold Badge"
          iconName="military_tech"
          iconColor="amber"
        />
      </div>

      {/* Main Grid: Active Deliverables & DSA Roadmap */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Active Due Assessments */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-outline-variant">
            <h2 className="font-display text-base font-bold text-slate-900 flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-500 text-lg">timer</span>
              <span>Pending Technical Assessments</span>
            </h2>
            <Link to="/student/assessments" className="text-xs font-semibold text-primary hover:underline">
              View All Assessments
            </Link>
          </div>

          <div className="space-y-3">
            {activeAssessments.map((a) => (
              <Card key={a.id} hoverEffect className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="warning">Due Soon</Badge>
                    <span className="text-xs font-mono font-semibold text-primary">{a.category}</span>
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm">{a.title}</h3>
                  <p className="text-xs text-slate-500">
                    Duration: {a.durationMinutes} mins • {a.totalQuestions} Questions • Due {a.dueDate}
                  </p>
                </div>
                <Link to="/student/assessments">
                  <Button size="sm" variant="primary" className="text-xs px-3 py-1.5 shrink-0">
                    Take Exam
                  </Button>
                </Link>
              </Card>
            ))}
          </div>

          {/* Active Learning Module Card */}
          <Card className="p-5 space-y-3 mt-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-mono font-semibold text-primary">{currentModule.code}</span>
                <h3 className="font-bold text-slate-900 text-sm mt-0.5">{currentModule.title}</h3>
              </div>
              <Badge variant="primary">Week {currentModule.weekNumber}</Badge>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Progress: {currentModule.completedLessons} of {currentModule.totalLessons} Lessons</span>
                <span className="font-semibold">{Math.round((currentModule.completedLessons / currentModule.totalLessons) * 100)}%</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-primary h-full rounded-full"
                  style={{ width: `${(currentModule.completedLessons / currentModule.totalLessons) * 100}%` }}
                ></div>
              </div>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-slate-100 text-xs">
              <span className="text-slate-500 text-[11px]">Est. time remaining: 4.5 hours</span>
              <Link to="/student/learning">
                <Button size="sm" variant="outline" className="text-xs px-2.5 py-1">
                  Continue Module
                </Button>
              </Link>
            </div>
          </Card>
        </div>

        {/* Right: DSA Preparation Breakdown & Mentor Note */}
        <div className="lg:col-span-5 space-y-4">
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-display text-sm font-bold text-slate-900">Placement DSA Preparation</h3>
              <span className="text-xs font-mono text-indigo-700 font-bold">142 Solved</span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="font-semibold text-emerald-700">Easy (Foundational)</span>
                  <span className="font-bold text-slate-800">58 / 65</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-full rounded-full" style={{ width: '89%' }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="font-semibold text-amber-700">Medium (Core Placement)</span>
                  <span className="font-bold text-slate-800">66 / 100</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-amber-500 h-full rounded-full" style={{ width: '66%' }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="font-semibold text-red-700">Hard (Advanced Competitive)</span>
                  <span className="font-bold text-slate-800">18 / 35</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-red-500 h-full rounded-full" style={{ width: '51%' }}></div>
                </div>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1">
              <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm text-primary">person</span>
                <span>Advisor Weekly Guidance:</span>
              </p>
              <p className="text-[11px] leading-relaxed">
                "Great work on the Dynamic Programming set, Alex. Focus this week on multi-threading sync primitives for Criterion 3.2 compliance." — Dr. Vance
              </p>
            </div>

            <Link to="/student/coding" className="block w-full">
              <Button size="sm" variant="outline" className="w-full text-xs">
                Open Coding Practice IDE
              </Button>
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
};


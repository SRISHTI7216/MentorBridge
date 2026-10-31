import React, { useState } from 'react';
import { MOCK_ASSESSMENTS } from '../../services/mockData';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

export const StudentAssessments: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>('pending');
  const [examModalAssessment, setExamModalAssessment] = useState<typeof MOCK_ASSESSMENTS[0] | null>(null);

  const displayed = MOCK_ASSESSMENTS.filter((a) => {
    if (activeTab === 'pending') return a.status === 'active' || a.status === 'upcoming';
    return a.status === 'completed';
  });

  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
            My Technical Assessments
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Institutional examinations, automated coding rubrics, and continuous progress scores.
          </p>
        </div>
        <div className="flex bg-surface-container p-1 rounded-xl text-xs font-semibold">
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === 'pending' ? 'bg-white text-primary shadow-xs' : 'text-slate-600'
            }`}
          >
            Pending / Active ({MOCK_ASSESSMENTS.filter((a) => a.status !== 'completed').length})
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === 'completed' ? 'bg-white text-primary shadow-xs' : 'text-slate-600'
            }`}
          >
            Graded History ({MOCK_ASSESSMENTS.filter((a) => a.status === 'completed').length})
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {displayed.map((a) => (
          <Card key={a.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-2 flex-1">
              <div className="flex items-center gap-2">
                <Badge variant={a.status === 'active' ? 'warning' : a.status === 'completed' ? 'success' : 'neutral'}>
                  {a.status === 'active' ? 'Due Soon' : a.status === 'completed' ? 'Graded' : 'Scheduled'}
                </Badge>
                <span className="text-xs font-mono font-semibold text-primary">{a.category}</span>
                <span className="text-slate-300">•</span>
                <span className="text-xs text-slate-500">{a.course}</span>
              </div>
              <h2 className="text-base font-bold text-slate-900">{a.title}</h2>
              <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                <span>Duration: {a.durationMinutes} Minutes</span>
                <span>•</span>
                <span>Total Questions: {a.totalQuestions}</span>
                <span>•</span>
                <span>Deadline: {a.dueDate}</span>
              </div>
            </div>

            <div className="flex items-center gap-4 border-t md:border-t-0 md:border-l border-slate-100 pt-3 md:pt-0 md:pl-6 text-xs">
              {a.studentScore !== undefined ? (
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold">Your Score</p>
                  <p className="font-bold text-emerald-700 text-base mt-0.5">{a.studentScore}%</p>
                </div>
              ) : null}

              {a.status === 'active' ? (
                <Button size="sm" variant="primary" onClick={() => setExamModalAssessment(a)}>
                  Launch Assessment
                </Button>
              ) : (
                <Button size="sm" variant="outline">
                  View Graded Rubric
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* Online Assessment Interface Preview Modal (Adapting Stitch Examination Interface) */}
      {examModalAssessment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-outline-variant max-w-2xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="text-[10px] font-mono text-primary uppercase font-bold tracking-wider">
                  Proctored Examination Mode (Phase 1 Preview)
                </span>
                <h3 className="font-bold text-base text-slate-900 mt-0.5">{examModalAssessment.title}</h3>
              </div>
              <button onClick={() => setExamModalAssessment(null)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3 text-xs">
              <div className="flex items-center justify-between font-mono text-slate-600">
                <span>Timer: 00:{examModalAssessment.durationMinutes}:00</span>
                <span>Candidate: Alex Chen (21CSE104)</span>
              </div>
              <div className="p-3 bg-white rounded-lg border border-slate-200">
                <p className="font-semibold text-slate-900">
                  Question 1 of {examModalAssessment.totalQuestions}:
                </p>
                <p className="text-slate-600 mt-1">
                  Given an undirected weighted graph G=(V,E), implement an efficient algorithm to compute the shortest cycle. Analyze time complexity.
                </p>
              </div>
              <div className="p-2 bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-lg text-[11px]">
                <strong>Phase 1 Note:</strong> The complete timed assessment engine, compiler sandbox, and AI evaluation belong to Phase 2.
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button size="sm" variant="outline" onClick={() => setExamModalAssessment(null)}>
                Close Preview
              </Button>
              <Button size="sm" variant="primary" onClick={() => { alert('Phase 1 Examination Preview complete.'); setExamModalAssessment(null); }}>
                Submit Mock Assessment
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


import React, { useState } from 'react';
import { MOCK_ASSESSMENTS } from '../../services/mockData';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

export const MentorAssessments: React.FC = () => {
  const [filterCategory, setFilterCategory] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const assessments = MOCK_ASSESSMENTS.filter((a) => {
    return filterCategory === 'all' || a.category.toLowerCase() === filterCategory.toLowerCase();
  });

  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
            Mentor Assessment & Rubric Management
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Author, evaluate, and calibrate semester-long coding assessments mapped to ABET Criterion 3.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowCreateModal(true)}
          leftIcon={<span className="material-symbols-outlined text-base">add_circle</span>}
        >
          + Create New Assessment
        </Button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 text-xs">
        {['all', 'DSA', 'OS', 'DBMS', 'System Design'].map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              filterCategory === cat
                ? 'bg-primary text-white font-semibold shadow-xs'
                : 'bg-surface-container-lowest text-slate-700 border border-outline-variant hover:bg-slate-50'
            }`}
          >
            {cat === 'all' ? 'All Disciplines' : cat}
          </button>
        ))}
      </div>

      {/* Assessment Cards */}
      <div className="space-y-4">
        {assessments.map((a) => (
          <Card key={a.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-2 flex-1">
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    a.status === 'active'
                      ? 'warning'
                      : a.status === 'completed'
                      ? 'success'
                      : 'neutral'
                  }
                >
                  {a.status === 'active' ? 'Active Exam' : a.status === 'completed' ? 'Graded' : 'Scheduled'}
                </Badge>
                <span className="text-xs font-mono font-semibold text-primary">{a.category}</span>
                <span className="text-slate-300">•</span>
                <span className="text-xs text-slate-500">{a.course}</span>
              </div>

              <h2 className="text-base font-bold text-slate-900">{a.title}</h2>

              {a.rubricCriteria && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {a.rubricCriteria.map((r, i) => (
                    <span key={i} className="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-mono">
                      Rubric: {r}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Assessment stats & actions */}
            <div className="flex flex-wrap items-center gap-6 border-t md:border-t-0 md:border-l border-slate-100 pt-3 md:pt-0 md:pl-6 text-xs">
              <div className="text-center">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Submissions</p>
                <p className="font-bold text-slate-900 text-sm mt-0.5">
                  {a.submissionsCount} / {a.totalAssigned}
                </p>
              </div>

              {a.averageScore !== undefined && (
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold">Cohort Mean</p>
                  <p className="font-bold text-indigo-700 text-sm mt-0.5">{a.averageScore}%</p>
                </div>
              )}

              <div className="text-center">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Duration / Due</p>
                <p className="font-semibold text-slate-700 text-xs mt-0.5">{a.durationMinutes}m • {a.dueDate}</p>
              </div>

              <div className="flex gap-2">
                <Button size="sm" variant="outline">
                  View Rubric
                </Button>
                <Button size="sm" variant="primary">
                  Review Queue ({a.submissionsCount})
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Create Modal Dialog Preview */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-outline-variant max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="font-bold text-base text-slate-900">Author New Assessment Rubric</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Set evaluation parameters for your mentee cohort. In Phase 2, this will persist to Supabase PostgreSQL and trigger automatic AI-assisted code evaluation.
            </p>
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-800">Assessment Title</label>
                <input
                  type="text"
                  placeholder="e.g., Graph Algorithms & Bounded Buffer Problem"
                  className="w-full mt-1 px-3 py-2 border rounded-lg outline-none focus:border-primary"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-800">Category</label>
                  <select className="w-full mt-1 px-3 py-2 border rounded-lg outline-none focus:border-primary">
                    <option>DSA</option>
                    <option>OS & Threads</option>
                    <option>DBMS</option>
                    <option>System Design</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-800">Duration (Minutes)</label>
                  <input
                    type="number"
                    defaultValue={60}
                    className="w-full mt-1 px-3 py-2 border rounded-lg outline-none focus:border-primary"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <Button size="sm" variant="outline" onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={() => { alert('Phase 1 Prototype: Assessment created in mock state.'); setShowCreateModal(false); }}>
                Save Assessment Draft
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


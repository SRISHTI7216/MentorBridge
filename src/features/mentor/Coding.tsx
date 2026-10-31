import React, { useState } from 'react';
import { MOCK_CODING_CHALLENGES } from '../../services/mockData';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

export const MentorCoding: React.FC = () => {
  const [filterDifficulty, setFilterDifficulty] = useState('all');

  const challenges = MOCK_CODING_CHALLENGES.filter((c) => {
    return filterDifficulty === 'all' || c.difficulty.toLowerCase() === filterDifficulty.toLowerCase();
  });

  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
            Coding Challenges & Git Review Repository
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Curate algorithmic problem sheets, verify Git pull request submissions, and set automated test benchmarks.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" leftIcon={<span className="material-symbols-outlined text-base">sync</span>}>
            Trigger GitSync
          </Button>
          <Button size="sm" variant="primary" leftIcon={<span className="material-symbols-outlined text-base">add_code</span>}>
            + Add Problem Statement
          </Button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 text-xs">
        {['all', 'Easy', 'Medium', 'Hard'].map((diff) => (
          <button
            key={diff}
            onClick={() => setFilterDifficulty(diff)}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              filterDifficulty === diff
                ? 'bg-primary text-white font-semibold shadow-xs'
                : 'bg-surface-container-lowest text-slate-700 border border-outline-variant hover:bg-slate-50'
            }`}
          >
            {diff === 'all' ? 'All Difficulties' : diff}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {challenges.map((c) => (
          <Card key={c.id} hoverEffect className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    c.difficulty === 'Easy'
                      ? 'success'
                      : c.difficulty === 'Medium'
                      ? 'warning'
                      : 'error'
                  }
                >
                  {c.difficulty}
                </Badge>
                <span className="text-xs font-mono text-slate-500">{c.category}</span>
                <span className="text-slate-300">•</span>
                <span className="text-xs text-slate-500">Acceptance: {c.acceptanceRate}%</span>
              </div>
              <h3 className="font-bold text-slate-900 text-sm">{c.title}</h3>
              <div className="flex flex-wrap gap-1">
                {c.tags.map((t, idx) => (
                  <span key={idx} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                    #{t}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs border-t md:border-t-0 md:border-l border-slate-100 pt-3 md:pt-0 md:pl-6">
              <div className="text-center">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Cohort Solved</p>
                <p className="font-bold text-slate-900 text-sm mt-0.5">{c.solvedCount}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Weightage</p>
                <p className="font-bold text-indigo-700 text-sm mt-0.5">{c.points} pts</p>
              </div>
              <Button size="sm" variant="outline">
                Review Test Cases
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};


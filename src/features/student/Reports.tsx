import React from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

export const StudentReports: React.FC = () => {
  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
            My Academic & Skill Performance Reports
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Personalized progress trajectory across CSE core competencies and ABET Criterion 3 benchmarks.
          </p>
        </div>
        <Button size="sm" variant="outline" leftIcon={<span className="material-symbols-outlined text-base">download</span>}>
          Export Transcript Summary
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5 space-y-2">
          <span className="text-xs font-semibold text-slate-500 uppercase">Cumulative Score</span>
          <p className="text-3xl font-bold font-display text-primary">84.5%</p>
          <p className="text-xs text-emerald-700 font-semibold">+3.1% above cohort baseline</p>
        </Card>
        <Card className="p-5 space-y-2">
          <span className="text-xs font-semibold text-slate-500 uppercase">ABET Criterion Standing</span>
          <p className="text-3xl font-bold font-display text-emerald-600">Level 4 (Exceeds)</p>
          <p className="text-xs text-slate-500">Satisfies SO-1, SO-2, and SO-6 graduation standards.</p>
        </Card>
        <Card className="p-5 space-y-2">
          <span className="text-xs font-semibold text-slate-500 uppercase">Peer Standing</span>
          <p className="text-3xl font-bold font-display text-indigo-700">94.0th %ile</p>
          <p className="text-xs text-slate-500">Rank #7 of 140 students in Department of CSE.</p>
        </Card>
      </div>

      <Card className="p-6 space-y-4">
        <h3 className="font-bold text-slate-900 text-sm">Competency Radar Matrix</h3>
        <div className="space-y-3 text-xs">
          {[
            { skill: "Data Structures & Algorithmic Complexity", score: 89, color: "bg-indigo-600" },
            { skill: "Object-Oriented Design & Scalability", score: 85, color: "bg-indigo-500" },
            { skill: "Database Architecture & Optimization", score: 82, color: "bg-indigo-500" },
            { skill: "Operating Systems & Concurrency (Focus Area)", score: 72, color: "bg-amber-500" },
            { skill: "Computer Networks & Protocols", score: 79, color: "bg-indigo-500" },
          ].map((item, i) => (
            <div key={i}>
              <div className="flex justify-between mb-1">
                <span className="font-semibold text-slate-800">{item.skill}</span>
                <span className="font-bold text-slate-900">{item.score}%</span>
              </div>
              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                <div className={`${item.color} h-full rounded-full`} style={{ width: `${item.score}%` }}></div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};


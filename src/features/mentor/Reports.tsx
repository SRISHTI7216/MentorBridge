import React from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

export const MentorReports: React.FC = () => {
  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
            ABET & Cohort Performance Reports
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Psychometric outcome analysis, ABET Criterion 3 Student Outcome mastery, and term progression.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" leftIcon={<span className="material-symbols-outlined text-base">picture_as_pdf</span>}>
            Download PDF Report
          </Button>
          <Button size="sm" variant="primary" leftIcon={<span className="material-symbols-outlined text-base">table_chart</span>}>
            Export CSV Dataset
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5 space-y-2">
          <span className="text-xs font-semibold text-slate-500 uppercase">Criterion 3.1: Algorithmic Rigor</span>
          <p className="text-2xl font-bold font-display text-emerald-600">82.4% Mastery</p>
          <p className="text-xs text-slate-500">Benchmark requirement: 70%. 38 of 42 students meet or exceed target threshold.</p>
        </Card>
        <Card className="p-5 space-y-2">
          <span className="text-xs font-semibold text-slate-500 uppercase">Criterion 3.2: System Concurrency</span>
          <p className="text-2xl font-bold font-display text-amber-600">69.0% Mastery</p>
          <p className="text-xs text-slate-500">Requires targeted lab drills in thread locks, deadlock avoidance, and POSIX primitives.</p>
        </Card>
        <Card className="p-5 space-y-2">
          <span className="text-xs font-semibold text-slate-500 uppercase">Criterion 3.5: Software Design</span>
          <p className="text-2xl font-bold font-display text-indigo-600">80.5% Mastery</p>
          <p className="text-xs text-slate-500">Evaluated across weekly Git pull request reviews and clean code rubric standards.</p>
        </Card>
      </div>

      <Card className="p-6 space-y-4">
        <h3 className="font-bold text-slate-900 text-sm">Cohort Psychometric Distribution (Bell Curve)</h3>
        <p className="text-xs text-slate-500">
          Gaussian distribution of mentee performance across 12 assessments in AY 2024–25.
        </p>
        <div className="h-48 bg-slate-50 rounded-xl border border-slate-200 flex items-end justify-between p-6 gap-2">
          {[
            { range: "<50%", count: 1, height: "15%", color: "bg-red-400" },
            { range: "50-60%", count: 4, height: "30%", color: "bg-amber-400" },
            { range: "60-70%", count: 8, height: "55%", color: "bg-indigo-400" },
            { range: "70-80%", count: 18, height: "90%", color: "bg-primary" },
            { range: "80-90%", count: 9, height: "65%", color: "bg-emerald-400" },
            { range: "90-100%", count: 2, height: "25%", color: "bg-emerald-600" },
          ].map((bar, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
              <span className="text-[11px] font-bold text-slate-700">{bar.count}</span>
              <div className={`w-full rounded-t-md ${bar.color}`} style={{ height: bar.height }}></div>
              <span className="text-[10px] text-slate-500 font-mono">{bar.range}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};


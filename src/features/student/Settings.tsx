import React, { useState } from 'react';
import { CURRENT_STUDENT } from '../../services/mockData';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

export const StudentSettings: React.FC = () => {
  const [githubHandle, setGithubHandle] = useState('alexchen-cse');
  const [leetcodeHandle, setLeetcodeHandle] = useState('alex_codes');
  const [isSaved, setIsSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div className="p-6 max-w-4xl w-full mx-auto space-y-6">
      <div className="pb-4 border-b border-outline-variant">
        <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
          Student Profile & Integrations
        </h1>
        <p className="text-xs text-on-surface-variant mt-1">
          Manage your student profile, linked GitHub account for automated PR reviews, and notification settings.
        </p>
      </div>

      <Card className="p-6 space-y-6">
        <form onSubmit={handleSave} className="space-y-5 text-xs">
          <div className="flex items-center gap-4 pb-4 border-b border-slate-100">
            <img
              src={CURRENT_STUDENT.avatarUrl}
              alt={CURRENT_STUDENT.name}
              className="w-16 h-16 rounded-full object-cover ring-4 ring-sky-500/20"
            />
            <div>
              <h3 className="font-bold text-slate-900 text-sm">{CURRENT_STUDENT.name}</h3>
              <p className="text-slate-500 font-mono mt-0.5">Roll No: {CURRENT_STUDENT.rollOrEmpId}</p>
              <p className="text-slate-600 mt-0.5">{CURRENT_STUDENT.cohort} • Semester {CURRENT_STUDENT.semester}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="font-semibold text-slate-800">Department</label>
              <input
                type="text"
                disabled
                value={CURRENT_STUDENT.department}
                className="w-full mt-1.5 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-800">Institutional Email</label>
              <input
                type="email"
                disabled
                value={CURRENT_STUDENT.email}
                className="w-full mt-1.5 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 cursor-not-allowed font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="font-semibold text-slate-800">GitHub Username (for Code Review GitSync)</label>
              <input
                type="text"
                value={githubHandle}
                onChange={(e) => setGithubHandle(e.target.value)}
                className="w-full mt-1.5 px-3 py-2 border border-outline-variant rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none font-mono"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-800">LeetCode / Coding Handle</label>
              <input
                type="text"
                value={leetcodeHandle}
                onChange={(e) => setLeetcodeHandle(e.target.value)}
                className="w-full mt-1.5 px-3 py-2 border border-outline-variant rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none font-mono"
              />
            </div>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <h4 className="font-bold text-slate-800">Notification Alerts</h4>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" defaultChecked className="rounded text-primary focus:ring-primary" />
              <span>Email reminder 24 hours before assessment deadlines</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" defaultChecked className="rounded text-primary focus:ring-primary" />
              <span>Notify when advisor leaves review feedback on code repository</span>
            </label>
          </div>

          {isSaved && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">check_circle</span>
              <span>Student profile updated successfully. (Phase 1 local simulation)</span>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button type="submit" size="sm">
              Save Student Profile
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};


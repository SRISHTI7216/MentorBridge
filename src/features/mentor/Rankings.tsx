import React from 'react';
import { MOCK_LEADERBOARD } from '../../services/mockData';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

export const MentorRankings: React.FC = () => {
  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
            Cohort Rankings & Performance Standings
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Standardized points across DSA, continuous evaluations, code quality, and peer review assistance.
          </p>
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-6 py-3.5">Standing</th>
                <th className="px-6 py-3.5">Mentee Name</th>
                <th className="px-6 py-3.5">Roll No</th>
                <th className="px-6 py-3.5">Cohort</th>
                <th className="px-6 py-3.5">Coding Score</th>
                <th className="px-6 py-3.5">Total Points</th>
                <th className="px-6 py-3.5">Percentile</th>
                <th className="px-6 py-3.5">Tier Badge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {MOCK_LEADERBOARD.map((entry) => (
                <tr key={entry.rollNo} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-6 py-4 font-bold font-display text-sm text-slate-900">
                    #{entry.rank}
                  </td>
                  <td className="px-6 py-4 font-semibold text-slate-900">
                    {entry.studentName}
                  </td>
                  <td className="px-6 py-4 font-mono text-slate-500">
                    {entry.rollNo}
                  </td>
                  <td className="px-6 py-4 text-slate-600">
                    {entry.cohort}
                  </td>
                  <td className="px-6 py-4 font-mono font-semibold text-indigo-700">
                    {entry.codingScore} pts
                  </td>
                  <td className="px-6 py-4 font-bold text-slate-900">
                    {entry.points}
                  </td>
                  <td className="px-6 py-4 text-emerald-700 font-semibold">
                    {entry.percentile}th %ile
                  </td>
                  <td className="px-6 py-4">
                    <Badge
                      variant={
                        entry.badge === 'Platinum'
                          ? 'primary'
                          : entry.badge === 'Gold'
                          ? 'warning'
                          : entry.badge === 'Silver'
                          ? 'neutral'
                          : 'secondary'
                      }
                    >
                      {entry.badge}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};


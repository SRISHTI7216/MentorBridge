import React from 'react';
import { MOCK_LEADERBOARD } from '../../services/mockData';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

export const StudentRankings: React.FC = () => {
  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
            Batch Rankings & Leaderboard Standings
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Performance points calibrated across DSA problem solving, assessment scores, and peer assistance.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5 border-t-4 border-t-amber-400">
          <span className="text-xs font-semibold text-slate-500 uppercase">Your Batch Position</span>
          <p className="text-3xl font-bold font-display text-slate-900 mt-1">Rank #7</p>
          <p className="text-xs text-amber-700 font-semibold mt-0.5">Top 5.0% • Gold Tier Standing</p>
        </Card>
        <Card className="p-5 border-t-4 border-t-primary">
          <span className="text-xs font-semibold text-slate-500 uppercase">Total Points Earned</span>
          <p className="text-3xl font-bold font-display text-primary mt-1">1,980 pts</p>
          <p className="text-xs text-slate-500 mt-0.5">+140 points in last sprint</p>
        </Card>
        <Card className="p-5 border-t-4 border-t-emerald-500">
          <span className="text-xs font-semibold text-slate-500 uppercase">Next Milestone</span>
          <p className="text-3xl font-bold font-display text-emerald-600 mt-1">Top 3 (Platinum)</p>
          <p className="text-xs text-slate-500 mt-0.5">210 points to overtake rank #3</p>
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-6 py-3.5">Standing</th>
                <th className="px-6 py-3.5">Student Name</th>
                <th className="px-6 py-3.5">Roll No</th>
                <th className="px-6 py-3.5">Cohort</th>
                <th className="px-6 py-3.5">Assessments</th>
                <th className="px-6 py-3.5">Coding Pts</th>
                <th className="px-6 py-3.5">Total Points</th>
                <th className="px-6 py-3.5">Badge Tier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {MOCK_LEADERBOARD.map((entry) => {
                const isCurrent = entry.studentName.includes('(You)');
                return (
                  <tr
                    key={entry.rollNo}
                    className={`transition-colors ${
                      isCurrent ? 'bg-indigo-50/80 font-bold border-l-4 border-indigo-600' : 'hover:bg-slate-50'
                    }`}
                  >
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
                    <td className="px-6 py-4 text-slate-700">
                      {entry.assessmentsCompleted}
                    </td>
                    <td className="px-6 py-4 font-mono text-indigo-700 font-semibold">
                      {entry.codingScore}
                    </td>
                    <td className="px-6 py-4 font-bold text-slate-900">
                      {entry.points}
                    </td>
                    <td className="px-6 py-4">
                      <Badge
                        variant={
                          entry.badge === 'Platinum'
                            ? 'primary'
                            : entry.badge === 'Gold'
                            ? 'warning'
                            : 'neutral'
                        }
                      >
                        {entry.badge}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};


import React from 'react';
import { MOCK_LEARNING_MODULES } from '../../services/mockData';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

export const StudentLearning: React.FC = () => {
  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
            Technical Learning Curriculum & Sprints
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Structured modules recommended by your faculty advisor for placement preparation and coursework.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {MOCK_LEARNING_MODULES.map((mod) => (
          <Card key={mod.id} hoverEffect className="p-5 flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-semibold text-primary">{mod.code}</span>
                <Badge variant={mod.status === 'completed' ? 'success' : mod.status === 'in_progress' ? 'primary' : 'neutral'}>
                  {mod.status === 'completed' ? 'Completed' : mod.status === 'in_progress' ? 'In Progress' : 'Locked'}
                </Badge>
              </div>
              <h3 className="font-bold text-slate-900 text-sm mt-1">{mod.title}</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Week {mod.weekNumber} • Level: {mod.level} • {mod.estimatedHours} hrs allocated
              </p>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>{mod.completedLessons} of {mod.totalLessons} lessons completed</span>
                <span className="font-bold">{Math.round((mod.completedLessons / mod.totalLessons) * 100)}%</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-primary h-full rounded-full"
                  style={{ width: `${(mod.completedLessons / mod.totalLessons) * 100}%` }}
                ></div>
              </div>
            </div>

            <div className="flex flex-wrap gap-1">
              {mod.skills.map((s, idx) => (
                <span key={idx} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                  {s}
                </span>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
              <span className="text-slate-400 text-[11px]">
                {mod.status === 'locked' ? 'Unlocks after Week 8 quiz' : 'Self-paced milestone'}
              </span>
              <Button
                size="sm"
                variant={mod.status === 'locked' ? 'outline' : 'primary'}
                disabled={mod.status === 'locked'}
                className="text-xs px-3 py-1"
              >
                {mod.status === 'completed' ? 'Review Lessons' : mod.status === 'in_progress' ? 'Continue Lesson' : 'Locked'}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};


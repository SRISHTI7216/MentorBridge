import React from 'react';
import { MOCK_LEARNING_MODULES } from '../../services/mockData';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

export const MentorLearning: React.FC = () => {
  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
            Curricular Learning Modules & Sprints
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Curate technical roadmaps, assign weekly reading modules, and verify milestone completions.
          </p>
        </div>
        <Button size="sm" leftIcon={<span className="material-symbols-outlined text-base">playlist_add</span>}>
          + Assign New Module
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {MOCK_LEARNING_MODULES.map((mod) => (
          <Card key={mod.id} hoverEffect className="p-5 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-semibold text-primary">{mod.code}</span>
                <Badge variant={mod.status === 'completed' ? 'success' : mod.status === 'in_progress' ? 'primary' : 'neutral'}>
                  {mod.status === 'completed' ? 'Completed' : mod.status === 'in_progress' ? 'Active Sprint' : 'Locked'}
                </Badge>
              </div>
              <h3 className="font-bold text-slate-900 text-sm mt-1">{mod.title}</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Week {mod.weekNumber} • Level: {mod.level} • Est. {mod.estimatedHours} hrs
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-600">
                <span>Progress: {mod.completedLessons} of {mod.totalLessons} lessons completed</span>
                <span className="font-semibold">{Math.round((mod.completedLessons / mod.totalLessons) * 100)}%</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-primary h-full rounded-full transition-all"
                  style={{ width: `${(mod.completedLessons / mod.totalLessons) * 100}%` }}
                ></div>
              </div>
            </div>

            <div className="flex flex-wrap gap-1 pt-1">
              {mod.skills.map((skill, idx) => (
                <span key={idx} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                  {skill}
                </span>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
              <span className="text-slate-400 text-[11px]">Assigned to: Cohort CSE-A & CSE-B</span>
              <Button size="sm" variant="outline" className="text-xs px-2.5 py-1">
                Edit Syllabus
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};


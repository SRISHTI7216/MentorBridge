import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, LearningModuleSummary } from '../../services/apiClient';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

type ModuleDetail = {
  module: LearningModuleSummary;
  lessons: Array<Record<string, any>>;
  resources: Array<Record<string, any>>;
  enrollment: Record<string, any> | null;
  progress: Record<string, any> | null;
  canEnroll: boolean;
  canAssignedEnroll: boolean;
};

export const StudentLearning: React.FC = () => {
  const [modules, setModules] = useState<LearningModuleSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ModuleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadModules = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiClient.getStudentLearningModules();
    if (result.error || !result.data) {
      setError(result.error || 'Learning modules could not be loaded.');
      setModules([]);
    } else {
      setModules(result.data.modules || []);
    }
    setLoading(false);
  }, []);

  const loadDetail = useCallback(async (moduleId: string) => {
    setSelectedId(moduleId);
    setDetailLoading(true);
    setError(null);
    const result = await apiClient.getStudentLearningModule(moduleId);
    if (result.error || !result.data) {
      setDetail(null);
      setError(result.error || 'Module details could not be loaded.');
    } else {
      setDetail(result.data as ModuleDetail);
    }
    setDetailLoading(false);
  }, []);

  useEffect(() => { void loadModules(); }, [loadModules]);

  const enroll = async (moduleId: string) => {
    setActionLoading(true);
    setError(null);
    const result = await apiClient.enrollStudentLearningModule(moduleId);
    if (result.error) {
      setError(result.error);
      setActionLoading(false);
      return;
    }
    await Promise.all([loadModules(), loadDetail(moduleId)]);
    setActionLoading(false);
  };

  const startAssigned = async (moduleId: string) => {
    setActionLoading(true);
    setError(null);
    const result = await apiClient.enrollStudentAssignedLearningModule(moduleId);
    if (result.error) setError(result.error);
    else await Promise.all([loadModules(), loadDetail(moduleId)]);
    setActionLoading(false);
  };

  const completeLesson = async (lessonId: string) => {
    if (!selectedId) return;
    setActionLoading(true);
    setError(null);
    const result = await apiClient.completeStudentLearningLesson(selectedId, lessonId);
    if (result.error) {
      setError(result.error);
    } else {
      await Promise.all([loadDetail(selectedId), loadModules()]);
    }
    setActionLoading(false);
  };

  const progress = detail?.progress;
  const percent = Number(progress?.progressPercentage || 0);

  return (
    <div className="p-5 md:p-6 max-w-7xl w-full mx-auto space-y-6">
      <header className="pb-4 border-b border-outline-variant">
        <h1 className="text-2xl font-bold text-on-surface tracking-tight">Learning Modules</h1>
        <p className="text-sm text-on-surface-variant mt-1">Explore your curriculum, continue lessons, and track your learning progress.</p>
      </header>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-center justify-between gap-3"><span>{error}</span><Button size="sm" variant="outline" onClick={() => selectedId ? void loadDetail(selectedId) : void loadModules()}>Retry</Button></div>}

      {selectedId && (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => { setSelectedId(null); setDetail(null); }}>← All modules</Button>
          {detailLoading ? <Card><p className="text-sm text-on-surface-variant">Loading module…</p></Card> : detail && (
            <>
              <Card className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                  <div>
                    <div className="flex gap-2 items-center flex-wrap"><span className="font-mono text-xs text-primary">{detail.module.code} · v{detail.module.version}</span><Badge>{detail.module.level}</Badge></div>
                    <h2 className="text-xl font-bold mt-1">{detail.module.title}</h2>
                    <p className="text-sm text-on-surface-variant mt-1">{detail.module.description || 'No description provided.'}</p>
                  </div>
                  {!detail.enrollment && detail.canAssignedEnroll && <Button isLoading={actionLoading} onClick={() => void startAssigned(detail.module.id)}>Start assigned module</Button>}
                  {!detail.enrollment && detail.canEnroll && <Button isLoading={actionLoading} onClick={() => void enroll(detail.module.id)}>Enroll in institutional module</Button>}
                  {detail.enrollment && <Badge variant={detail.enrollment.status === 'completed' ? 'success' : 'primary'}>{detail.enrollment.status === 'completed' ? 'Completed' : 'In progress'}</Badge>}
                </div>
                {detail.module.assignment?.status === 'assigned' && <p className="text-xs text-primary">Assigned specifically to you{detail.module.assignment.due_date ? ` · Due ${detail.module.assignment.due_date}` : ''}</p>}
                {!detail.module.assignment && detail.module.is_institutional && <p className="text-xs text-on-surface-variant">Institutionally available curriculum</p>}
                {detail.enrollment && <div>
                  <div className="flex justify-between text-xs mb-1"><span>Required lesson progress</span><span className="font-semibold">{percent}%</span></div>
                  <div className="h-2 rounded bg-slate-100 overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} /></div>
                  <p className="text-xs text-on-surface-variant mt-1">{progress?.requiredLessonsCompleted || 0} of {progress?.requiredLessonsCount || 0} required lessons complete</p>
                </div>}
              </Card>
              <section className="space-y-3">
                <h3 className="font-semibold text-lg">Lessons</h3>
                {detail.lessons.map((lesson) => (
                  <Card key={lesson.id} className="space-y-3">
                    <div className="flex justify-between gap-3 items-start">
                      <div><p className="text-xs text-on-surface-variant">Lesson {lesson.lesson_order} · {lesson.estimated_minutes} min{lesson.is_mandatory ? ' · Required' : ' · Optional'}</p><h4 className="font-semibold">{lesson.title}</h4>{lesson.summary && <p className="text-sm text-on-surface-variant mt-1">{lesson.summary}</p>}</div>
                      {lesson.isCompleted && <Badge variant="success">Complete</Badge>}
                    </div>
                    <div className="text-sm whitespace-pre-wrap leading-relaxed text-on-surface">{lesson.content_markdown}</div>
                    {lesson.code_snippet && <pre className="overflow-x-auto rounded-lg bg-slate-950 text-slate-100 p-4 text-xs"><code>{lesson.code_snippet}</code></pre>}
                    {lesson.resources?.length > 0 && <div className="border-t pt-3 space-y-2"><p className="text-xs font-semibold">Resources</p>{lesson.resources.map((resource: any) => <a key={resource.id} href={resource.url} target="_blank" rel="noreferrer" className="block text-sm text-primary underline">{resource.title}{resource.is_mandatory ? ' · Required' : ''}</a>)}</div>}
                    {detail.enrollment && !lesson.isCompleted && <Button size="sm" isLoading={actionLoading} onClick={() => void completeLesson(lesson.id)}>Mark complete</Button>}
                  </Card>
                ))}
                {detail.resources.length > 0 && <Card><h4 className="font-semibold mb-2">Module resources</h4><div className="space-y-2">{detail.resources.map((resource) => <a key={resource.id} href={resource.url} target="_blank" rel="noreferrer" className="block text-sm text-primary underline">{resource.title}{resource.is_mandatory ? ' · Required' : ''}</a>)}</div></Card>}
              </section>
            </>
          )}
        </div>
      )}

      {!selectedId && <>
        {loading ? <Card><p className="text-sm text-on-surface-variant">Loading learning modules…</p></Card> : modules.length === 0 ? <Card className="text-center py-10"><span className="material-symbols-outlined text-4xl text-slate-400">menu_book</span><h2 className="font-semibold mt-2">No learning modules available</h2><p className="text-sm text-on-surface-variant mt-1">Modules assigned to you or available for your current curriculum will appear here.</p></Card> :
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{modules.map((module) => {
            const enrollment = module.enrollment;
            const done = enrollment?.status === 'completed';
            const assigned = module.assignment?.status === 'assigned';
            const percent = Number(module.progress?.progressPercentage || 0);
            return <Card key={module.id} hoverEffect className="flex flex-col gap-4">
              <div className="flex justify-between gap-3"><div><span className="font-mono text-xs text-primary">{module.code} · v{module.version}</span><h2 className="font-bold mt-1">{module.title}</h2><p className="text-xs text-on-surface-variant mt-1">{module.learning_categories?.name} · Semester {module.semester} · {module.level} · {module.estimated_hours} hrs</p></div><Badge variant={done ? 'success' : enrollment ? 'primary' : assigned ? 'warning' : 'neutral'}>{done ? 'Completed' : enrollment ? 'Enrolled' : assigned ? 'Assigned to you' : 'Institutionally available'}</Badge></div>
              <p className="text-sm text-on-surface-variant line-clamp-2">{module.description || 'No description provided.'}</p>
              <p className="text-xs text-on-surface-variant">{module.lessonCount} lessons{module.week_number ? ` · Week ${module.week_number}` : ''}</p>
              {enrollment && <div><div className="flex justify-between text-xs mb-1"><span>Progress</span><span>{percent}%</span></div><div className="h-2 rounded bg-slate-100 overflow-hidden"><div className="h-full bg-primary" style={{ width: `${percent}%` }} /></div></div>}
              {module.skills?.length > 0 && <div className="flex flex-wrap gap-1">{module.skills.map((skill) => <span key={skill} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">{skill}</span>)}</div>}
              {assigned && <p className="text-xs text-primary">Assigned specifically to you{module.assignment?.due_date ? ` · Due ${module.assignment.due_date}` : ''}</p>}
              {!assigned && module.is_institutional && <p className="text-xs text-on-surface-variant">Institutionally available</p>}
              <div className="flex justify-end border-t border-slate-100 pt-3">{enrollment ? <Button size="sm" onClick={() => void loadDetail(module.id)}>{done ? 'Review module' : 'Resume learning'}</Button> : assigned ? <Button size="sm" onClick={() => void startAssigned(module.id)}>Start assigned module</Button> : <Button size="sm" variant="outline" onClick={() => void loadDetail(module.id)}>View module</Button>}</div>
            </Card>;
          })}</div>}
      </>}
    </div>
  );
};

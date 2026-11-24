import React, { useCallback, useEffect, useState } from 'react';
import {
  apiClient,
  LearningLessonType,
  LearningResourceType,
  MentorLearningLesson,
  MentorLearningModule,
  MentorLearningResource,
} from '../../services/apiClient';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { publishModuleAndRefresh } from './learningWorkflow';

const LESSON_TYPES: LearningLessonType[] = ['theory', 'code_lab', 'case_study', 'milestone_prep'];
const RESOURCE_TYPES: LearningResourceType[] = ['pdf', 'article_url', 'github_repo', 'doc', 'book_reference'];

interface ModuleEditorProps {
  module: MentorLearningModule;
  onBack: () => void;
  onPublished: (module: MentorLearningModule) => Promise<void>;
}

const initialLessonForm = () => ({
  title: '',
  summary: '',
  content_markdown: '',
  lesson_type: 'theory' as LearningLessonType,
  estimated_minutes: '30',
  is_mandatory: true,
  code_snippet: '',
  code_language: 'cpp',
});

const initialResourceForm = () => ({
  title: '',
  resource_type: 'article_url' as LearningResourceType,
  url: '',
  description: '',
  is_mandatory: false,
  lesson_id: '',
});

export const ModuleEditor: React.FC<ModuleEditorProps> = ({ module, onBack, onPublished }) => {
  const [lessons, setLessons] = useState<MentorLearningLesson[]>([]);
  const [resources, setResources] = useState<MentorLearningResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [eligibleStudents, setEligibleStudents] = useState<Array<{ id: string; name: string; email: string; student_details: { roll_number: string; semester: number; cohort_id: string | null } }>>([]);
  const [assignments, setAssignments] = useState<Array<Record<string, any>>>([]);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [assignmentSuccess, setAssignmentSuccess] = useState<string | null>(null);
  const [lessonFormOpen, setLessonFormOpen] = useState(false);
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [lessonForm, setLessonForm] = useState(initialLessonForm);
  const [lessonFormError, setLessonFormError] = useState<string | null>(null);
  const [resourceFormOpen, setResourceFormOpen] = useState(false);
  const [editingResourceId, setEditingResourceId] = useState<string | null>(null);
  const [resourceForm, setResourceForm] = useState(initialResourceForm);
  const [resourceFormError, setResourceFormError] = useState<string | null>(null);
  const isDraft = module.status === 'draft';
  const assignableStudents = eligibleStudents.filter((student) => !assignments.some((assignment) => assignment.student_id === student.id));

  const publishModule = async () => {
    if (!isDraft || saving) return;
    if (lessons.length === 0) {
      setPublishError('Add at least one lesson before publishing this module.');
      return;
    }
    if (!window.confirm('Publish this module? Publication freezes the module and its lessons and resources from further curriculum editing.')) return;
    setSaving(true);
    setPublishError(null);
    const result = await publishModuleAndRefresh(
      () => apiClient.publishMentorLearningModule(module.id),
      async (updated) => {
        await onPublished(updated);
        await loadContent();
      },
    );
    if (result.error) setPublishError(result.error);
    else setSuccess('Module published. Its curriculum is now read-only.');
    setSaving(false);
  };

  const loadLessons = useCallback(async () => {
    const result = await apiClient.getMentorModuleLessons(module.id);
    if (result.error || !result.data) {
      setLessons([]);
      setError(result.error || 'Lessons could not be loaded.');
      return false;
    }
    setLessons(result.data.lessons || []);
    return true;
  }, [module.id]);

  const loadResources = useCallback(async () => {
    const result = await apiClient.getMentorModuleResources(module.id);
    if (result.error || !result.data) {
      setResources([]);
      setError(result.error || 'Resources could not be loaded.');
      return false;
    }
    setResources(result.data.resources || []);
    return true;
  }, [module.id]);

  const loadContent = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([loadLessons(), loadResources()]);
    setLoading(false);
  }, [loadLessons, loadResources]);

  const loadAssignmentData = useCallback(async () => {
    if (module.status !== 'published') return;
    setAssignmentLoading(true);
    setAssignmentError(null);
    const [studentsResult, assignmentsResult] = await Promise.all([
      apiClient.getEligibleLearningMentees(module.id),
      apiClient.getMentorModuleAssignments(module.id),
    ]);
    if (studentsResult.error || !studentsResult.data) setAssignmentError(studentsResult.error || 'Eligible students could not be loaded.');
    else setEligibleStudents(studentsResult.data.students || []);
    if (assignmentsResult.error || !assignmentsResult.data) setAssignmentError(assignmentsResult.error || 'Module assignments could not be loaded.');
    else setAssignments(assignmentsResult.data.assignments || []);
    setAssignmentLoading(false);
  }, [module.id, module.status]);

  useEffect(() => { void loadContent(); void loadAssignmentData(); }, [loadContent, loadAssignmentData]);

  const assignStudent = async () => {
    if (!selectedStudentId || saving) return;
    setSaving(true);
    setAssignmentError(null);
    setAssignmentSuccess(null);
    const result = await apiClient.createMentorModuleAssignment(module.id, selectedStudentId);
    if (result.error || !result.data) setAssignmentError(result.error || 'Module assignment could not be created.');
    else {
      setAssignmentSuccess('Module assigned successfully.');
      setSelectedStudentId('');
      await loadAssignmentData();
    }
    setSaving(false);
  };

  const openNewLesson = () => {
    setEditingLessonId(null);
    setLessonForm(initialLessonForm());
    setLessonFormError(null);
    setLessonFormOpen(true);
  };

  const editLesson = (lesson: MentorLearningLesson) => {
    setEditingLessonId(lesson.id);
    setLessonForm({
      title: lesson.title,
      summary: lesson.summary || '',
      content_markdown: lesson.content_markdown,
      lesson_type: lesson.lesson_type,
      estimated_minutes: String(lesson.estimated_minutes),
      is_mandatory: lesson.is_mandatory,
      code_snippet: lesson.code_snippet || '',
      code_language: lesson.code_language || '',
    });
    setLessonFormError(null);
    setLessonFormOpen(true);
  };

  const saveLesson = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLessonFormError(null);
    const minutes = Number(lessonForm.estimated_minutes);
    if (lessonForm.title.trim().length < 3 || !lessonForm.content_markdown.trim() || !Number.isInteger(minutes) || minutes <= 0) {
      setLessonFormError('Enter a title of at least 3 characters, non-empty Markdown content, and a positive whole number of minutes.');
      return;
    }
    setSaving(true);
    const payload = {
      title: lessonForm.title.trim(),
      summary: lessonForm.summary.trim() || null,
      content_markdown: lessonForm.content_markdown.trim(),
      lesson_type: lessonForm.lesson_type,
      estimated_minutes: minutes,
      is_mandatory: lessonForm.is_mandatory,
      code_snippet: lessonForm.code_snippet.trim() || null,
      code_language: lessonForm.code_language.trim() || null,
    };
    const result = editingLessonId
      ? await apiClient.updateMentorModuleLesson(module.id, editingLessonId, payload)
      : await apiClient.createMentorModuleLesson(module.id, payload);
    if (result.error || !result.data) {
      setLessonFormError(result.error || 'Lesson could not be saved.');
      setSaving(false);
      return;
    }
    const wasEditing = Boolean(editingLessonId);
    setLessonFormOpen(false);
    setSuccess(wasEditing ? 'Lesson updated.' : 'Lesson added.');
    await Promise.all([loadLessons(), loadResources()]);
    setSaving(false);
  };

  const deleteLesson = async (lesson: MentorLearningLesson) => {
    if (!window.confirm(`Delete “${lesson.title}”? Resources attached to this lesson will also be removed.`)) return;
    setSaving(true);
    setError(null);
    const result = await apiClient.deleteMentorModuleLesson(module.id, lesson.id);
    if (result.error) setError(result.error);
    else {
      setSuccess('Lesson deleted. Attached lesson resources were removed by the database relationship.');
      await Promise.all([loadLessons(), loadResources()]);
    }
    setSaving(false);
  };

  const moveLesson = async (lessonIndex: number, direction: -1 | 1) => {
    const targetIndex = lessonIndex + direction;
    if (targetIndex < 0 || targetIndex >= lessons.length) return;
    const ordered = [...lessons];
    [ordered[lessonIndex], ordered[targetIndex]] = [ordered[targetIndex], ordered[lessonIndex]];
    setSaving(true);
    setError(null);
    const result = await apiClient.reorderMentorModuleLessons(module.id, ordered.map((lesson) => lesson.id));
    if (result.error || !result.data) setError(result.error || 'Lesson order could not be saved.');
    else {
      setLessons(result.data.lessons);
      setSuccess('Lesson order updated.');
    }
    setSaving(false);
  };

  const openNewResource = () => {
    setEditingResourceId(null);
    setResourceForm(initialResourceForm());
    setResourceFormError(null);
    setResourceFormOpen(true);
  };

  const editResource = (resource: MentorLearningResource) => {
    setEditingResourceId(resource.id);
    setResourceForm({
      title: resource.title,
      resource_type: resource.resource_type,
      url: resource.url,
      description: resource.description || '',
      is_mandatory: resource.is_mandatory,
      lesson_id: resource.lesson_id || '',
    });
    setResourceFormError(null);
    setResourceFormOpen(true);
  };

  const saveResource = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setResourceFormError(null);
    if (resourceForm.title.trim().length < 3 || resourceForm.url.trim().length < 5) {
      setResourceFormError('Enter a resource title of at least 3 characters and a URL of at least 5 characters.');
      return;
    }
    setSaving(true);
    const payload = {
      title: resourceForm.title.trim(),
      resource_type: resourceForm.resource_type,
      url: resourceForm.url.trim(),
      description: resourceForm.description.trim() || null,
      is_mandatory: resourceForm.is_mandatory,
      lesson_id: resourceForm.lesson_id || null,
    };
    const result = editingResourceId
      ? await apiClient.updateMentorModuleResource(module.id, editingResourceId, payload)
      : await apiClient.createMentorModuleResource(module.id, payload);
    if (result.error || !result.data) {
      setResourceFormError(result.error || 'Resource could not be saved.');
      setSaving(false);
      return;
    }
    setResourceFormOpen(false);
    setSuccess(editingResourceId ? 'Resource updated.' : 'Resource added.');
    await loadResources();
    setSaving(false);
  };

  const deleteResource = async (resource: MentorLearningResource) => {
    if (!window.confirm(`Remove “${resource.title}”?`)) return;
    setSaving(true);
    setError(null);
    const result = await apiClient.deleteMentorModuleResource(module.id, resource.id);
    if (result.error) setError(result.error);
    else {
      setSuccess('Resource removed.');
      await loadResources();
    }
    setSaving(false);
  };

  const setLessonField = (field: keyof typeof lessonForm, value: string | boolean) => {
    setLessonForm((current) => ({ ...current, [field]: value }));
    setLessonFormError(null);
  };
  const setResourceField = (field: keyof typeof resourceForm, value: string | boolean) => {
    setResourceForm((current) => ({ ...current, [field]: value }));
    setResourceFormError(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack}>← All modules</Button>
          <h2 className="text-xl font-bold mt-2">{module.title}</h2>
          <div className="flex items-center gap-2 mt-1"><span className="font-mono text-xs text-primary">{module.code} · v{module.version}</span><Badge variant={isDraft ? 'warning' : module.status === 'published' ? 'success' : 'neutral'}>{module.status}</Badge></div>
        </div>
        {!isDraft && <p className="text-sm text-on-surface-variant">This module is read-only because it is {module.status}.</p>}
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-center justify-between gap-3"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void loadContent()}>Retry</Button></div>}
      {success && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div>}
      {publishError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{publishError}</div>}
      {isDraft && <Card className="space-y-3"><h3 className="font-semibold">Publish module</h3><p className="text-sm text-on-surface-variant">Before publishing, add at least one lesson. Publishing permanently freezes this curriculum; make future changes in a new version.</p><ul className="list-disc pl-5 text-sm"><li className={lessons.length > 0 ? 'text-emerald-700' : 'text-on-surface-variant'}>{lessons.length > 0 ? 'At least one lesson added' : 'Add at least one lesson'}</li></ul><Button disabled={saving || lessons.length === 0 || loading} isLoading={saving} onClick={() => void publishModule()}>Publish module</Button></Card>}
      {module.status === 'published' && <Card className="space-y-4"><div><h3 className="font-semibold">Assign to mentees</h3><p className="text-sm text-on-surface-variant mt-1">These assignments are individual and use active mentee allocations in the module’s academic term. Institutional availability is handled separately.</p></div>
        {assignmentError && <div role="alert" className="flex items-center justify-between gap-3 text-sm text-red-800"><span>{assignmentError}</span><Button size="sm" variant="outline" onClick={() => void loadAssignmentData()}>Retry</Button></div>}{assignmentSuccess && <p role="status" className="text-sm text-emerald-800">{assignmentSuccess}</p>}
        {assignmentLoading ? <p className="text-sm text-on-surface-variant">Loading eligible mentees and assignments…</p> : <>
          <div className="flex flex-col sm:flex-row gap-2"><select aria-label="Eligible mentee" value={selectedStudentId} onChange={(event) => setSelectedStudentId(event.target.value)} className="flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2 text-sm"><option value="">Select an eligible mentee</option>{assignableStudents.map((student) => <option key={student.id} value={student.id}>{student.name} · {student.student_details.roll_number}</option>)}</select><Button disabled={!selectedStudentId || saving} isLoading={saving} onClick={() => void assignStudent()}>Assign module</Button></div>
          {eligibleStudents.length === 0 && <p className="text-sm text-on-surface-variant">No eligible active mentees are available for this module and academic term.</p>}
          {eligibleStudents.length > 0 && assignableStudents.length === 0 && <p className="text-sm text-on-surface-variant">Every eligible mentee already has an assignment record for this module.</p>}
          <div className="space-y-2"><h4 className="text-sm font-semibold">Existing assignments</h4>{assignments.length === 0 ? <p className="text-sm text-on-surface-variant">No students have been assigned this module.</p> : assignments.map((assignment) => <div key={assignment.id} className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant p-3"><div><p className="text-sm font-medium">{assignment.student?.name || assignment.student_id}</p><p className="text-xs text-on-surface-variant">{assignment.student_details?.roll_number || assignment.student?.email || ''}{assignment.due_date ? ` · Due ${assignment.due_date}` : ''}</p></div><Badge variant={assignment.status === 'assigned' ? 'primary' : assignment.status === 'completed' ? 'success' : 'neutral'}>{assignment.status}</Badge></div>)}</div>
        </>}</Card>}
      {loading ? <Card><p className="text-sm text-on-surface-variant">Loading lessons and resources…</p></Card> : (
        <>
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-semibold">Lessons</h3>{isDraft && <Button size="sm" onClick={openNewLesson}>Add lesson</Button>}</div>
            {lessons.length === 0 ? <Card><p className="text-sm text-on-surface-variant">No lessons have been added to this module.</p></Card> : lessons.map((lesson, index) => (
              <Card key={lesson.id} className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div><p className="text-xs text-on-surface-variant">Lesson {lesson.lesson_order} · {lesson.estimated_minutes} min · {lesson.is_mandatory ? 'Required' : 'Optional'} · {lesson.lesson_type}</p><h4 className="font-semibold mt-1">{lesson.title}</h4>{lesson.summary && <p className="text-sm text-on-surface-variant mt-1">{lesson.summary}</p>}</div>
                  {isDraft && <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" disabled={saving || index === 0} onClick={() => void moveLesson(index, -1)}>Move up</Button>
                    <Button size="sm" variant="outline" disabled={saving || index === lessons.length - 1} onClick={() => void moveLesson(index, 1)}>Move down</Button>
                    <Button size="sm" variant="outline" disabled={saving} onClick={() => editLesson(lesson)}>Edit</Button>
                    <Button size="sm" variant="danger" disabled={saving} onClick={() => void deleteLesson(lesson)}>Delete</Button>
                  </div>}
                </div>
                <div className="rounded-lg bg-surface-container-low p-3 text-sm whitespace-pre-wrap leading-relaxed">{lesson.content_markdown}</div>
                {lesson.code_snippet && <pre className="overflow-x-auto rounded-lg bg-slate-950 text-slate-100 p-4 text-xs"><code>{lesson.code_snippet}</code></pre>}
              </Card>
            ))}
          </section>

          {lessonFormOpen && isDraft && <Card className="space-y-4">
            <h3 className="font-semibold">{editingLessonId ? 'Edit lesson' : 'Add lesson'}</h3>
            <form className="space-y-4" onSubmit={(event) => void saveLesson(event)}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Lesson title" required minLength={3} value={lessonForm.title} onChange={(event) => setLessonField('title', event.target.value)} />
                <Input label="Summary" value={lessonForm.summary} onChange={(event) => setLessonField('summary', event.target.value)} />
                <label className="block space-y-1.5 text-xs font-semibold">Lesson type
                  <select value={lessonForm.lesson_type} onChange={(event) => setLessonField('lesson_type', event.target.value)} className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2 text-sm font-normal">{LESSON_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select>
                </label>
                <Input label="Estimated minutes" type="number" min={1} step={1} required value={lessonForm.estimated_minutes} onChange={(event) => setLessonField('estimated_minutes', event.target.value)} />
                <Input label="Code language" value={lessonForm.code_language} onChange={(event) => setLessonField('code_language', event.target.value)} />
              </div>
              <label className="block space-y-1.5 text-xs font-semibold">Markdown content
                <textarea required value={lessonForm.content_markdown} onChange={(event) => setLessonField('content_markdown', event.target.value)} rows={8} className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </label>
              <label className="block space-y-1.5 text-xs font-semibold">Code snippet <span className="font-normal text-on-surface-variant">(optional)</span>
                <textarea value={lessonForm.code_snippet} onChange={(event) => setLessonField('code_snippet', event.target.value)} rows={4} className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={lessonForm.is_mandatory} onChange={(event) => setLessonField('is_mandatory', event.target.checked)} /> Required lesson</label>
              {lessonFormError && <p role="alert" className="text-sm text-error">{lessonFormError}</p>}
              <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={saving} onClick={() => setLessonFormOpen(false)}>Cancel</Button><Button type="submit" isLoading={saving}>{editingLessonId ? 'Save lesson' : 'Add lesson'}</Button></div>
            </form>
          </Card>}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-semibold">Resources</h3>{isDraft && <Button size="sm" onClick={openNewResource}>Add resource</Button>}</div>
            {resources.length === 0 ? <Card><p className="text-sm text-on-surface-variant">No resources have been added to this module.</p></Card> : resources.map((resource) => (
              <Card key={resource.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div><div className="flex items-center gap-2 flex-wrap"><h4 className="font-semibold">{resource.title}</h4><Badge>{resource.resource_type}</Badge>{resource.is_mandatory && <Badge variant="warning">Required</Badge>}</div><a href={resource.url} target="_blank" rel="noreferrer" className="text-sm text-primary underline break-all">{resource.url}</a><p className="text-xs text-on-surface-variant mt-1">{resource.lesson_id ? `Attached to ${lessons.find((lesson) => lesson.id === resource.lesson_id)?.title || 'lesson'}` : 'Module resource'}{resource.description ? ` · ${resource.description}` : ''}</p></div>
                {isDraft && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={saving} onClick={() => editResource(resource)}>Edit</Button><Button size="sm" variant="danger" disabled={saving} onClick={() => void deleteResource(resource)}>Remove</Button></div>}
              </Card>
            ))}
          </section>

          {resourceFormOpen && isDraft && <Card className="space-y-4">
            <h3 className="font-semibold">{editingResourceId ? 'Edit resource' : 'Add resource'}</h3>
            <form className="space-y-4" onSubmit={(event) => void saveResource(event)}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Resource title" required minLength={3} value={resourceForm.title} onChange={(event) => setResourceField('title', event.target.value)} />
                <label className="block space-y-1.5 text-xs font-semibold">Resource type
                  <select value={resourceForm.resource_type} onChange={(event) => setResourceField('resource_type', event.target.value)} className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2 text-sm font-normal">{RESOURCE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select>
                </label>
                <Input label="Resource URL" required minLength={5} value={resourceForm.url} onChange={(event) => setResourceField('url', event.target.value)} />
                <label className="block space-y-1.5 text-xs font-semibold">Attach to lesson <span className="font-normal text-on-surface-variant">(optional)</span>
                  <select value={resourceForm.lesson_id} onChange={(event) => setResourceField('lesson_id', event.target.value)} className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2 text-sm font-normal"><option value="">Module-level resource</option>{lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.lesson_order}. {lesson.title}</option>)}</select>
                </label>
              </div>
              <Input label="Description" value={resourceForm.description} onChange={(event) => setResourceField('description', event.target.value)} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={resourceForm.is_mandatory} onChange={(event) => setResourceField('is_mandatory', event.target.checked)} /> Required resource</label>
              {resourceFormError && <p role="alert" className="text-sm text-error">{resourceFormError}</p>}
              <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={saving} onClick={() => setResourceFormOpen(false)}>Cancel</Button><Button type="submit" isLoading={saving}>{editingResourceId ? 'Save resource' : 'Add resource'}</Button></div>
            </form>
          </Card>}
        </>
      )}
    </div>
  );
};

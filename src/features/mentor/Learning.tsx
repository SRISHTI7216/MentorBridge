import React, { useCallback, useEffect, useState } from 'react';
import {
  apiClient,
  CreateDraftLearningModuleInput,
  MentorLearningModule,
  MentorModuleOptions,
} from '../../services/apiClient';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { createDraftAndRefresh } from './learningWorkflow';
import { ModuleEditor } from './ModuleEditor';

const LEVELS: CreateDraftLearningModuleInput['level'][] = ['Fundamental', 'Intermediate', 'Advanced'];

export const MentorLearning: React.FC = () => {
  const [modules, setModules] = useState<MentorLearningModule[]>([]);
  const [selectedModule, setSelectedModule] = useState<MentorLearningModule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [options, setOptions] = useState<MentorModuleOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    category_id: '',
    academic_term_id: '',
    code: '',
    title: '',
    semester: '',
    level: '' as '' | CreateDraftLearningModuleInput['level'],
    description: '',
  });

  const loadModules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.getMentorLearningModules();
      if (result.error || !result.data) {
        setModules([]);
        setError(result.error || 'Learning modules could not be loaded.');
        return [] as MentorLearningModule[];
      }
      setModules(result.data.modules || []);
      return result.data.modules || [];
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    setOptionsError(null);
    const result = await apiClient.getMentorModuleOptions();
    if (result.error || !result.data) {
      setOptionsError(result.error || 'Module categories and academic terms could not be loaded.');
    } else {
      setOptions(result.data);
      setForm((current) => ({
        ...current,
        category_id: current.category_id || result.data!.categories[0]?.id || '',
        academic_term_id: current.academic_term_id || result.data!.academicTerms.find((term) => term.is_current)?.id || result.data!.academicTerms[0]?.id || '',
      }));
    }
    setOptionsLoading(false);
  }, []);

  useEffect(() => { void loadModules(); }, [loadModules]);

  const openCreateForm = () => {
    setSuccess(null);
    setFormError(null);
    setOptions(null);
    setForm({ category_id: '', academic_term_id: '', code: '', title: '', semester: '', level: '', description: '' });
    setFormOpen(true);
    void loadOptions();
  };

  const updateForm = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFormError(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const semester = Number(form.semester);
    if (!form.category_id || !form.academic_term_id || !form.code.trim() || form.title.trim().length < 3 ||
      !Number.isInteger(semester) || semester < 1 || semester > 8 || !LEVELS.includes(form.level as CreateDraftLearningModuleInput['level'])) {
      setFormError('Complete all required fields. Semester must be from 1 to 8, and the title must contain at least 3 characters.');
      return;
    }

    setSubmitting(true);
    const payload: CreateDraftLearningModuleInput = {
      category_id: form.category_id,
      academic_term_id: form.academic_term_id,
      code: form.code.trim(),
      title: form.title.trim(),
      semester,
      level: form.level as CreateDraftLearningModuleInput['level'],
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
    };
    const result = await createDraftAndRefresh(
      () => apiClient.createMentorLearningModule(payload),
      async () => { await loadModules(); }
    );
    if (result.error || !result.module) {
      setFormError(result.error || 'Module could not be created.');
      setSubmitting(false);
      return;
    }

    setFormOpen(false);
    setSuccess(`Draft module “${result.module.title}” created.`);
    setSubmitting(false);
  };

  const statusVariant = (status: MentorLearningModule['status']) => {
    if (status === 'published') return 'success';
    if (status === 'archived') return 'neutral';
    return 'warning';
  };

  return (
    <div className="p-5 md:p-6 max-w-7xl w-full mx-auto space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-outline-variant">
        <div>
          <h1 className="text-2xl font-bold text-on-surface tracking-tight">Curricular Learning Modules</h1>
          <p className="text-sm text-on-surface-variant mt-1">Create and review your learning module drafts.</p>
        </div>
        {!selectedModule && <Button size="sm" onClick={openCreateForm}>Add Module</Button>}
      </header>

      {success && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div>}
      {!selectedModule && error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void loadModules()}>Retry</Button></div>}

      {selectedModule ? <ModuleEditor module={selectedModule} onBack={() => setSelectedModule(null)} onPublished={async (published) => {
        const refreshed = await loadModules();
        setSelectedModule(refreshed.find((item) => item.id === published.id) || published);
      }} /> : loading ? <Card><p className="text-sm text-on-surface-variant">Loading learning modules…</p></Card> : error ? null : modules.length === 0 ? (
        <Card className="text-center py-10">
          <h2 className="font-semibold">No learning modules yet</h2>
          <p className="text-sm text-on-surface-variant mt-1">Create a draft module to begin building your curriculum.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {modules.map((module) => (
            <Card key={module.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="font-mono text-xs text-primary">{module.code} · v{module.version}</span>
                  <h2 className="font-bold mt-1 text-on-surface">{module.title}</h2>
                </div>
                <Badge variant={statusVariant(module.status)}>{module.status}</Badge>
              </div>
              <p className="text-sm text-on-surface-variant">{module.description || 'No description provided.'}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-on-surface-variant">
                <div><dt className="font-semibold">Category</dt><dd>{module.learning_categories?.name || 'Unknown category'}</dd></div>
                <div><dt className="font-semibold">Academic term</dt><dd>{module.academic_terms?.name || module.academic_term_id}</dd></div>
                <div><dt className="font-semibold">Semester</dt><dd>{module.semester}</dd></div>
                <div><dt className="font-semibold">Level</dt><dd>{module.level}</dd></div>
                <div><dt className="font-semibold">Created</dt><dd>{new Date(module.created_at).toLocaleDateString()}</dd></div>
                <div><dt className="font-semibold">Updated</dt><dd>{new Date(module.updated_at).toLocaleDateString()}</dd></div>
              </dl>
              <div className="flex justify-end border-t border-outline-variant pt-3">
                <Button size="sm" variant="outline" onClick={() => setSelectedModule(module)}>Manage lessons & resources</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <Card role="dialog" aria-modal="true" aria-labelledby="create-module-title" className="w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="create-module-title" className="text-xl font-bold">Add learning module</h2>
                <p className="text-sm text-on-surface-variant mt-1">New modules are saved as drafts.</p>
              </div>
              <Button type="button" size="sm" variant="ghost" disabled={submitting} onClick={() => setFormOpen(false)}>Close</Button>
            </div>

            {optionsError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-center justify-between gap-3"><span>{optionsError}</span><Button type="button" size="sm" variant="outline" onClick={() => void loadOptions()}>Retry options</Button></div>}
            {optionsLoading ? <p className="text-sm text-on-surface-variant">Loading categories and academic terms…</p> : options && (
              <form className="space-y-4" onSubmit={(event) => void submit(event)}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block space-y-1.5 text-xs font-semibold">Category
                    <select required value={form.category_id} onChange={(event) => updateForm('category_id', event.target.value)} className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2 text-sm font-normal">
                      <option value="">Select category</option>
                      {options.categories.map((category) => <option key={category.id} value={category.id}>{category.name} ({category.code})</option>)}
                    </select>
                  </label>
                  <label className="block space-y-1.5 text-xs font-semibold">Academic term
                    <select required value={form.academic_term_id} onChange={(event) => updateForm('academic_term_id', event.target.value)} className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2 text-sm font-normal">
                      <option value="">Select academic term</option>
                      {options.academicTerms.map((term) => <option key={term.id} value={term.id}>{term.name} ({term.code}){term.is_current ? ' · Current' : ''}</option>)}
                    </select>
                  </label>
                  <Input label="Module code" required value={form.code} onChange={(event) => updateForm('code', event.target.value)} />
                  <Input label="Module title" required value={form.title} onChange={(event) => updateForm('title', event.target.value)} minLength={3} />
                  <label className="block space-y-1.5 text-xs font-semibold">Semester
                    <select required value={form.semester} onChange={(event) => updateForm('semester', event.target.value)} className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2 text-sm font-normal">
                      <option value="">Select semester</option>
                      {Array.from({ length: 8 }, (_, index) => index + 1).map((semester) => <option key={semester} value={semester}>{semester}</option>)}
                    </select>
                  </label>
                  <label className="block space-y-1.5 text-xs font-semibold">Level
                    <select required value={form.level} onChange={(event) => updateForm('level', event.target.value)} className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2 text-sm font-normal">
                      <option value="">Select level</option>
                      {LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block space-y-1.5 text-xs font-semibold">Description <span className="font-normal text-on-surface-variant">(optional)</span>
                  <textarea value={form.description} onChange={(event) => updateForm('description', event.target.value)} rows={3} className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </label>
                {options.categories.length === 0 && <p className="text-sm text-error">No categories are available. Contact an administrator.</p>}
                {options.academicTerms.length === 0 && <p className="text-sm text-error">No academic terms are available. Contact an administrator.</p>}
                {formError && <p role="alert" className="text-sm text-error">{formError}</p>}
                <div className="flex justify-end gap-2 border-t border-outline-variant pt-4">
                  <Button type="button" variant="ghost" disabled={submitting} onClick={() => setFormOpen(false)}>Cancel</Button>
                  <Button type="submit" isLoading={submitting} disabled={options.categories.length === 0 || options.academicTerms.length === 0}>Create draft</Button>
                </div>
              </form>
            )}
            {!optionsLoading && !options && !optionsError && <p className="text-sm text-on-surface-variant">Module options are unavailable.</p>}
          </Card>
        </div>
      )}
    </div>
  );
};

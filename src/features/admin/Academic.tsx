import React, { useEffect, useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { apiClient } from '../../services/apiClient';

interface AcademicTerm {
  id: string;
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  activeAssignmentsCount?: number;
}

interface Cohort {
  id: string;
  code: string;
  name: string;
  department: string;
  admission_year: number;
  graduation_year: number;
  studentCount?: number;
}

export const AdminAcademic: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'terms' | 'cohorts'>('terms');
  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Term Creation Modal
  const [isTermModalOpen, setIsTermModalOpen] = useState<boolean>(false);
  const [termForm, setTermForm] = useState({
    code: '',
    name: '',
    startDate: '',
    endDate: '',
    isCurrent: false,
  });

  // Cohort Creation Modal
  const [isCohortModalOpen, setIsCohortModalOpen] = useState<boolean>(false);
  const [cohortForm, setCohortForm] = useState({
    code: '',
    name: '',
    department: 'Department of Computer Science & Engineering',
    admissionYear: 2023,
    graduationYear: 2027,
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [termsRes, cohortsRes] = await Promise.all([
        apiClient.getAcademicTerms(),
        apiClient.getCohorts(),
      ]);

      if (termsRes.error) {
        setError(termsRes.error);
      } else {
        setTerms(termsRes.data?.terms || []);
      }

      if (cohortsRes.data?.cohorts) {
        setCohorts(cohortsRes.data.cohorts);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch academic records.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Set Current Term
  const handleSetCurrentTerm = async (termId: string, termName: string) => {
    setIsSubmitting(true);
    try {
      const res = await apiClient.setCurrentAcademicTerm(termId);
      if (res.error) {
        alert(res.error);
      } else {
        setSuccessMessage(`'${termName}' is now set as the active academic term.`);
        await loadData();
        setTimeout(() => setSuccessMessage(null), 3500);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update current term.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit New Term
  const handleTermSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      const res = await apiClient.createAcademicTerm({
        code: termForm.code,
        name: termForm.name,
        startDate: termForm.startDate,
        endDate: termForm.endDate,
        isCurrent: termForm.isCurrent,
      });

      if (res.error) {
        setFormError(res.error);
      } else {
        setIsTermModalOpen(false);
        setTermForm({
          code: '',
          name: '',
          startDate: '',
          endDate: '',
          isCurrent: false,
        });
        setSuccessMessage('Academic term created successfully.');
        await loadData();
        setTimeout(() => setSuccessMessage(null), 3500);
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create term.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit New Cohort
  const handleCohortSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      const res = await apiClient.createCohort({
        code: cohortForm.code,
        name: cohortForm.name,
        department: cohortForm.department,
        admissionYear: Number(cohortForm.admissionYear),
        graduationYear: Number(cohortForm.graduationYear),
      });

      if (res.error) {
        setFormError(res.error);
      } else {
        setIsCohortModalOpen(false);
        setCohortForm({
          code: '',
          name: '',
          department: 'Department of Computer Science & Engineering',
          admissionYear: 2023,
          graduationYear: 2027,
        });
        setSuccessMessage('Cohort batch created successfully.');
        await loadData();
        setTimeout(() => setSuccessMessage(null), 3500);
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create cohort.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalCohortStudents = cohorts.reduce((acc, c) => acc + (c.studentCount || 0), 0);

  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
              Academic Management
            </h1>
            <Badge variant="primary">Institutional Structure</Badge>
          </div>
          <p className="text-xs text-on-surface-variant mt-1">
            Department of Computer Science & Engineering • Academic Terms, Cohort Batches & Curricular Cycles
          </p>
        </div>

        {/* Tab Switcher & Create Action */}
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-xl p-1 bg-slate-100 border border-slate-200 text-xs">
            <button
              onClick={() => setActiveTab('terms')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === 'terms'
                  ? 'bg-white text-primary shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Academic Terms ({terms.length})
            </button>
            <button
              onClick={() => setActiveTab('cohorts')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === 'cohorts'
                  ? 'bg-white text-primary shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Cohorts & Batches ({cohorts.length})
            </button>
          </div>

          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setFormError(null);
              if (activeTab === 'terms') {
                setIsTermModalOpen(true);
              } else {
                setIsCohortModalOpen(true);
              }
            }}
            className="flex items-center gap-1.5 text-xs shadow-sm shadow-primary/25"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            {activeTab === 'terms' ? 'New Academic Term' : 'New Cohort'}
          </Button>
        </div>
      </div>

      {/* Success Notification */}
      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-emerald-600">check_circle</span>
            <span className="font-semibold">{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-700">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-rose-600">error</span>
            <span>{error}</span>
          </div>
          <Button size="sm" variant="outline" onClick={loadData}>
            Retry
          </Button>
        </div>
      )}

      {/* TAB 1: ACADEMIC TERMS */}
      {activeTab === 'terms' && (
        <Card className="overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-xl">event_repeat</span>
              <h3 className="text-sm font-bold text-slate-900">Academic Terms Calendar</h3>
            </div>
            <span className="text-xs text-slate-500">
              Active term dictates active mentor allocations and student reporting
            </span>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading terms...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px] tracking-wider">
                    <th className="py-3 px-4">Term Code</th>
                    <th className="py-3 px-4">Academic Term Name</th>
                    <th className="py-3 px-4">Start Date</th>
                    <th className="py-3 px-4">End Date</th>
                    <th className="py-3 px-4">Active Pairings</th>
                    <th className="py-3 px-4">Current Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {terms.map((term) => (
                    <tr
                      key={term.id}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        term.is_current ? 'bg-indigo-50/30' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-mono font-bold text-slate-900">
                        {term.code}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-800">
                        {term.name}
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">
                        {term.start_date}
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">
                        {term.end_date}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-full text-xs">
                          {term.activeAssignmentsCount ?? 0}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {term.is_current ? (
                          <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full text-[11px] border border-emerald-300">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            CURRENT
                          </span>
                        ) : (
                          <span className="text-slate-400 font-medium text-[11px]">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {!term.is_current ? (
                          <button
                            onClick={() => handleSetCurrentTerm(term.id, term.name)}
                            disabled={isSubmitting}
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            Set as Current
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">Active</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* TAB 2: COHORTS & BATCHES */}
      {activeTab === 'cohorts' && (
        <div className="space-y-6">
          {/* Cohort Student Distribution Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {cohorts.map((cohort) => {
              const count = cohort.studentCount || 0;
              const pct = totalCohortStudents > 0 ? Math.round((count / totalCohortStudents) * 100) : 0;
              return (
                <Card key={cohort.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-primary">{cohort.code}</span>
                    <span className="text-xs font-semibold text-slate-500">
                      {cohort.admission_year}–{cohort.graduation_year}
                    </span>
                  </div>
                  <p className="font-bold text-slate-800 text-sm">{cohort.name}</p>
                  <div className="flex items-baseline justify-between pt-1">
                    <span className="text-2xl font-bold font-display text-slate-900">{count}</span>
                    <span className="text-xs text-slate-400">{pct}% of student body</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Cohorts Table */}
          <Card className="overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">school</span>
                <h3 className="text-sm font-bold text-slate-900">Department Cohorts & Batches</h3>
              </div>
              <span className="text-xs text-slate-500">
                Cohorts segment students into graduation classes for advising metrics
              </span>
            </div>

            {isLoading ? (
              <div className="p-8 text-center text-xs text-slate-400">Loading cohorts...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px] tracking-wider">
                      <th className="py-3 px-4">Cohort Code</th>
                      <th className="py-3 px-4">Display Name</th>
                      <th className="py-3 px-4">Department</th>
                      <th className="py-3 px-4">Admission Year</th>
                      <th className="py-3 px-4">Graduation Year</th>
                      <th className="py-3 px-4 text-right">Enrolled Students</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cohorts.map((cohort) => (
                      <tr key={cohort.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-slate-900">
                          {cohort.code}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-800">
                          {cohort.name}
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {cohort.department}
                        </td>
                        <td className="py-3 px-4 text-slate-700 font-mono">
                          {cohort.admission_year}
                        </td>
                        <td className="py-3 px-4 text-slate-700 font-mono">
                          {cohort.graduation_year}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-slate-900">
                          {cohort.studentCount || 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* CREATE ACADEMIC TERM MODAL */}
      {isTermModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <Card className="w-full max-w-md p-6 bg-white shadow-2xl rounded-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">event_available</span>
                <h3 className="text-base font-bold text-slate-900">New Academic Term</h3>
              </div>
              <button
                onClick={() => setIsTermModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={handleTermSubmit} className="space-y-4">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Term Code (Unique Identifier) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. AY25-26-S7"
                  value={termForm.code}
                  onChange={(e) => setTermForm({ ...termForm, code: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Term Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. AY 2025–26 Semester VII (Fall)"
                  value={termForm.name}
                  onChange={(e) => setTermForm({ ...termForm, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={termForm.startDate}
                    onChange={(e) => setTermForm({ ...termForm, startDate: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    End Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={termForm.endDate}
                    onChange={(e) => setTermForm({ ...termForm, endDate: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="isCurrentCheck"
                  checked={termForm.isCurrent}
                  onChange={(e) => setTermForm({ ...termForm, isCurrent: e.target.checked })}
                  className="rounded border-slate-300 text-primary focus:ring-primary/20"
                />
                <label htmlFor="isCurrentCheck" className="text-xs text-slate-700 select-none">
                  Set as Current Active Academic Term immediately
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsTermModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Creating...' : 'Create Academic Term'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* CREATE COHORT MODAL */}
      {isCohortModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <Card className="w-full max-w-md p-6 bg-white shadow-2xl rounded-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">school</span>
                <h3 className="text-base font-bold text-slate-900">New Student Cohort</h3>
              </div>
              <button
                onClick={() => setIsCohortModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={handleCohortSubmit} className="space-y-4">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Cohort Code (Unique) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CSE-A-2023-2027"
                  value={cohortForm.code}
                  onChange={(e) => setCohortForm({ ...cohortForm, code: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Cohort Display Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CSE-A (Batch 2023-2027)"
                  value={cohortForm.name}
                  onChange={(e) => setCohortForm({ ...cohortForm, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Department
                </label>
                <input
                  type="text"
                  value={cohortForm.department}
                  onChange={(e) => setCohortForm({ ...cohortForm, department: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Admission Year *
                  </label>
                  <input
                    type="number"
                    required
                    value={cohortForm.admissionYear}
                    onChange={(e) =>
                      setCohortForm({ ...cohortForm, admissionYear: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Graduation Year *
                  </label>
                  <input
                    type="number"
                    required
                    value={cohortForm.graduationYear}
                    onChange={(e) =>
                      setCohortForm({ ...cohortForm, graduationYear: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsCohortModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Creating...' : 'Create Cohort'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
};


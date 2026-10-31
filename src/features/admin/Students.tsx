import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { apiClient } from '../../services/apiClient';

interface StudentRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  avatarUrl?: string;
  createdAt: string;
  rollNumber: string;
  branch: string;
  semester: number | null;
  division: string;
  admissionYear: number | null;
  cohortId: string | null;
  cohortName: string;
  cohortCode: string;
  overallScore: number;
  dsaProficiency: number;
  attendanceRate: number;
  assignedMentor: {
    assignmentId: string;
    assignedDate: string;
    mentor: {
      id: string;
      name: string;
      email: string;
    };
  } | null;
}

interface Cohort {
  id: string;
  name: string;
  code: string;
}

export const AdminStudents: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState<string>('');
  const [semesterFilter, setSemesterFilter] = useState<string>('');
  const [divisionFilter, setDivisionFilter] = useState<string>('');
  const [branchFilter, setBranchFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [editingStudent, setEditingStudent] = useState<StudentRecord | null>(null);
  const [viewingStudent, setViewingStudent] = useState<StudentRecord | null>(null);
  const [statusTargetStudent, setStatusTargetStudent] = useState<StudentRecord | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    rollNumber: '',
    branch: 'CSE',
    semester: 6,
    division: 'A',
    admissionYear: 2022,
    cohortId: '',
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [invitationResult, setInvitationResult] = useState<{
    message: string;
    emailSent: boolean;
    inviteLink?: string;
    smtpNote?: string;
  } | null>(null);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  // Load students & cohorts
  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [studentsRes, cohortsRes] = await Promise.all([
        apiClient.getStudents(),
        apiClient.getCohorts(),
      ]);

      if (studentsRes.error) {
        setError(studentsRes.error);
      } else {
        setStudents(studentsRes.data?.students || []);
      }

      if (cohortsRes.data?.cohorts) {
        setCohorts(cohortsRes.data.cohorts);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching students data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    if (searchParams.get('action') === 'create') {
      setIsCreateModalOpen(true);
      searchParams.delete('action');
      setSearchParams(searchParams);
    }
  }, []);

  // Filtered Students
  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      if (search) {
        const q = search.toLowerCase();
        const match =
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          s.rollNumber.toLowerCase().includes(q);
        if (!match) return false;
      }
      if (semesterFilter && String(s.semester) !== semesterFilter) return false;
      if (divisionFilter && s.division.toLowerCase() !== divisionFilter.toLowerCase()) return false;
      if (branchFilter && s.branch.toLowerCase() !== branchFilter.toLowerCase()) return false;
      if (statusFilter === 'active' && !s.isActive) return false;
      if (statusFilter === 'inactive' && s.isActive) return false;
      return true;
    });
  }, [students, search, semesterFilter, divisionFilter, branchFilter, statusFilter]);

  // Create Student
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      const res = await apiClient.createStudent(formData);
      if (res.error) {
        setFormError(res.error);
      } else {
        setInvitationResult({
          message: res.data?.message || 'Student invited successfully.',
          emailSent: res.data?.invitation?.emailSent ?? false,
          inviteLink: res.data?.invitation?.inviteLink,
          smtpNote: res.data?.invitation?.smtpNote,
        });
        loadData();
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create student account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Edit Student
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      const res = await apiClient.updateStudent(editingStudent.id, {
        name: formData.name,
        rollNumber: formData.rollNumber,
        branch: formData.branch,
        semester: Number(formData.semester),
        division: formData.division,
        admissionYear: Number(formData.admissionYear),
        cohortId: formData.cohortId || null,
      });

      if (res.error) {
        setFormError(res.error);
      } else {
        setEditingStudent(null);
        loadData();
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to update student details.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle Status
  const handleToggleStatus = async () => {
    if (!statusTargetStudent) return;
    setIsSubmitting(true);
    try {
      const newStatus = !statusTargetStudent.isActive;
      const res = await apiClient.setUserStatus(statusTargetStudent.id, newStatus);
      if (res.error) {
        alert(res.error);
      } else {
        setStatusTargetStudent(null);
        loadData();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update account status.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2500);
  };

  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
              Student Management
            </h1>
            <Badge variant="primary">{students.length} Total</Badge>
          </div>
          <p className="text-xs text-on-surface-variant mt-1">
            Department of Computer Science & Engineering • Enrolled Students Directory & Provisioning
          </p>
        </div>

        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setFormData({
              name: '',
              email: '',
              rollNumber: '',
              branch: 'CSE',
              semester: 6,
              division: 'A',
              admissionYear: 2022,
              cohortId: cohorts[0]?.id || '',
            });
            setInvitationResult(null);
            setFormError(null);
            setIsCreateModalOpen(true);
          }}
          className="flex items-center gap-1.5 text-xs shadow-sm shadow-primary/25"
        >
          <span className="material-symbols-outlined text-sm">person_add</span>
          Create Student Account
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
          {/* Search Box */}
          <div className="sm:col-span-2 relative">
            <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 text-lg">
              search
            </span>
            <input
              type="text"
              placeholder="Search by name, email, roll number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          {/* Semester Filter */}
          <div>
            <select
              value={semesterFilter}
              onChange={(e) => setSemesterFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
            >
              <option value="">All Semesters</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <option key={s} value={String(s)}>
                  Semester {s}
                </option>
              ))}
            </select>
          </div>

          {/* Division Filter */}
          <div>
            <select
              value={divisionFilter}
              onChange={(e) => setDivisionFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
            >
              <option value="">All Divisions</option>
              {['A', 'B', 'C'].map((d) => (
                <option key={d} value={d}>
                  Division {d}
                </option>
              ))}
            </select>
          </div>

          {/* Branch Filter */}
          <div>
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
            >
              <option value="">All Branches</option>
              <option value="CSE">CSE</option>
              <option value="IT">IT</option>
              <option value="AI&DS">AI & DS</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
            >
              <option value="">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
            </select>
          </div>
        </div>

        {/* Filter stats & Reset */}
        <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
          <span>
            Showing <strong className="text-slate-700">{filteredStudents.length}</strong> of{' '}
            <strong className="text-slate-700">{students.length}</strong> students
          </span>
          {(search || semesterFilter || divisionFilter || branchFilter || statusFilter) && (
            <button
              onClick={() => {
                setSearch('');
                setSemesterFilter('');
                setDivisionFilter('');
                setBranchFilter('');
                setStatusFilter('');
              }}
              className="text-xs text-primary hover:underline font-medium"
            >
              Clear Filters
            </button>
          )}
        </div>
      </Card>

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

      {/* Students Table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading student directory...</div>
        ) : filteredStudents.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <span className="material-symbols-outlined text-4xl text-slate-300">school</span>
            <p className="text-sm font-semibold text-slate-700">No students found</p>
            <p className="text-xs text-slate-400">
              {students.length === 0
                ? "No student accounts have been created yet. Click 'Create Student Account' to get started."
                : 'Try adjusting your search query or filter options.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200/80 text-slate-600 font-semibold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Student</th>
                  <th className="py-3 px-4">Roll Number</th>
                  <th className="py-3 px-4">Branch / Div</th>
                  <th className="py-3 px-4">Cohort</th>
                  <th className="py-3 px-4">Assigned Mentor</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStudents.map((student) => (
                  <tr key={student.id} className="hover:bg-slate-50/70 transition-colors">
                    {/* Student Info */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-200/60 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                          {student.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{student.name}</p>
                          <p className="text-[11px] text-slate-400 truncate">{student.email}</p>
                        </div>
                      </div>
                    </td>

                    {/* Roll Number */}
                    <td className="py-3 px-4 font-mono font-medium text-slate-800">
                      {student.rollNumber}
                    </td>

                    {/* Branch / Sem / Div */}
                    <td className="py-3 px-4 text-slate-600">
                      {student.branch} • Sem {student.semester || '-'} • Div {student.division || '-'}
                    </td>

                    {/* Cohort */}
                    <td className="py-3 px-4 text-slate-600">
                      <span className="truncate max-w-[150px] inline-block font-mono text-[11px]">
                        {student.cohortName}
                      </span>
                    </td>

                    {/* Assigned Mentor */}
                    <td className="py-3 px-4">
                      {student.assignedMentor?.mentor ? (
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span className="font-medium text-slate-800 truncate max-w-[140px]">
                            {student.assignedMentor.mentor.name}
                          </span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200/50">
                          <span className="material-symbols-outlined text-[12px]">warning</span>
                          Unassigned
                        </span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1 ${
                          student.isActive
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            student.isActive ? 'bg-emerald-500' : 'bg-rose-500'
                          }`}
                        />
                        {student.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => setViewingStudent(student)}
                          title="View Profile"
                          className="p-1 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-100"
                        >
                          <span className="material-symbols-outlined text-[17px]">visibility</span>
                        </button>
                        <button
                          onClick={() => {
                            setEditingStudent(student);
                            setFormData({
                              name: student.name,
                              email: student.email,
                              rollNumber: student.rollNumber,
                              branch: student.branch,
                              semester: student.semester || 1,
                              division: student.division,
                              admissionYear: student.admissionYear || 2022,
                              cohortId: student.cohortId || '',
                            });
                            setFormError(null);
                          }}
                          title="Edit Student"
                          className="p-1 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-100"
                        >
                          <span className="material-symbols-outlined text-[17px]">edit</span>
                        </button>
                        <button
                          onClick={() => setStatusTargetStudent(student)}
                          title={student.isActive ? 'Deactivate Student' : 'Activate Student'}
                          className={`p-1 rounded-lg ${
                            student.isActive
                              ? 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                              : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[17px]">
                            {student.isActive ? 'block' : 'check_circle'}
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* CREATE STUDENT MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <Card className="w-full max-w-lg p-6 bg-white shadow-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">person_add</span>
                <h3 className="text-base font-bold text-slate-900">Invite & Provision Student</h3>
              </div>
              <button
                onClick={() => {
                  setIsCreateModalOpen(false);
                  setInvitationResult(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {invitationResult ? (
              <div className="py-4 space-y-4">
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs space-y-1">
                  <p className="font-bold flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-base text-emerald-600">check_circle</span>
                    {invitationResult.message}
                  </p>
                  <p className="text-[11px] text-emerald-700">
                    {invitationResult.emailSent
                      ? 'An invitation email was sent to the student to set their password.'
                      : 'Account record was safely provisioned in Supabase.'}
                  </p>
                </div>

                {invitationResult.inviteLink && (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2">
                    <p className="font-semibold text-amber-800">
                      Direct SMTP Setup Required / Invitation Link:
                    </p>
                    <p className="text-[11px] text-amber-700 leading-relaxed">
                      {invitationResult.smtpNote}
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        readOnly
                        value={invitationResult.inviteLink}
                        className="flex-1 bg-white border border-amber-300 rounded-lg px-2.5 py-1.5 font-mono text-[11px] text-slate-800 select-all"
                      />
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => copyToClipboard(invitationResult.inviteLink!)}
                      >
                        {copySuccess ? 'Copied!' : 'Copy Link'}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <Button
                    variant="primary"
                    onClick={() => {
                      setIsCreateModalOpen(false);
                      setInvitationResult(null);
                    }}
                  >
                    Done
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateSubmit} className="space-y-4 pt-3">
                {formError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                    {formError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Alex Morgan"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Student Email Address *
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="alex.m@univ.edu"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Roll Number *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 21CSE101"
                      value={formData.rollNumber}
                      onChange={(e) => setFormData({ ...formData, rollNumber: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Branch
                    </label>
                    <select
                      value={formData.branch}
                      onChange={(e) => setFormData({ ...formData, branch: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
                    >
                      <option value="CSE">CSE</option>
                      <option value="IT">IT</option>
                      <option value="AI&DS">AI & DS</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Current Semester
                    </label>
                    <select
                      value={formData.semester}
                      onChange={(e) => setFormData({ ...formData, semester: Number(e.target.value) })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                        <option key={s} value={s}>
                          Semester {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Division
                    </label>
                    <select
                      value={formData.division}
                      onChange={(e) => setFormData({ ...formData, division: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
                    >
                      {['A', 'B', 'C'].map((d) => (
                        <option key={d} value={d}>
                          Division {d}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Admission Year
                    </label>
                    <input
                      type="number"
                      value={formData.admissionYear}
                      onChange={(e) => setFormData({ ...formData, admissionYear: Number(e.target.value) })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Academic Cohort
                    </label>
                    <select
                      value={formData.cohortId}
                      onChange={(e) => setFormData({ ...formData, cohortId: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
                    >
                      <option value="">Select Cohort</option>
                      {cohorts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setIsCreateModalOpen(false)}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" disabled={isSubmitting}>
                    {isSubmitting ? 'Provisioning...' : 'Send Invitation & Provision'}
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </div>
      )}

      {/* EDIT STUDENT MODAL */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <Card className="w-full max-w-lg p-6 bg-white shadow-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">edit</span>
                <h3 className="text-base font-bold text-slate-900">Edit Student Record</h3>
              </div>
              <button
                onClick={() => setEditingStudent(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4 pt-3">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Student Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Roll Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.rollNumber}
                    onChange={(e) => setFormData({ ...formData, rollNumber: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Branch
                  </label>
                  <select
                    value={formData.branch}
                    onChange={(e) => setFormData({ ...formData, branch: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
                  >
                    <option value="CSE">CSE</option>
                    <option value="IT">IT</option>
                    <option value="AI&DS">AI & DS</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Semester
                  </label>
                  <select
                    value={formData.semester}
                    onChange={(e) => setFormData({ ...formData, semester: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                      <option key={s} value={s}>
                        Semester {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Division
                  </label>
                  <select
                    value={formData.division}
                    onChange={(e) => setFormData({ ...formData, division: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
                  >
                    {['A', 'B', 'C'].map((d) => (
                      <option key={d} value={d}>
                        Division {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Admission Year
                  </label>
                  <input
                    type="number"
                    value={formData.admissionYear}
                    onChange={(e) => setFormData({ ...formData, admissionYear: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Cohort
                  </label>
                  <select
                    value={formData.cohortId}
                    onChange={(e) => setFormData({ ...formData, cohortId: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
                  >
                    <option value="">Select Cohort</option>
                    {cohorts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditingStudent(null)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* VIEW STUDENT PROFILE MODAL */}
      {viewingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <Card className="w-full max-w-lg p-6 bg-white shadow-2xl rounded-2xl max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-200 text-primary flex items-center justify-center font-bold text-base">
                  {viewingStudent.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">{viewingStudent.name}</h3>
                  <p className="text-xs text-slate-400 font-mono">{viewingStudent.email}</p>
                </div>
              </div>
              <button
                onClick={() => setViewingStudent(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Academic Info Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-4 rounded-xl border border-slate-200/70">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Roll Number</span>
                <span className="font-mono font-bold text-slate-800">{viewingStudent.rollNumber}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Account Status</span>
                <span
                  className={`inline-block font-bold ${
                    viewingStudent.isActive ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {viewingStudent.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Department & Branch</span>
                <span className="text-slate-800 font-medium">{viewingStudent.branch} (CSE)</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Class</span>
                <span className="text-slate-800 font-medium">
                  Semester {viewingStudent.semester} • Division {viewingStudent.division}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Admission Year</span>
                <span className="text-slate-800 font-medium">{viewingStudent.admissionYear || 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Cohort</span>
                <span className="text-slate-800 font-medium">{viewingStudent.cohortName}</span>
              </div>
            </div>

            {/* Assigned Mentor Card */}
            <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
              <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider block">
                Assigned Faculty Mentor
              </span>
              {viewingStudent.assignedMentor?.mentor ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-900 text-xs">
                      {viewingStudent.assignedMentor.mentor.name}
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono">
                      {viewingStudent.assignedMentor.mentor.email}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Assigned on {viewingStudent.assignedMentor.assignedDate}
                    </p>
                  </div>
                  <span className="material-symbols-outlined text-2xl text-emerald-600">verified</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-amber-700">
                  <span className="material-symbols-outlined text-base">warning</span>
                  <span>No faculty mentor currently assigned for this term.</span>
                </div>
              )}
            </div>

            {/* Academic Metrics */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/60 text-center">
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">Overall Score</span>
                <span className="text-lg font-bold text-slate-900">{viewingStudent.overallScore}%</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/60 text-center">
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">DSA Proficiency</span>
                <span className="text-lg font-bold text-slate-900">{viewingStudent.dsaProficiency}%</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/60 text-center">
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">Attendance</span>
                <span className="text-lg font-bold text-slate-900">{viewingStudent.attendanceRate}%</span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="outline" size="sm" onClick={() => setViewingStudent(null)}>
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ACTIVATE / DEACTIVATE CONFIRMATION MODAL */}
      {statusTargetStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <Card className="w-full max-w-md p-6 bg-white shadow-2xl rounded-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  statusTargetStudent.isActive ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'
                }`}
              >
                <span className="material-symbols-outlined text-xl">
                  {statusTargetStudent.isActive ? 'block' : 'check_circle'}
                </span>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {statusTargetStudent.isActive ? 'Deactivate Student Account?' : 'Activate Student Account?'}
                </h3>
                <p className="text-xs text-slate-500">
                  {statusTargetStudent.name} ({statusTargetStudent.rollNumber})
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {statusTargetStudent.isActive
                ? 'Deactivating this student will prevent them from signing in and deactivate any active mentor assignments. Historical records and test scores remain preserved.'
                : 'Activating this student will restore their ability to log in and be assigned to faculty mentors.'}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStatusTargetStudent(null)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                variant={statusTargetStudent.isActive ? 'danger' : 'primary'}
                size="sm"
                onClick={handleToggleStatus}
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? 'Updating...'
                  : statusTargetStudent.isActive
                  ? 'Confirm Deactivation'
                  : 'Confirm Activation'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

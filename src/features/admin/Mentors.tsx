import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { apiClient } from '../../services/apiClient';

interface AssignedMenteeBrief {
  assignmentId: string;
  studentId: string;
  name: string;
  email: string;
  rollNumber: string;
  assignedDate: string;
}

interface MentorRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  avatarUrl?: string;
  createdAt: string;
  employeeId: string;
  department: string;
  designation: string;
  officeLocation: string;
  officeHours: string;
  specializations: string[];
  assignedStudentsCount: number;
  assignedMentees: AssignedMenteeBrief[];
}

export const AdminMentors: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mentors, setMentors] = useState<MentorRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState<string>('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [editingMentor, setEditingMentor] = useState<MentorRecord | null>(null);
  const [viewingMentor, setViewingMentor] = useState<MentorRecord | null>(null);
  const [statusTargetMentor, setStatusTargetMentor] = useState<MentorRecord | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    employeeId: '',
    department: 'Computer Science & Engineering',
    designation: 'Associate Professor',
    officeLocation: 'Room 402, CS Block',
    officeHours: 'Mon & Wed 14:00 - 16:00',
    specializationsString: 'Distributed Systems, Cloud Architecture',
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

  // Load mentors
  const loadMentors = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.getMentors();
      if (res.error) {
        setError(res.error);
      } else {
        setMentors(res.data?.mentors || []);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching mentors.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMentors();
    if (searchParams.get('action') === 'create') {
      setIsCreateModalOpen(true);
      searchParams.delete('action');
      setSearchParams(searchParams);
    }
  }, []);

  // Filtered mentors
  const filteredMentors = useMemo(() => {
    return mentors.filter((m) => {
      if (search) {
        const q = search.toLowerCase();
        const match =
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          m.employeeId.toLowerCase().includes(q) ||
          m.designation.toLowerCase().includes(q);
        if (!match) return false;
      }
      if (departmentFilter && m.department.toLowerCase() !== departmentFilter.toLowerCase()) {
        return false;
      }
      if (statusFilter === 'active' && !m.isActive) return false;
      if (statusFilter === 'inactive' && m.isActive) return false;
      return true;
    });
  }, [mentors, search, departmentFilter, statusFilter]);

  // Create Mentor
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      const specializations = formData.specializationsString
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await apiClient.createMentor({
        name: formData.name,
        email: formData.email,
        employeeId: formData.employeeId,
        department: formData.department,
        designation: formData.designation,
        officeLocation: formData.officeLocation,
        officeHours: formData.officeHours,
        specializations,
      });

      if (res.error) {
        setFormError(res.error);
      } else {
        setInvitationResult({
          message: res.data?.message || 'Faculty mentor invited successfully.',
          emailSent: res.data?.invitation?.emailSent ?? false,
          inviteLink: res.data?.invitation?.inviteLink,
          smtpNote: res.data?.invitation?.smtpNote,
        });
        loadMentors();
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create mentor account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Edit Mentor
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMentor) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      const specializations = formData.specializationsString
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await apiClient.updateMentor(editingMentor.id, {
        name: formData.name,
        employeeId: formData.employeeId,
        department: formData.department,
        designation: formData.designation,
        officeLocation: formData.officeLocation,
        officeHours: formData.officeHours,
        specializations,
      });

      if (res.error) {
        setFormError(res.error);
      } else {
        setEditingMentor(null);
        loadMentors();
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to update mentor details.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle Status
  const handleToggleStatus = async () => {
    if (!statusTargetMentor) return;
    setIsSubmitting(true);
    try {
      const newStatus = !statusTargetMentor.isActive;
      const res = await apiClient.setUserStatus(statusTargetMentor.id, newStatus);
      if (res.error) {
        alert(res.error);
      } else {
        setStatusTargetMentor(null);
        loadMentors();
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
              Faculty Mentor Management
            </h1>
            <Badge variant="primary">{mentors.length} Total</Badge>
          </div>
          <p className="text-xs text-on-surface-variant mt-1">
            Institutional Faculty Advising Directory • Account Provisioning & Workload Oversight
          </p>
        </div>

        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setFormData({
              name: '',
              email: '',
              employeeId: '',
              department: 'Computer Science & Engineering',
              designation: 'Associate Professor',
              officeLocation: 'Room 402, CS Block',
              officeHours: 'Mon & Wed 14:00 - 16:00',
              specializationsString: 'Distributed Systems, Cloud Computing',
            });
            setInvitationResult(null);
            setFormError(null);
            setIsCreateModalOpen(true);
          }}
          className="flex items-center gap-1.5 text-xs shadow-sm shadow-primary/25"
        >
          <span className="material-symbols-outlined text-sm">group_add</span>
          Create Mentor Account
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {/* Search Box */}
          <div className="sm:col-span-2 relative">
            <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 text-lg">
              search
            </span>
            <input
              type="text"
              placeholder="Search by name, email, employee ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          {/* Department Filter */}
          <div>
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
            >
              <option value="">All Departments</option>
              <option value="Computer Science & Engineering">Computer Science & Engineering</option>
              <option value="Information Technology">Information Technology</option>
              <option value="Artificial Intelligence">Artificial Intelligence</option>
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
            Showing <strong className="text-slate-700">{filteredMentors.length}</strong> of{' '}
            <strong className="text-slate-700">{mentors.length}</strong> faculty mentors
          </span>
          {(search || departmentFilter || statusFilter) && (
            <button
              onClick={() => {
                setSearch('');
                setDepartmentFilter('');
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
          <Button size="sm" variant="outline" onClick={loadMentors}>
            Retry
          </Button>
        </div>
      )}

      {/* Mentors Grid / Table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading faculty mentor directory...</div>
        ) : filteredMentors.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <span className="material-symbols-outlined text-4xl text-slate-300">supervisor_account</span>
            <p className="text-sm font-semibold text-slate-700">No mentors found</p>
            <p className="text-xs text-slate-400">
              {mentors.length === 0
                ? "No faculty mentor accounts have been created yet. Click 'Create Mentor Account' to add faculty."
                : 'Try adjusting your search criteria.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200/80 text-slate-600 font-semibold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Faculty Mentor</th>
                  <th className="py-3 px-4">Employee ID</th>
                  <th className="py-3 px-4">Designation</th>
                  <th className="py-3 px-4">Office Cabin</th>
                  <th className="py-3 px-4">Assigned Mentees</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMentors.map((mentor) => (
                  <tr key={mentor.id} className="hover:bg-slate-50/70 transition-colors">
                    {/* Mentor Info */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-sky-50 border border-sky-200 text-sky-700 flex items-center justify-center font-bold text-xs shrink-0">
                          {mentor.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{mentor.name}</p>
                          <p className="text-[11px] text-slate-400 truncate">{mentor.email}</p>
                        </div>
                      </div>
                    </td>

                    {/* Employee ID */}
                    <td className="py-3 px-4 font-mono font-medium text-slate-800">
                      {mentor.employeeId}
                    </td>

                    {/* Designation */}
                    <td className="py-3 px-4 text-slate-600">
                      <span className="font-medium text-slate-800">{mentor.designation}</span>
                      <span className="block text-[10px] text-slate-400 truncate max-w-[160px]">
                        {mentor.department}
                      </span>
                    </td>

                    {/* Office */}
                    <td className="py-3 px-4 text-slate-600">
                      <span>{mentor.officeLocation || 'N/A'}</span>
                    </td>

                    {/* Assigned Mentees Count */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded-full text-xs">
                          {mentor.assignedStudentsCount}
                        </span>
                        <span className="text-[11px] text-slate-400">mentees</span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1 ${
                          mentor.isActive
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            mentor.isActive ? 'bg-emerald-500' : 'bg-rose-500'
                          }`}
                        />
                        {mentor.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => setViewingMentor(mentor)}
                          title="View Mentor Profile & Mentees"
                          className="p-1 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-100"
                        >
                          <span className="material-symbols-outlined text-[17px]">visibility</span>
                        </button>
                        <button
                          onClick={() => {
                            setEditingMentor(mentor);
                            setFormData({
                              name: mentor.name,
                              email: mentor.email,
                              employeeId: mentor.employeeId,
                              department: mentor.department,
                              designation: mentor.designation,
                              officeLocation: mentor.officeLocation,
                              officeHours: mentor.officeHours,
                              specializationsString: (mentor.specializations || []).join(', '),
                            });
                            setFormError(null);
                          }}
                          title="Edit Mentor"
                          className="p-1 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-100"
                        >
                          <span className="material-symbols-outlined text-[17px]">edit</span>
                        </button>
                        <button
                          onClick={() => setStatusTargetMentor(mentor)}
                          title={mentor.isActive ? 'Deactivate Mentor' : 'Activate Mentor'}
                          className={`p-1 rounded-lg ${
                            mentor.isActive
                              ? 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                              : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[17px]">
                            {mentor.isActive ? 'block' : 'check_circle'}
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

      {/* CREATE MENTOR MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <Card className="w-full max-w-lg p-6 bg-white shadow-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">group_add</span>
                <h3 className="text-base font-bold text-slate-900">Invite & Provision Faculty Mentor</h3>
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
                      ? 'An invitation email was dispatched to the faculty member to configure their credentials.'
                      : 'Faculty account was safely provisioned in Supabase.'}
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
                      placeholder="e.g. Dr. Jane Doe"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Faculty Email *
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="jane.doe@univ.edu"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Employee ID *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. FAC-CSE-042"
                      value={formData.employeeId}
                      onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Designation
                    </label>
                    <select
                      value={formData.designation}
                      onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
                    >
                      <option value="Professor">Professor</option>
                      <option value="Associate Professor">Associate Professor</option>
                      <option value="Assistant Professor">Assistant Professor</option>
                      <option value="Adjunct Faculty">Adjunct Faculty</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Department
                    </label>
                    <input
                      type="text"
                      value={formData.department}
                      onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Office Location / Cabin
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Room 402, CS Block"
                      value={formData.officeLocation}
                      onChange={(e) => setFormData({ ...formData, officeLocation: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Office Hours
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Mon-Wed 14:00 - 16:00"
                      value={formData.officeHours}
                      onChange={(e) => setFormData({ ...formData, officeHours: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Specializations (comma-separated)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Algorithms, Machine Learning, Systems"
                      value={formData.specializationsString}
                      onChange={(e) =>
                        setFormData({ ...formData, specializationsString: e.target.value })
                      }
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
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

      {/* EDIT MENTOR MODAL */}
      {editingMentor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <Card className="w-full max-w-lg p-6 bg-white shadow-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">edit</span>
                <h3 className="text-base font-bold text-slate-900">Edit Faculty Information</h3>
              </div>
              <button
                onClick={() => setEditingMentor(null)}
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
                    Faculty Full Name *
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
                    Employee ID *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.employeeId}
                    onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Designation
                  </label>
                  <select
                    value={formData.designation}
                    onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
                  >
                    <option value="Professor">Professor</option>
                    <option value="Associate Professor">Associate Professor</option>
                    <option value="Assistant Professor">Assistant Professor</option>
                    <option value="Adjunct Faculty">Adjunct Faculty</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Department
                  </label>
                  <input
                    type="text"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Office Cabin
                  </label>
                  <input
                    type="text"
                    value={formData.officeLocation}
                    onChange={(e) => setFormData({ ...formData, officeLocation: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Office Hours
                  </label>
                  <input
                    type="text"
                    value={formData.officeHours}
                    onChange={(e) => setFormData({ ...formData, officeHours: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Specializations (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={formData.specializationsString}
                    onChange={(e) =>
                      setFormData({ ...formData, specializationsString: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditingMentor(null)}
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

      {/* VIEW MENTOR PROFILE & ASSIGNED MENTEES MODAL */}
      {viewingMentor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <Card className="w-full max-w-2xl p-6 bg-white shadow-2xl rounded-2xl max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-sky-50 border border-sky-200 text-sky-700 flex items-center justify-center font-bold text-lg">
                  {viewingMentor.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">{viewingMentor.name}</h3>
                  <p className="text-xs text-slate-500">{viewingMentor.designation} • {viewingMentor.department}</p>
                </div>
              </div>
              <button
                onClick={() => setViewingMentor(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Faculty Meta Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-slate-50 p-4 rounded-xl border border-slate-200/70">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Employee ID</span>
                <span className="font-mono font-bold text-slate-800">{viewingMentor.employeeId}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Status</span>
                <span
                  className={`inline-block font-bold ${
                    viewingMentor.isActive ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {viewingMentor.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Office Cabin</span>
                <span className="text-slate-800 font-medium">{viewingMentor.officeLocation || 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Current Mentees</span>
                <span className="text-primary font-bold">{viewingMentor.assignedStudentsCount} Students</span>
              </div>
            </div>

            {/* Office Hours & Specializations */}
            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="text-slate-400 font-semibold w-24 shrink-0">Office Hours:</span>
                <span className="text-slate-700">{viewingMentor.officeHours || 'On appointment'}</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-slate-400 font-semibold w-24 shrink-0">Specializations:</span>
                <div className="flex flex-wrap gap-1">
                  {(viewingMentor.specializations || []).length > 0 ? (
                    viewingMentor.specializations.map((spec, i) => (
                      <span
                        key={i}
                        className="bg-indigo-50 text-primary border border-indigo-200/50 px-2 py-0.5 rounded text-[11px]"
                      >
                        {spec}
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-400">Not specified</span>
                  )}
                </div>
              </div>
            </div>

            {/* Assigned Mentees Table */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Assigned Students ({viewingMentor.assignedMentees.length})
                </h4>
              </div>

              {viewingMentor.assignedMentees.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">
                  No students currently assigned to this mentor. Go to Mentor Allocation to allocate mentees.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-[10px] uppercase">
                        <th className="py-2.5 px-3">Student Name</th>
                        <th className="py-2.5 px-3">Roll Number</th>
                        <th className="py-2.5 px-3">Email</th>
                        <th className="py-2.5 px-3">Assigned Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {viewingMentor.assignedMentees.map((mentee) => (
                        <tr key={mentee.assignmentId} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-semibold text-slate-800">{mentee.name}</td>
                          <td className="py-2 px-3 font-mono text-slate-600">{mentee.rollNumber}</td>
                          <td className="py-2 px-3 text-slate-500 font-mono text-[11px]">
                            {mentee.email}
                          </td>
                          <td className="py-2 px-3 text-slate-400 text-[11px]">{mentee.assignedDate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="outline" size="sm" onClick={() => setViewingMentor(null)}>
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ACTIVATE / DEACTIVATE CONFIRMATION MODAL */}
      {statusTargetMentor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <Card className="w-full max-w-md p-6 bg-white shadow-2xl rounded-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  statusTargetMentor.isActive ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'
                }`}
              >
                <span className="material-symbols-outlined text-xl">
                  {statusTargetMentor.isActive ? 'block' : 'check_circle'}
                </span>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {statusTargetMentor.isActive ? 'Deactivate Faculty Mentor?' : 'Activate Faculty Mentor?'}
                </h3>
                <p className="text-xs text-slate-500">
                  {statusTargetMentor.name} ({statusTargetMentor.employeeId})
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {statusTargetMentor.isActive
                ? 'Deactivating this mentor will prevent them from signing in and deactivate active mentee allocations. The affected students will need to be reassigned in the Allocation workspace.'
                : 'Activating this mentor will restore their login access and allow them to receive mentee allocations.'}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStatusTargetMentor(null)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                variant={statusTargetMentor.isActive ? 'danger' : 'primary'}
                size="sm"
                onClick={handleToggleStatus}
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? 'Updating...'
                  : statusTargetMentor.isActive
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

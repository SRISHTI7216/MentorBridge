import React, { useEffect, useState, useMemo } from 'react';
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
}

interface AssignedStudentBrief {
  assignmentId: string;
  studentId: string;
  name: string;
  email: string;
  rollNumber: string;
  branch: string;
  semester: number;
  division: string;
  cohortName: string;
  assignedDate: string;
  notes?: string;
}

interface MentorAllocationItem {
  id: string;
  name: string;
  email: string;
  employeeId: string;
  department: string;
  designation: string;
  officeLocation: string;
  assignedCount: number;
  assignedMentees: AssignedStudentBrief[];
}

interface UnassignedStudentItem {
  id: string;
  name: string;
  email: string;
  rollNumber: string;
  branch: string;
  semester: number;
  division: string;
  cohortName: string;
}

export const AdminAllocation: React.FC = () => {
  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [selectedTermId, setSelectedTermId] = useState<string>('');
  const [currentTerm, setCurrentTerm] = useState<AcademicTerm | null>(null);

  const [mentors, setMentors] = useState<MentorAllocationItem[]>([]);
  const [unassignedStudents, setUnassignedStudents] = useState<UnassignedStudentItem[]>([]);
  const [stats, setStats] = useState({ totalAssigned: 0, totalUnassigned: 0, totalMentors: 0 });

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Workflow states
  const [targetMentorId, setTargetMentorId] = useState<string>('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [allocationNotes, setAllocationNotes] = useState<string>('');
  const [isAssigning, setIsAssigning] = useState<boolean>(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // Reassignment modal
  const [reassignStudent, setReassignStudent] = useState<{
    studentId: string;
    studentName: string;
    currentMentorName: string;
    assignmentId: string;
  } | null>(null);
  const [reassignNewMentorId, setReassignNewMentorId] = useState<string>('');
  const [reassignNotes, setReassignNotes] = useState<string>('');
  const [isReassigning, setIsReassigning] = useState<boolean>(false);

  // Filter & Search
  const [studentSearch, setStudentSearch] = useState<string>('');
  const [studentFilter, setStudentFilter] = useState<'all' | 'unassigned' | 'assigned'>('unassigned');
  const [expandedMentorId, setExpandedMentorId] = useState<string | null>(null);

  // Load terms & allocations
  const loadTermsAndAllocations = async (termIdToLoad?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const termsRes = await apiClient.getAcademicTerms();
      const termsList: AcademicTerm[] = termsRes.data?.terms || [];
      setTerms(termsList);

      const active = termsList.find((t) => t.is_current) || termsList[0];
      const termId = termIdToLoad || active?.id || '';
      setSelectedTermId(termId);

      if (termId) {
        const allocRes = await apiClient.getAllocations(termId);
        if (allocRes.error) {
          setError(allocRes.error);
        } else if (allocRes.data) {
          setCurrentTerm(allocRes.data.term);
          setMentors(allocRes.data.mentors || []);
          setUnassignedStudents(allocRes.data.unassignedStudents || []);
          setStats(allocRes.data.stats || { totalAssigned: 0, totalUnassigned: 0, totalMentors: 0 });
          if (!targetMentorId && allocRes.data.mentors?.length > 0) {
            setTargetMentorId(allocRes.data.mentors[0].id);
          }
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load allocations data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTermsAndAllocations();
  }, []);

  const handleTermChange = (termId: string) => {
    setSelectedTermId(termId);
    setSelectedStudentIds([]);
    loadTermsAndAllocations(termId);
  };

  // Build unified list of students for the term
  const allEligibleStudents = useMemo(() => {
    const list: Array<{
      id: string;
      name: string;
      email: string;
      rollNumber: string;
      branch: string;
      semester: number;
      division: string;
      cohortName: string;
      isAssigned: boolean;
      assignedMentorId?: string;
      assignedMentorName?: string;
      assignmentId?: string;
    }> = [];

    // Add unassigned
    unassignedStudents.forEach((s) => {
      list.push({
        ...s,
        isAssigned: false,
      });
    });

    // Add assigned
    mentors.forEach((m) => {
      m.assignedMentees.forEach((mentee) => {
        list.push({
          id: mentee.studentId,
          name: mentee.name,
          email: mentee.email,
          rollNumber: mentee.rollNumber,
          branch: mentee.branch,
          semester: mentee.semester,
          division: mentee.division,
          cohortName: mentee.cohortName,
          isAssigned: true,
          assignedMentorId: m.id,
          assignedMentorName: m.name,
          assignmentId: mentee.assignmentId,
        });
      });
    });

    return list;
  }, [unassignedStudents, mentors]);

  // Filter students
  const filteredStudents = useMemo(() => {
    return allEligibleStudents.filter((s) => {
      if (studentFilter === 'unassigned' && s.isAssigned) return false;
      if (studentFilter === 'assigned' && !s.isAssigned) return false;
      if (studentSearch) {
        const q = studentSearch.toLowerCase();
        const match =
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          s.rollNumber.toLowerCase().includes(q) ||
          (s.assignedMentorName && s.assignedMentorName.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [allEligibleStudents, studentFilter, studentSearch]);

  // Selection toggle
  const toggleStudentSelection = (studentId: string) => {
    setSelectedStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };

  const selectAllFiltered = () => {
    const ids = filteredStudents.map((s) => s.id);
    setSelectedStudentIds(ids);
  };

  const clearSelection = () => {
    setSelectedStudentIds([]);
  };

  // Assign Selected
  const handleAssignSelected = async () => {
    if (selectedStudentIds.length === 0 || !targetMentorId || !selectedTermId) return;
    setIsAssigning(true);
    setActionSuccessMessage(null);
    try {
      const res = await apiClient.assignStudents({
        studentIds: selectedStudentIds,
        mentorId: targetMentorId,
        academicTermId: selectedTermId,
        notes: allocationNotes || undefined,
      });

      if (res.error) {
        alert(res.error);
      } else {
        setActionSuccessMessage(res.data?.message || 'Allocations saved successfully.');
        setSelectedStudentIds([]);
        setAllocationNotes('');
        await loadTermsAndAllocations(selectedTermId);
        setTimeout(() => setActionSuccessMessage(null), 4000);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to allocate students.');
    } finally {
      setIsAssigning(false);
    }
  };

  // Reassign Modal Submit
  const handleReassignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reassignStudent || !reassignNewMentorId || !selectedTermId) return;
    setIsReassigning(true);
    try {
      const res = await apiClient.reassignMentor({
        studentId: reassignStudent.studentId,
        newMentorId: reassignNewMentorId,
        academicTermId: selectedTermId,
        notes: reassignNotes || undefined,
      });

      if (res.error) {
        alert(res.error);
      } else {
        setReassignStudent(null);
        setReassignNewMentorId('');
        setReassignNotes('');
        await loadTermsAndAllocations(selectedTermId);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Reassignment failed.');
    } finally {
      setIsReassigning(false);
    }
  };

  // Remove / Deactivate Allocation
  const handleDeleteAllocation = async (assignmentId: string, studentName: string) => {
    if (!confirm(`Are you sure you want to deactivate the mentor assignment for ${studentName}?`)) {
      return;
    }
    try {
      const res = await apiClient.deleteAllocation(assignmentId);
      if (res.error) {
        alert(res.error);
      } else {
        loadTermsAndAllocations(selectedTermId);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to remove assignment.');
    }
  };

  const selectedMentorObj = mentors.find((m) => m.id === targetMentorId);

  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
              Mentor–Mentee Allocation
            </h1>
            <Badge variant="primary">ABET Criterion 3 & 5</Badge>
          </div>
          <p className="text-xs text-on-surface-variant mt-1">
            Department of Computer Science & Engineering • Term Advising Pairings & Workload Balance
          </p>
        </div>

        {/* Academic Term Selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600 whitespace-nowrap">
            Academic Term:
          </label>
          <select
            value={selectedTermId}
            onChange={(e) => handleTermChange(e.target.value)}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} {t.is_current ? '(CURRENT)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Success Notification */}
      {actionSuccessMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-emerald-600">check_circle</span>
            <span className="font-semibold">{actionSuccessMessage}</span>
          </div>
          <button onClick={() => setActionSuccessMessage(null)} className="text-emerald-700">
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
          <Button size="sm" variant="outline" onClick={() => loadTermsAndAllocations(selectedTermId)}>
            Retry
          </Button>
        </div>
      )}

      {/* Allocation Summary Metrics */}
      {isLoading ? (
        <div className="p-8 text-center text-xs text-slate-400 bg-slate-50 rounded-2xl border border-slate-200">
          Loading allocation records...
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="p-4 border-l-4 border-l-emerald-500 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Assigned Students</span>
              <p className="text-2xl font-bold font-display text-slate-900 mt-1">{stats.totalAssigned}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">assignment_turned_in</span>
            </div>
          </Card>

          <Card className="p-4 border-l-4 border-l-amber-500 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Unassigned Students</span>
              <p className="text-2xl font-bold font-display text-slate-900 mt-1">{stats.totalUnassigned}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">person_off</span>
            </div>
          </Card>

          <Card className="p-4 border-l-4 border-l-primary flex items-center justify-between">
            <div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Faculty Advisors</span>
              <p className="text-2xl font-bold font-display text-slate-900 mt-1">{stats.totalMentors}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">supervisor_account</span>
            </div>
          </Card>
        </div>
      )}

      {/* Allocation Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Target Mentor Selection & Allocation Controls */}
        <div className="lg:col-span-5 space-y-4">
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">assignment_ind</span>
                <h3 className="text-sm font-bold text-slate-900">1. Select Target Mentor</h3>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">
                {mentors.length} Mentors Available
              </span>
            </div>

            {/* Mentor Dropdown / Cards */}
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {mentors.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">
                  No active faculty mentors found. Create mentor accounts first.
                </p>
              ) : (
                mentors.map((mentor) => (
                  <div
                    key={mentor.id}
                    onClick={() => setTargetMentorId(mentor.id)}
                    className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                      targetMentorId === mentor.id
                        ? 'bg-indigo-50/70 border-primary shadow-sm'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 truncate">{mentor.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {mentor.designation} • {mentor.employeeId}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-bold text-xs bg-white px-2 py-0.5 rounded-full border border-slate-200">
                          {mentor.assignedCount} mentees
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Target Mentor Selected Info */}
            {selectedMentorObj && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">Target Selected:</span>
                <p className="font-bold text-slate-900">{selectedMentorObj.name}</p>
                <p className="text-[11px] text-slate-500">
                  Currently assigned: <strong className="text-primary">{selectedMentorObj.assignedCount}</strong> students
                </p>
              </div>
            )}

            {/* Allocation Notes */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Assignment Notes (Optional)
              </label>
              <textarea
                rows={2}
                placeholder="e.g. Capstone project advising group or academic probation support"
                value={allocationNotes}
                onChange={(e) => setAllocationNotes(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            {/* Action Button */}
            <Button
              variant="primary"
              className="w-full py-2.5 text-xs font-bold shadow-md shadow-primary/20 flex items-center justify-center gap-2"
              disabled={selectedStudentIds.length === 0 || !targetMentorId || isAssigning}
              onClick={handleAssignSelected}
            >
              <span className="material-symbols-outlined text-base">how_to_reg</span>
              {isAssigning
                ? 'Allocating...'
                : `Assign Selected (${selectedStudentIds.length}) to ${selectedMentorObj?.name.split(' ')[0] || 'Mentor'}`}
            </Button>
          </Card>

          {/* Mentor Allocation Breakdown & Mentees List */}
          <Card className="p-5 space-y-3">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Faculty Workload Distribution
            </h4>
            <div className="space-y-2">
              {mentors.map((mentor) => (
                <div key={mentor.id} className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                  <div
                    onClick={() =>
                      setExpandedMentorId(expandedMentorId === mentor.id ? null : mentor.id)
                    }
                    className="p-3 bg-slate-50 flex items-center justify-between cursor-pointer hover:bg-slate-100/70"
                  >
                    <div>
                      <p className="font-semibold text-slate-800">{mentor.name}</p>
                      <p className="text-[10px] text-slate-400">{mentor.employeeId}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-primary">{mentor.assignedCount} Mentees</span>
                      <span className="material-symbols-outlined text-slate-400 text-sm">
                        {expandedMentorId === mentor.id ? 'expand_less' : 'expand_more'}
                      </span>
                    </div>
                  </div>

                  {expandedMentorId === mentor.id && (
                    <div className="p-3 bg-white divide-y divide-slate-100">
                      {mentor.assignedMentees.length === 0 ? (
                        <p className="text-slate-400 text-[11px] py-1 text-center">No mentees assigned</p>
                      ) : (
                        mentor.assignedMentees.map((mentee) => (
                          <div
                            key={mentee.assignmentId}
                            className="py-2 flex items-center justify-between text-xs"
                          >
                            <div>
                              <p className="font-medium text-slate-800">{mentee.name}</p>
                              <p className="text-[10px] text-slate-400 font-mono">
                                {mentee.rollNumber} • Sem {mentee.semester} Div {mentee.division}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() =>
                                  setReassignStudent({
                                    studentId: mentee.studentId,
                                    studentName: mentee.name,
                                    currentMentorName: mentor.name,
                                    assignmentId: mentee.assignmentId,
                                  })
                                }
                                title="Reassign to another mentor"
                                className="p-1 rounded text-slate-400 hover:text-primary hover:bg-slate-100"
                              >
                                <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
                              </button>
                              <button
                                onClick={() =>
                                  handleDeleteAllocation(mentee.assignmentId, mentee.name)
                                }
                                title="Deactivate assignment"
                                className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                              >
                                <span className="material-symbols-outlined text-[16px]">close</span>
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right Column: Students Selection Table */}
        <div className="lg:col-span-7 space-y-4">
          <Card className="p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">groups</span>
                <h3 className="text-sm font-bold text-slate-900">2. Select Eligible Students</h3>
              </div>

              {/* Status Filter Pill Buttons */}
              <div className="inline-flex rounded-xl p-1 bg-slate-100 border border-slate-200 text-xs">
                <button
                  onClick={() => setStudentFilter('unassigned')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                    studentFilter === 'unassigned'
                      ? 'bg-white text-primary shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Unassigned ({unassignedStudents.length})
                </button>
                <button
                  onClick={() => setStudentFilter('assigned')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                    studentFilter === 'assigned'
                      ? 'bg-white text-primary shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Assigned ({stats.totalAssigned})
                </button>
                <button
                  onClick={() => setStudentFilter('all')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                    studentFilter === 'all'
                      ? 'bg-white text-primary shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All ({allEligibleStudents.length})
                </button>
              </div>
            </div>

            {/* Search and Batch Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-72">
                <span className="material-symbols-outlined absolute left-3 top-2 text-slate-400 text-base">
                  search
                </span>
                <input
                  type="text"
                  placeholder="Search students..."
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="flex items-center gap-2 text-xs w-full sm:w-auto justify-end">
                <button
                  onClick={selectAllFiltered}
                  className="text-primary hover:underline font-semibold"
                >
                  Select All
                </button>
                <span className="text-slate-300">|</span>
                <button onClick={clearSelection} className="text-slate-500 hover:underline">
                  Deselect
                </button>
                <span className="text-slate-400 text-[11px]">
                  ({selectedStudentIds.length} chosen)
                </span>
              </div>
            </div>

            {/* Students Table */}
            <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[520px] overflow-y-auto">
              {filteredStudents.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  No students match your filter in {currentTerm?.code || 'this term'}.
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-[10px] uppercase">
                    <tr>
                      <th className="py-2.5 px-3 w-8 text-center">
                        <span className="sr-only">Select</span>
                      </th>
                      <th className="py-2.5 px-3">Student</th>
                      <th className="py-2.5 px-3">Roll Number</th>
                      <th className="py-2.5 px-3">Class</th>
                      <th className="py-2.5 px-3">Status / Assigned</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStudents.map((student) => {
                      const isSelected = selectedStudentIds.includes(student.id);
                      return (
                        <tr
                          key={student.id}
                          className={`hover:bg-slate-50 transition-colors ${
                            isSelected ? 'bg-indigo-50/40' : ''
                          }`}
                        >
                          <td className="py-2.5 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleStudentSelection(student.id)}
                              className="rounded border-slate-300 text-primary focus:ring-primary/20"
                            />
                          </td>
                          <td className="py-2.5 px-3">
                            <p className="font-semibold text-slate-800">{student.name}</p>
                            <p className="text-[10px] text-slate-400 truncate max-w-[140px]">
                              {student.email}
                            </p>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-700">
                            {student.rollNumber}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">
                            Sem {student.semester} • Div {student.division}
                          </td>
                          <td className="py-2.5 px-3">
                            {student.isAssigned ? (
                              <span className="inline-flex items-center gap-1 font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-[10px] border border-emerald-200/40 truncate max-w-[150px]">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                {student.assignedMentorName}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full text-[10px] border border-amber-200/40">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                Unassigned
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {student.isAssigned && (
                              <button
                                onClick={() =>
                                  setReassignStudent({
                                    studentId: student.id,
                                    studentName: student.name,
                                    currentMentorName: student.assignedMentorName || 'Faculty',
                                    assignmentId: student.assignmentId || '',
                                  })
                                }
                                className="text-[11px] text-primary hover:underline font-semibold"
                              >
                                Reassign
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* REASSIGN MENTOR MODAL */}
      {reassignStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <Card className="w-full max-w-md p-6 bg-white shadow-2xl rounded-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">swap_horiz</span>
                <h3 className="text-base font-bold text-slate-900">Reassign Mentor</h3>
              </div>
              <button
                onClick={() => setReassignStudent(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs space-y-1">
              <span className="text-slate-400 text-[10px] uppercase font-bold">Student:</span>
              <p className="font-bold text-slate-900">{reassignStudent.studentName}</p>
              <p className="text-slate-500 text-[11px]">
                Currently assigned to: <strong>{reassignStudent.currentMentorName}</strong>
              </p>
            </div>

            <form onSubmit={handleReassignSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Select New Faculty Mentor *
                </label>
                <select
                  required
                  value={reassignNewMentorId}
                  onChange={(e) => setReassignNewMentorId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
                >
                  <option value="">-- Choose New Mentor --</option>
                  {mentors.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.assignedCount} current mentees)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reason / Reassignment Note
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Schedule conflict or faculty study leave transition"
                  value={reassignNotes}
                  onChange={(e) => setReassignNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
                Notice: Reassignment transactionally deactivates the previous active assignment and
                creates the new assignment under ABET audit history.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setReassignStudent(null)}
                  disabled={isReassigning}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!reassignNewMentorId || isReassigning}
                >
                  {isReassigning ? 'Reassigning...' : 'Confirm Reassignment'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
};

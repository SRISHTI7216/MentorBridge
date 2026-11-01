import React, { useState, useEffect } from 'react';
import { apiClient } from '../../services/apiClient';
import { Assessment, MentorAssessmentStats, SubmissionReviewItem, AssessmentQuestion } from '../../types/assessment';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

export const MentorAssessments: React.FC = () => {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [stats, setStats] = useState<MentorAssessmentStats>({
    totalCreated: 0,
    published: 0,
    draft: 0,
    completed: 0,
    pendingSubmissions: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterSubject, setFilterSubject] = useState<string>('all');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Create / Edit Wizard State
  const [isEditorOpen, setIsEditorOpen] = useState<boolean>(false);
  const [editingAssessment, setEditingAssessment] = useState<Assessment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Form Fields
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSubject, setFormSubject] = useState('DSA');
  const [formTopic, setFormTopic] = useState('');
  const [formDuration, setFormDuration] = useState(45);
  const [formStartTime, setFormStartTime] = useState('');
  const [formEndTime, setFormEndTime] = useState('');
  const [formAllowedAttempts, setFormAllowedAttempts] = useState(1);
  const [formPassingMarks, setFormPassingMarks] = useState(10);
  const [formQuestions, setFormQuestions] = useState<AssessmentQuestion[]>([]);

  // Question Builder State
  const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);
  const [editingQuestionIndex, setEditingQuestionIndex] = useState<number | null>(null);
  const [qType, setQType] = useState<'mcq' | 'descriptive'>('mcq');
  const [qText, setQText] = useState('');
  const [qMarks, setQMarks] = useState(5);
  const [qExplanation, setQExplanation] = useState('');
  const [qGuidance, setQGuidance] = useState('');
  const [qOptions, setQOptions] = useState<Array<{ optionText: string; isCorrect: boolean }>>([
    { optionText: '', isCorrect: true },
    { optionText: '', isCorrect: false },
    { optionText: '', isCorrect: false },
    { optionText: '', isCorrect: false },
  ]);

  // Preview Modal
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Submissions & Grading Review Queue State
  const [reviewAssessment, setReviewAssessment] = useState<Assessment | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionReviewItem[]>([]);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState(false);
  const [gradingAttemptId, setGradingAttemptId] = useState<string | null>(null);
  const [gradingData, setGradingData] = useState<{
    attempt: any;
    assessment: any;
    questions: any[];
    answers: any[];
  } | null>(null);
  const [gradingScores, setGradingScores] = useState<Record<string, number>>({});
  const [gradingFeedbacks, setGradingFeedbacks] = useState<Record<string, string>>({});
  const [generalFeedback, setGeneralFeedback] = useState('');
  const [isSavingEvaluation, setIsSavingEvaluation] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await apiClient.getMentorAssessments();
      if (res.data) {
        setAssessments(res.data.assessments || []);
        setStats(
          res.data.stats || {
            totalCreated: 0,
            published: 0,
            draft: 0,
            completed: 0,
            pendingSubmissions: 0,
          }
        );
      } else if (res.error) {
        setErrorMessage(res.error);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load assessments.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filter assessments
  const filteredAssessments = assessments.filter((a) => {
    const matchesStatus = filterStatus === 'all' || a.status === filterStatus;
    const matchesSubject = filterSubject === 'all' || a.subject.toLowerCase() === filterSubject.toLowerCase();
    return matchesStatus && matchesSubject;
  });

  const openCreateModal = () => {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

    const pad = (n: number) => (n < 10 ? '0' + n : n);
    const formatLocal = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

    setEditingAssessment(null);
    setFormTitle('');
    setFormDescription('');
    setFormSubject('DSA');
    setFormTopic('');
    setFormDuration(45);
    setFormStartTime(formatLocal(now));
    setFormEndTime(formatLocal(nextWeek));
    setFormAllowedAttempts(1);
    setFormPassingMarks(10);
    setFormQuestions([]);
    setIsEditorOpen(true);
  };

  const openEditModal = async (a: Assessment) => {
    setEditingAssessment(a);
    setFormTitle(a.title);
    setFormDescription(a.description || '');
    setFormSubject(a.subject);
    setFormTopic(a.topic);
    setFormDuration(a.durationMinutes);
    setFormStartTime(a.startTime ? a.startTime.slice(0, 16) : '');
    setFormEndTime(a.endTime ? a.endTime.slice(0, 16) : '');
    setFormAllowedAttempts(a.allowedAttempts || 1);
    setFormPassingMarks(a.passingMarks || 0);

    try {
      const res = await apiClient.getAssessment(a.id);
      if (res.data?.assessment?.questions) {
        setFormQuestions(res.data.assessment.questions);
      } else {
        setFormQuestions([]);
      }
    } catch {
      setFormQuestions([]);
    }

    setIsEditorOpen(true);
  };

  const handleSaveAssessment = async (publishImmediate = false) => {
    if (!formTitle.trim() || !formTopic.trim()) {
      alert('Please provide Assessment Title and Topic.');
      return;
    }

    if (publishImmediate && formQuestions.length === 0) {
      alert('Cannot publish assessment: You must add at least one question.');
      return;
    }

    setIsSubmitting(true);
    try {
      const sumMarks = formQuestions.reduce((acc, q) => acc + q.marks, 0);

      const payload = {
        title: formTitle.trim(),
        description: formDescription.trim(),
        subject: formSubject,
        topic: formTopic.trim(),
        durationMinutes: Number(formDuration) || 45,
        totalMarks: sumMarks > 0 ? sumMarks : 20,
        passingMarks: Number(formPassingMarks) || 10,
        startTime: new Date(formStartTime).toISOString(),
        endTime: new Date(formEndTime).toISOString(),
        allowedAttempts: Number(formAllowedAttempts) || 1,
      };

      let assessmentId = editingAssessment?.id;

      if (editingAssessment) {
        await apiClient.updateAssessment(editingAssessment.id, payload);
      } else {
        const createRes = await apiClient.createAssessment(payload);
        if (createRes.data?.assessment) {
          assessmentId = createRes.data.assessment.id;
        }
      }

      if (assessmentId) {
        // Sync questions if new
        if (!editingAssessment) {
          for (const q of formQuestions) {
            await apiClient.addAssessmentQuestion(assessmentId, {
              questionType: q.questionType,
              questionText: q.questionText,
              marks: q.marks,
              options: q.options?.map((opt) => ({
                optionText: opt.optionText,
                isCorrect: Boolean(opt.isCorrect),
              })),
              evaluationGuidance: q.evaluationGuidance,
              explanation: q.explanation,
            });
          }
        }

        if (publishImmediate) {
          await apiClient.publishAssessment(assessmentId);
        }
      }

      setIsEditorOpen(false);
      await loadData();
    } catch (err: any) {
      alert(err?.message || 'Failed to save assessment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Question Management
  const openAddQuestion = () => {
    setEditingQuestionIndex(null);
    setQType('mcq');
    setQText('');
    setQMarks(5);
    setQExplanation('');
    setQGuidance('');
    setQOptions([
      { optionText: '', isCorrect: true },
      { optionText: '', isCorrect: false },
      { optionText: '', isCorrect: false },
      { optionText: '', isCorrect: false },
    ]);
    setIsQuestionModalOpen(true);
  };

  const openEditQuestion = (index: number) => {
    setEditingQuestionIndex(index);
    const q = formQuestions[index];
    setQType(q.questionType);
    setQText(q.questionText);
    setQMarks(q.marks);
    setQExplanation(q.explanation || '');
    setQGuidance(q.evaluationGuidance || '');
    if (q.questionType === 'mcq' && q.options && q.options.length > 0) {
      setQOptions(
        q.options.map((opt) => ({
          optionText: opt.optionText,
          isCorrect: Boolean(opt.isCorrect),
        }))
      );
    } else {
      setQOptions([
        { optionText: '', isCorrect: true },
        { optionText: '', isCorrect: false },
        { optionText: '', isCorrect: false },
        { optionText: '', isCorrect: false },
      ]);
    }
    setIsQuestionModalOpen(true);
  };

  const handleSaveQuestion = async () => {
    if (!qText.trim()) {
      alert('Question text is required.');
      return;
    }

    if (qType === 'mcq') {
      const validOptions = qOptions.filter((o) => o.optionText.trim().length > 0);
      if (validOptions.length < 2) {
        alert('Please provide at least 2 non-empty options for MCQ.');
        return;
      }
      const correctCount = validOptions.filter((o) => o.isCorrect).length;
      if (correctCount !== 1) {
        alert('Please designate exactly one option as the correct answer.');
        return;
      }
    }

    const questionData: AssessmentQuestion = {
      questionOrder: editingQuestionIndex !== null ? editingQuestionIndex + 1 : formQuestions.length + 1,
      questionType: qType,
      questionText: qText.trim(),
      marks: Number(qMarks) || 1,
      options:
        qType === 'mcq'
          ? qOptions
              .filter((o) => o.optionText.trim().length > 0)
              .map((opt, i) => ({ ...opt, optionOrder: i + 1 }))
          : [],
      evaluationGuidance: qType === 'descriptive' ? qGuidance.trim() : undefined,
      explanation: qType === 'mcq' ? qExplanation.trim() : undefined,
    };

    if (editingQuestionIndex !== null) {
      const updated = [...formQuestions];
      const existingQ = updated[editingQuestionIndex];
      updated[editingQuestionIndex] = { ...questionData, id: existingQ.id };
      setFormQuestions(updated);

      if (editingAssessment && existingQ.id) {
        await apiClient.updateAssessmentQuestion(editingAssessment.id, existingQ.id, questionData);
      }
    } else {
      if (editingAssessment) {
        const res = await apiClient.addAssessmentQuestion(editingAssessment.id, questionData as any);
        if (res.data?.question) {
          setFormQuestions([...formQuestions, res.data.question]);
        } else {
          setFormQuestions([...formQuestions, questionData]);
        }
      } else {
        setFormQuestions([...formQuestions, questionData]);
      }
    }

    setIsQuestionModalOpen(false);
  };

  const handleDeleteQuestion = async (index: number) => {
    const q = formQuestions[index];
    if (editingAssessment && q.id) {
      await apiClient.deleteAssessmentQuestion(editingAssessment.id, q.id);
    }
    const updated = formQuestions.filter((_, idx) => idx !== index);
    setFormQuestions(updated);
  };

  const handleMoveQuestion = (index: number, direction: 'up' | 'down') => {
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === formQuestions.length - 1)
    ) {
      return;
    }
    const target = direction === 'up' ? index - 1 : index + 1;
    const copy = [...formQuestions];
    const temp = copy[index];
    copy[index] = copy[target];
    copy[target] = temp;
    copy.forEach((item, idx) => (item.questionOrder = idx + 1));
    setFormQuestions(copy);

    if (editingAssessment) {
      const orderedIds = copy.map((q) => q.id).filter(Boolean) as string[];
      if (orderedIds.length === copy.length) {
        apiClient.reorderAssessmentQuestions(editingAssessment.id, orderedIds);
      }
    }
  };

  // Submissions Review Queue
  const openReviewQueue = async (a: Assessment) => {
    setReviewAssessment(a);
    setIsLoadingSubmissions(true);
    try {
      const res = await apiClient.getAssessmentSubmissions(a.id);
      if (res.data) {
        setSubmissions(res.data.submissions || []);
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to load submissions.');
    } finally {
      setIsLoadingSubmissions(false);
    }
  };

  const openGradingModal = async (attemptId: string) => {
    setGradingAttemptId(attemptId);
    setGradingData(null);
    setGradingScores({});
    setGradingFeedbacks({});
    setGeneralFeedback('');

    try {
      const res = await apiClient.getSubmissionDetail(attemptId);
      if (res.data) {
        setGradingData(res.data);
        setGeneralFeedback(res.data.attempt.generalFeedback || '');

        const scores: Record<string, number> = {};
        const feedbacks: Record<string, string> = {};

        res.data.answers.forEach((ans: any) => {
          scores[ans.questionId] = ans.marksObtained || 0;
          if (ans.mentorFeedback) feedbacks[ans.questionId] = ans.mentorFeedback;
        });

        setGradingScores(scores);
        setGradingFeedbacks(feedbacks);
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to load submission data.');
    }
  };

  const handleSaveGrading = async () => {
    if (!gradingAttemptId || !gradingData) return;

    setIsSavingEvaluation(true);
    try {
      const evaluations = Object.keys(gradingScores).map((qId) => ({
        questionId: qId,
        marksObtained: Number(gradingScores[qId]) || 0,
        mentorFeedback: gradingFeedbacks[qId] || '',
      }));

      await apiClient.evaluateSubmission(gradingAttemptId, {
        evaluations,
        generalFeedback,
      });

      alert('Evaluation saved successfully.');
      setGradingAttemptId(null);
      if (reviewAssessment) {
        openReviewQueue(reviewAssessment);
      }
      loadData();
    } catch (err: any) {
      alert(err?.message || 'Failed to save evaluation.');
    } finally {
      setIsSavingEvaluation(false);
    }
  };

  const handlePublishResults = async (assessmentId: string) => {
    if (!confirm('Are you sure you want to publish results? Students will be able to see their final scores, detailed feedback, and correct answers.')) {
      return;
    }
    try {
      await apiClient.publishAssessmentResults(assessmentId);
      alert('Results published successfully to all students.');
      if (reviewAssessment) {
        openReviewQueue(reviewAssessment);
      }
      loadData();
    } catch (err: any) {
      alert(err?.message || 'Failed to publish results.');
    }
  };

  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-2xl">assignment</span>
            <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
              Weekly Assessment & Rubric Engine
            </h1>
          </div>
          <p className="text-xs text-on-surface-variant mt-1">
            Author weekly assessments, configure MCQ and descriptive rubrics, and calibrate mentee submissions.
          </p>
        </div>
        <Button
          size="sm"
          onClick={openCreateModal}
          leftIcon={<span className="material-symbols-outlined text-base">add_circle</span>}
        >
          + Create New Assessment
        </Button>
      </div>

      {errorMessage && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
          <span>{errorMessage}</span>
          <Button size="sm" variant="outline" onClick={loadData}>
            Retry
          </Button>
        </div>
      )}

      {/* KPI Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card className="p-4 border-l-4 border-l-primary space-y-1">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Created</p>
          <p className="text-2xl font-bold text-slate-900 font-display">{stats.totalCreated}</p>
        </Card>
        <Card className="p-4 border-l-4 border-l-emerald-500 space-y-1">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Published</p>
          <p className="text-2xl font-bold text-emerald-700 font-display">{stats.published}</p>
        </Card>
        <Card className="p-4 border-l-4 border-l-amber-500 space-y-1">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Drafts</p>
          <p className="text-2xl font-bold text-amber-700 font-display">{stats.draft}</p>
        </Card>
        <Card className="p-4 border-l-4 border-l-indigo-500 space-y-1">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Completed</p>
          <p className="text-2xl font-bold text-indigo-700 font-display">{stats.completed}</p>
        </Card>
        <Card className="p-4 border-l-4 border-l-rose-500 space-y-1">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Pending Grading</p>
          <p className="text-2xl font-bold text-rose-700 font-display">{stats.pendingSubmissions}</p>
        </Card>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-surface-container-low p-2 rounded-xl border border-outline-variant">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400 font-medium px-2">Status:</span>
          {['all', 'published', 'draft', 'completed'].map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors capitalize ${
                filterStatus === status
                  ? 'bg-white text-primary font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-slate-400 font-medium px-2">Discipline:</span>
          {['all', 'DSA', 'OS', 'DBMS', 'System Design'].map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterSubject(cat)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filterSubject === cat
                  ? 'bg-primary text-white font-semibold shadow-xs'
                  : 'bg-white text-slate-700 border border-slate-200/60 hover:bg-slate-50'
              }`}
            >
              {cat === 'all' ? 'All Subjects' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Assessment List */}
      {isLoading ? (
        <div className="p-12 text-center text-xs text-slate-400">Loading assessments...</div>
      ) : filteredAssessments.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <span className="material-symbols-outlined text-4xl text-slate-300">fact_check</span>
          <p className="text-sm font-bold text-slate-800">No assessments found</p>
          <p className="text-xs text-slate-500">
            Click &quot;Create New Assessment&quot; to author weekly rubrics and questions.
          </p>
          <Button size="sm" onClick={openCreateModal}>
            Author Assessment
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredAssessments.map((a) => (
            <Card key={a.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:shadow-md transition-shadow">
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      a.status === 'published'
                        ? 'warning'
                        : a.status === 'completed'
                        ? 'success'
                        : 'neutral'
                    }
                  >
                    {a.status === 'published'
                      ? 'Published • Active'
                      : a.status === 'completed'
                      ? 'Results Published'
                      : 'Draft'}
                  </Badge>
                  <span className="text-xs font-mono font-semibold text-primary">{a.subject}</span>
                  <span className="text-slate-300">•</span>
                  <span className="text-xs text-slate-500">{a.topic}</span>
                </div>

                <h2 className="text-base font-bold text-slate-900">{a.title}</h2>
                <p className="text-xs text-slate-600 line-clamp-1">{a.description}</p>

                <div className="flex flex-wrap gap-3 text-[11px] text-slate-500 pt-1 font-mono">
                  <span>Questions: {a.questionsCount || 0}</span>
                  <span>•</span>
                  <span>Max Marks: {a.totalMarks}</span>
                  <span>•</span>
                  <span>Duration: {a.durationMinutes} mins</span>
                  <span>•</span>
                  <span>Attempts: {a.allowedAttempts}</span>
                  <span>•</span>
                  <span>Due: {new Date(a.endTime).toLocaleDateString()}</span>
                </div>
              </div>

              {/* Assessment Submissions & Actions */}
              <div className="flex flex-wrap items-center gap-5 border-t md:border-t-0 md:border-l border-slate-100 pt-3 md:pt-0 md:pl-6 text-xs shrink-0">
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold">Submissions</p>
                  <p className="font-bold text-slate-900 text-sm mt-0.5">
                    {a.submissionsCount || 0}
                  </p>
                </div>

                {a.averageScore !== undefined && (
                  <div className="text-center">
                    <p className="text-[10px] text-slate-400 uppercase font-semibold">Cohort Mean</p>
                    <p className="font-bold text-indigo-700 text-sm mt-0.5">{a.averageScore}%</p>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEditModal(a)}>
                    Edit & Questions
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => openReviewQueue(a)}>
                    Review Queue ({a.submissionsCount || 0})
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ==================================================================== */}
      {/* 1. CREATE / EDIT ASSESSMENT WIZARD MODAL */}
      {/* ==================================================================== */}
      {isEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-outline-variant max-w-3xl w-full p-6 shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h2 className="font-bold text-base text-slate-900 font-display">
                  {editingAssessment ? 'Edit Assessment & Rubric' : 'Author New Weekly Assessment'}
                </h2>
                <p className="text-xs text-slate-500">
                  Configure assessment parameters, start/end deadlines, and question rubrics.
                </p>
              </div>
              <button onClick={() => setIsEditorOpen(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Assessment Meta Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="sm:col-span-2">
                <label className="font-semibold text-slate-800 block mb-1">Assessment Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Week 8: Advanced Graph Algorithms & Minimum Spanning Trees"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-800 block mb-1">Subject / Discipline *</label>
                <select
                  value={formSubject}
                  onChange={(e) => setFormSubject(e.target.value)}
                  className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary text-xs bg-white"
                >
                  <option value="DSA">Data Structures & Algorithms (DSA)</option>
                  <option value="OS">Operating Systems & Concurrency</option>
                  <option value="DBMS">Database Management Systems (DBMS)</option>
                  <option value="System Design">System Design & Distributed Arch</option>
                  <option value="Networks">Computer Networks & Security</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-800 block mb-1">Weekly Topic Covered *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Bounded Buffer, Semaphores, Deadlocks"
                  value={formTopic}
                  onChange={(e) => setFormTopic(e.target.value)}
                  className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary text-xs"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="font-semibold text-slate-800 block mb-1">Instructions / Description</label>
                <textarea
                  rows={2}
                  placeholder="Exam instructions, ABET outcome mapping, or reference material..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-800 block mb-1">Duration (Minutes) *</label>
                <input
                  type="number"
                  min={10}
                  max={240}
                  value={formDuration}
                  onChange={(e) => setFormDuration(Number(e.target.value))}
                  className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-800 block mb-1">Allowed Attempts</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={formAllowedAttempts}
                  onChange={(e) => setFormAllowedAttempts(Number(e.target.value))}
                  className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-800 block mb-1">Start Date & Time *</label>
                <input
                  type="datetime-local"
                  required
                  value={formStartTime}
                  onChange={(e) => setFormStartTime(e.target.value)}
                  className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-800 block mb-1">Submission Deadline *</label>
                <input
                  type="datetime-local"
                  required
                  value={formEndTime}
                  onChange={(e) => setFormEndTime(e.target.value)}
                  className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary text-xs"
                />
              </div>
            </div>

            {/* Questions Section */}
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    Questions ({formQuestions.length}) — Total:{' '}
                    {formQuestions.reduce((acc, q) => acc + q.marks, 0)} Marks
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Add Multiple Choice (MCQ) or Descriptive questions.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setIsPreviewOpen(true)}>
                    Preview Exam
                  </Button>
                  <Button size="sm" onClick={openAddQuestion}>
                    + Add Question
                  </Button>
                </div>
              </div>

              {formQuestions.length === 0 ? (
                <div className="p-6 border border-dashed rounded-xl text-center text-xs text-slate-400 space-y-1">
                  <p>No questions added yet.</p>
                  <p className="text-[11px]">Click &quot;+ Add Question&quot; to author MCQ or Descriptive questions.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {formQuestions.map((q, idx) => (
                    <div
                      key={q.id || idx}
                      className="p-3 rounded-xl border border-slate-200/80 bg-slate-50/50 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="font-mono font-bold text-slate-400 text-xs shrink-0">
                          #{idx + 1}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold shrink-0 ${
                            q.questionType === 'mcq'
                              ? 'bg-sky-100 text-sky-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {q.questionType}
                        </span>
                        <span className="truncate font-medium text-slate-800">{q.questionText}</span>
                        <span className="font-mono text-primary font-semibold shrink-0">
                          ({q.marks}m)
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleMoveQuestion(idx, 'up')}
                          disabled={idx === 0}
                          className="p-1 hover:text-primary disabled:opacity-30"
                          title="Move Up"
                        >
                          <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                        </button>
                        <button
                          onClick={() => handleMoveQuestion(idx, 'down')}
                          disabled={idx === formQuestions.length - 1}
                          className="p-1 hover:text-primary disabled:opacity-30"
                          title="Move Down"
                        >
                          <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                        </button>
                        <button
                          onClick={() => openEditQuestion(idx)}
                          className="p-1 hover:text-primary"
                          title="Edit Question"
                        >
                          <span className="material-symbols-outlined text-[16px]">edit</span>
                        </button>
                        <button
                          onClick={() => handleDeleteQuestion(idx)}
                          className="p-1 hover:text-rose-600 text-slate-400"
                          title="Delete Question"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <Button size="sm" variant="outline" onClick={() => setIsEditorOpen(false)}>
                Cancel
              </Button>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => handleSaveAssessment(false)}
                >
                  Save as Draft
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={isSubmitting || formQuestions.length === 0}
                  onClick={() => handleSaveAssessment(true)}
                >
                  {editingAssessment?.status === 'published' ? 'Save & Update' : 'Publish Assessment'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 2. QUESTION BUILDER MODAL */}
      {/* ==================================================================== */}
      {isQuestionModalOpen && (
        <div className="fixed inset-0 z-[60] z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs" style={{ zIndex: 60 }}>
          <div className="bg-white rounded-2xl border border-outline-variant max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 font-display">
                {editingQuestionIndex !== null ? 'Edit Question' : 'Add Assessment Question'}
              </h3>
              <button onClick={() => setIsQuestionModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-800 block mb-1">Question Type</label>
                  <select
                    value={qType}
                    onChange={(e) => setQType(e.target.value as any)}
                    className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary text-xs bg-white"
                  >
                    <option value="mcq">Multiple Choice Question (MCQ)</option>
                    <option value="descriptive">Descriptive Question (Manual Evaluation)</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-800 block mb-1">Marks Assigned</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={qMarks}
                    onChange={(e) => setQMarks(Number(e.target.value))}
                    className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-800 block mb-1">Question Prompt / Text *</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Enter the problem statement or question prompt..."
                  value={qText}
                  onChange={(e) => setQText(e.target.value)}
                  className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary text-xs"
                />
              </div>

              {/* MCQ Options */}
              {qType === 'mcq' && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-slate-800">
                      Options (Select the single correct answer radio)
                    </label>
                    <button
                      type="button"
                      onClick={() => setQOptions([...qOptions, { optionText: '', isCorrect: false }])}
                      className="text-primary hover:underline text-[11px] font-semibold"
                    >
                      + Add Option
                    </button>
                  </div>

                  <div className="space-y-2">
                    {qOptions.map((opt, optIdx) => (
                      <div key={optIdx} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="correctOption"
                          checked={opt.isCorrect}
                          onChange={() => {
                            const updated = qOptions.map((o, i) => ({
                              ...o,
                              isCorrect: i === optIdx,
                            }));
                            setQOptions(updated);
                          }}
                          className="w-4 h-4 text-primary focus:ring-primary shrink-0"
                          title="Designate as correct option"
                        />
                        <input
                          type="text"
                          required
                          placeholder={`Option ${optIdx + 1}`}
                          value={opt.optionText}
                          onChange={(e) => {
                            const updated = [...qOptions];
                            updated[optIdx].optionText = e.target.value;
                            setQOptions(updated);
                          }}
                          className={`flex-1 px-3 py-1.5 border rounded-lg text-xs outline-none ${
                            opt.isCorrect ? 'border-emerald-500 bg-emerald-50/30' : 'focus:border-primary'
                          }`}
                        />
                        {qOptions.length > 2 && (
                          <button
                            type="button"
                            onClick={() => setQOptions(qOptions.filter((_, i) => i !== optIdx))}
                            className="text-slate-400 hover:text-rose-600 p-1"
                          >
                            <span className="material-symbols-outlined text-[15px]">close</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="pt-2">
                    <label className="font-semibold text-slate-800 block mb-1">
                      Explanation (Shown to students after result publication)
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Pedagogical rationale explaining why this option is correct..."
                      value={qExplanation}
                      onChange={(e) => setQExplanation(e.target.value)}
                      className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary text-xs"
                    />
                  </div>
                </div>
              )}

              {/* Descriptive Rubric Guidance */}
              {qType === 'descriptive' && (
                <div className="space-y-2 pt-2">
                  <label className="font-semibold text-slate-800 block mb-1">
                    Evaluation Guidance & Rubrics (For Mentors)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Key concepts required for full marks (e.g., must mention time complexity, space trade-off, edge cases)..."
                    value={qGuidance}
                    onChange={(e) => setQGuidance(e.target.value)}
                    className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary text-xs"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <Button size="sm" variant="outline" onClick={() => setIsQuestionModalOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveQuestion}>
                Save Question
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 3. ASSESSMENT PREVIEW MODAL */}
      {/* ==================================================================== */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-[60] z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs" style={{ zIndex: 60 }}>
          <div className="bg-white rounded-2xl border border-outline-variant max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="text-[10px] font-mono text-primary uppercase font-bold tracking-wider">
                  Assessment Student Preview Mode
                </span>
                <h3 className="font-bold text-base text-slate-900 mt-0.5">{formTitle || 'Untitled Assessment'}</h3>
              </div>
              <button onClick={() => setIsPreviewOpen(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="flex gap-3 text-xs text-slate-500 font-mono border-b pb-2">
              <span>Discipline: {formSubject}</span>
              <span>•</span>
              <span>Topic: {formTopic}</span>
              <span>•</span>
              <span>Duration: {formDuration} mins</span>
              <span>•</span>
              <span>Total Marks: {formQuestions.reduce((acc, q) => acc + q.marks, 0)}</span>
            </div>

            <div className="space-y-4 text-xs">
              {formQuestions.map((q, idx) => (
                <div key={idx} className="p-4 rounded-xl border border-slate-200 space-y-2.5">
                  <div className="flex justify-between font-semibold">
                    <span className="text-slate-900">
                      Q{idx + 1}. {q.questionText}
                    </span>
                    <span className="font-mono text-primary">[{q.marks} Marks]</span>
                  </div>

                  {q.questionType === 'mcq' && q.options && (
                    <div className="space-y-1.5 pl-2">
                      {q.options.map((opt, optIdx) => (
                        <div
                          key={optIdx}
                          className={`p-2 rounded-lg border text-xs flex items-center gap-2 ${
                            opt.isCorrect
                              ? 'border-emerald-500 bg-emerald-50/40 text-emerald-950 font-medium'
                              : 'border-slate-200 text-slate-700'
                          }`}
                        >
                          <span className="font-mono font-bold text-[11px]">
                            {String.fromCharCode(65 + optIdx)}.
                          </span>
                          <span>{opt.optionText}</span>
                          {opt.isCorrect && (
                            <span className="ml-auto text-[10px] font-bold text-emerald-700 uppercase">
                              Correct Key
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {q.questionType === 'descriptive' && (
                    <div className="p-3 bg-slate-50 border rounded-lg text-slate-500 italic">
                      [Descriptive Student Answer Textarea — Monitored Word Count]
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-3 border-t">
              <Button size="sm" onClick={() => setIsPreviewOpen(false)}>
                Close Preview
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 4. SUBMISSIONS & REVIEW QUEUE MODAL */}
      {/* ==================================================================== */}
      {reviewAssessment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-outline-variant max-w-4xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="text-[10px] font-mono text-primary uppercase font-bold tracking-wider">
                  Cohort Review & Evaluation Queue
                </span>
                <h2 className="font-bold text-base text-slate-900 mt-0.5">{reviewAssessment.title}</h2>
              </div>
              <button onClick={() => setReviewAssessment(null)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border text-xs">
              <div className="flex gap-4 font-mono">
                <span>Total Submissions: {submissions.length}</span>
                <span>•</span>
                <span>Evaluated: {submissions.filter((s) => s.isEvaluated).length}</span>
                <span>•</span>
                <span>
                  Results Status:{' '}
                  {reviewAssessment.isResultsPublished ? (
                    <span className="text-emerald-700 font-bold">Published</span>
                  ) : (
                    <span className="text-amber-700 font-bold">Unpublished</span>
                  )}
                </span>
              </div>

              {!reviewAssessment.isResultsPublished && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => handlePublishResults(reviewAssessment.id)}
                  leftIcon={<span className="material-symbols-outlined text-sm">publish</span>}
                >
                  Publish Results to Students
                </Button>
              )}
            </div>

            {/* Submissions Table */}
            {isLoadingSubmissions ? (
              <div className="p-8 text-center text-xs text-slate-400">Loading submissions...</div>
            ) : submissions.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No students have submitted this assessment yet.
              </div>
            ) : (
              <div className="overflow-x-auto border rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b text-slate-600 font-semibold uppercase text-[10px]">
                      <th className="py-2.5 px-3">Student</th>
                      <th className="py-2.5 px-3">Roll No</th>
                      <th className="py-2.5 px-3">Submitted At</th>
                      <th className="py-2.5 px-3">MCQ Score</th>
                      <th className="py-2.5 px-3">Descriptive</th>
                      <th className="py-2.5 px-3">Total Score</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {submissions.map((sub) => (
                      <tr key={sub.attemptId} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{sub.studentName}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">{sub.rollNumber}</td>
                        <td className="py-2.5 px-3 text-slate-500">
                          {new Date(sub.submittedAt).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-700">{sub.mcqScore}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-700">{sub.descriptiveScore}</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-indigo-700">
                          {sub.totalScore} / {sub.maxMarks}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              sub.isEvaluated
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {sub.isEvaluated ? 'Evaluated' : 'Pending Grading'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <Button size="sm" variant="outline" onClick={() => openGradingModal(sub.attemptId)}>
                            Grade / Review
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button size="sm" variant="outline" onClick={() => setReviewAssessment(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 5. MANUAL GRADING DRAWER / MODAL */}
      {/* ==================================================================== */}
      {gradingAttemptId && gradingData && (
        <div className="fixed inset-0 z-[60] z-60 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs" style={{ zIndex: 60 }}>
          <div className="bg-white rounded-2xl border border-outline-variant max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="text-[10px] font-mono text-primary uppercase font-bold tracking-wider">
                  Manual Rubric Evaluation & Calibration
                </span>
                <h3 className="font-bold text-base text-slate-900 mt-0.5">
                  Grading Submission: {gradingData.attempt.id.slice(0, 8)}
                </h3>
              </div>
              <button onClick={() => setGradingAttemptId(null)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {gradingData.questions.map((q: any, idx: number) => {
                const answer = gradingData.answers.find((ans: any) => ans.questionId === q.id);

                return (
                  <div key={q.id} className="p-4 rounded-xl border border-slate-200 space-y-2.5">
                    <div className="flex justify-between items-start">
                      <div className="space-y-0.5 flex-1 pr-2">
                        <span className="font-bold text-slate-900">
                          Q{idx + 1} ({q.questionType.toUpperCase()}): {q.questionText}
                        </span>
                      </div>
                      <span className="font-mono text-slate-500 font-bold shrink-0">Max: {q.marks}m</span>
                    </div>

                    {/* MCQ Display */}
                    {q.questionType === 'mcq' && (
                      <div className="bg-slate-50 p-2.5 rounded-lg space-y-1">
                        <p className="font-semibold text-slate-700">Student Choice:</p>
                        <p className="font-mono text-slate-600">
                          {q.options.find((o: any) => o.id === answer?.selectedOptionId)?.optionText ||
                            'No option selected'}
                        </p>
                        <p className="text-[11px] text-emerald-700 font-semibold pt-1">
                          Auto-Evaluated Marks: {answer?.marksObtained || 0} / {q.marks}
                        </p>
                      </div>
                    )}

                    {/* Descriptive Display & Input */}
                    {q.questionType === 'descriptive' && (
                      <div className="space-y-2">
                        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200/80">
                          <p className="font-semibold text-slate-700 mb-1">Student Answer:</p>
                          <p className="text-slate-800 whitespace-pre-wrap leading-relaxed">
                            {answer?.descriptiveAnswer || 'No answer submitted.'}
                          </p>
                        </div>

                        {q.evaluationGuidance && (
                          <div className="bg-amber-50/70 border border-amber-200/60 p-2.5 rounded-lg text-amber-900 text-[11px]">
                            <span className="font-bold block">Evaluation Rubric Guidance:</span>
                            {q.evaluationGuidance}
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 items-center">
                          <div>
                            <label className="font-semibold text-slate-700 block mb-1">
                              Award Marks (Max: {q.marks})
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={q.marks}
                              step={0.5}
                              value={gradingScores[q.id] ?? answer?.marksObtained ?? 0}
                              onChange={(e) =>
                                setGradingScores({
                                  ...gradingScores,
                                  [q.id]: Math.min(q.marks, Math.max(0, Number(e.target.value))),
                                })
                              }
                              className="w-full px-3 py-1.5 border rounded-lg font-mono text-xs font-bold"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="font-semibold text-slate-700 block mb-1">Question Feedback</label>
                            <input
                              type="text"
                              placeholder="Comments on student's reasoning..."
                              value={gradingFeedbacks[q.id] ?? answer?.mentorFeedback ?? ''}
                              onChange={(e) =>
                                setGradingFeedbacks({
                                  ...gradingFeedbacks,
                                  [q.id]: e.target.value,
                                })
                              }
                              className="w-full px-3 py-1.5 border rounded-lg text-xs"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <div>
                <label className="font-semibold text-slate-800 block mb-1">General Mentor Feedback</label>
                <textarea
                  rows={2}
                  placeholder="Comprehensive feedback on overall student performance..."
                  value={generalFeedback}
                  onChange={(e) => setGeneralFeedback(e.target.value)}
                  className="w-full px-3 py-2 border rounded-xl outline-none focus:border-primary text-xs"
                />
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t">
              <Button size="sm" variant="outline" onClick={() => setGradingAttemptId(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" disabled={isSavingEvaluation} onClick={handleSaveGrading}>
                {isSavingEvaluation ? 'Saving...' : 'Save & Calibrate Evaluation'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

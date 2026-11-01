import React, { useState, useEffect, useRef } from 'react';
import { apiClient } from '../../services/apiClient';
import { StudentAssessmentItem } from '../../types/assessment';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

export const StudentAssessments: React.FC = () => {
  const [assessments, setAssessments] = useState<StudentAssessmentItem[]>([]);
  const [activeTab, setActiveTab] = useState<
    'all' | 'available' | 'in_progress' | 'submitted' | 'evaluated' | 'upcoming'
  >('all');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Active Exam Interface State
  const [activeExam, setActiveExam] = useState<{
    attempt: any;
    assessment: any;
    questions: any[];
    answers: any[];
    remainingSeconds: number;
  } | null>(null);

  const [currentQuestionIdx, setCurrentQuestionIdx] = useState<number>(0);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [descriptiveAnswers, setDescriptiveAnswers] = useState<Record<string, string>>({});
  const [isSavingAnswer, setIsSavingAnswer] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState<boolean>(false);
  const [isSubmittingExam, setIsSubmittingExam] = useState<boolean>(false);
  const [submissionCompleted, setSubmissionCompleted] = useState<any | null>(null);

  // Auto-save statuses and debounce trackers per question
  const [saveStatuses, setSaveStatuses] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({});
  const debounceTimers = useRef<Record<string, any>>({});

  // Pre-Exam Briefing Dialog
  const [briefingAssessment, setBriefingAssessment] = useState<StudentAssessmentItem | null>(null);

  // Post-Graded Review State
  const [reviewData, setReviewData] = useState<any | null>(null);
  const [isLoadingReview, setIsLoadingReview] = useState<boolean>(false);

  const loadData = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await apiClient.getStudentAssessments();
      if (res.data) {
        const loaded = res.data.assessments || [];
        setAssessments(loaded);

        // Check if student was in an active exam before page refresh
        const activeAssessmentId = sessionStorage.getItem('active_assessment_id');
        if (activeAssessmentId && !activeExam) {
          const matching = loaded.find((a: any) => a.id === activeAssessmentId);
          if (matching && (matching.status === 'in_progress' || matching.status === 'available')) {
            startExam(matching);
          }
        }
      } else if (res.error) {
        setErrorMessage(res.error);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load your assessments.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Countdown timer for active examination
  useEffect(() => {
    if (!activeExam || activeExam.remainingSeconds <= 0) return;

    const interval = setInterval(() => {
      setActiveExam((prev) => {
        if (!prev) return null;
        if (prev.remainingSeconds <= 1) {
          clearInterval(interval);
          handleAutoSubmit(prev.attempt.id);
          return { ...prev, remainingSeconds: 0 };
        }
        return { ...prev, remainingSeconds: prev.remainingSeconds - 1 };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [activeExam?.attempt?.id]);

  const handleAutoSubmit = async (attemptId: string) => {
    try {
      const res = await apiClient.submitAssessmentAttempt(attemptId);
      if (res.data) {
        setSubmissionCompleted(res.data.attempt);
        sessionStorage.removeItem('active_assessment_id');
        setActiveExam(null);
        loadData();
      }
    } catch (err: any) {
      alert('Time expired. Attempt was automatically submitted.');
      sessionStorage.removeItem('active_assessment_id');
      setActiveExam(null);
      loadData();
    }
  };

  const startExam = async (assessmentItem: StudentAssessmentItem) => {
    setBriefingAssessment(null);
    setIsLoading(true);
    try {
      const res = await apiClient.startAssessmentAttempt(assessmentItem.id);
      if (res.data) {
        const exam = res.data;
        setActiveExam(exam);
        setCurrentQuestionIdx(0);
        sessionStorage.setItem('active_assessment_id', assessmentItem.id);

        // Pre-populate saved answers
        const optMap: Record<string, string> = {};
        const descMap: Record<string, string> = {};
        const statusMap: Record<string, 'idle' | 'saving' | 'saved' | 'error'> = {};

        (exam.answers || []).forEach((ans: any) => {
          if (ans.selectedOptionId) {
            optMap[ans.questionId] = ans.selectedOptionId;
            statusMap[ans.questionId] = 'saved';
          }
          if (ans.descriptiveAnswer) {
            descMap[ans.questionId] = ans.descriptiveAnswer;
            statusMap[ans.questionId] = 'saved';
          }
        });

        setSelectedOptions(optMap);
        setDescriptiveAnswers(descMap);
        setSaveStatuses(statusMap);
      } else if (res.error) {
        alert(res.error);
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to start assessment.');
    } finally {
      setIsLoading(false);
    }
  };

  // Immediate save for MCQ selections
  const handleSelectOption = async (qId: string, optId: string) => {
    if (!activeExam) return;
    setSelectedOptions((prev) => ({ ...prev, [qId]: optId }));
    setSaveStatuses((prev) => ({ ...prev, [qId]: 'saving' }));
    setIsSavingAnswer(true);

    try {
      await apiClient.saveAssessmentAnswer(activeExam.attempt.id, {
        questionId: qId,
        selectedOptionId: optId,
        descriptiveAnswer: descriptiveAnswers[qId] || undefined,
      });
      setSaveStatuses((prev) => ({ ...prev, [qId]: 'saved' }));
      setSaveSuccessMsg('Option saved');
      setTimeout(() => setSaveSuccessMsg(null), 2000);
    } catch (err: any) {
      console.error('Failed to save MCQ answer:', err);
      setSaveStatuses((prev) => ({ ...prev, [qId]: 'error' }));
    } finally {
      setIsSavingAnswer(false);
    }
  };

  // Debounced auto-save for descriptive answers
  const handleDescriptiveChange = (qId: string, text: string) => {
    if (!activeExam) return;
    setDescriptiveAnswers((prev) => ({ ...prev, [qId]: text }));
    setSaveStatuses((prev) => ({ ...prev, [qId]: 'saving' }));

    if (debounceTimers.current[qId]) {
      clearTimeout(debounceTimers.current[qId]);
    }

    debounceTimers.current[qId] = setTimeout(async () => {
      try {
        await apiClient.saveAssessmentAnswer(activeExam.attempt.id, {
          questionId: qId,
          selectedOptionId: selectedOptions[qId] || undefined,
          descriptiveAnswer: text,
        });
        setSaveStatuses((prev) => ({ ...prev, [qId]: 'saved' }));
      } catch (err) {
        console.error('Failed to auto-save descriptive answer:', err);
        setSaveStatuses((prev) => ({ ...prev, [qId]: 'error' }));
      }
    }, 600);
  };

  // Flush save on blur or navigation
  const flushCurrentAnswerSave = async (qId: string) => {
    if (!activeExam) return;
    if (debounceTimers.current[qId]) {
      clearTimeout(debounceTimers.current[qId]);
    }
    setSaveStatuses((prev) => ({ ...prev, [qId]: 'saving' }));
    setIsSavingAnswer(true);

    try {
      await apiClient.saveAssessmentAnswer(activeExam.attempt.id, {
        questionId: qId,
        selectedOptionId: selectedOptions[qId] || undefined,
        descriptiveAnswer: descriptiveAnswers[qId] || undefined,
      });
      setSaveStatuses((prev) => ({ ...prev, [qId]: 'saved' }));
      setSaveSuccessMsg('Answer saved');
      setTimeout(() => setSaveSuccessMsg(null), 2000);
    } catch (err: any) {
      console.error('Failed to save answer:', err);
      setSaveStatuses((prev) => ({ ...prev, [qId]: 'error' }));
    } finally {
      setIsSavingAnswer(false);
    }
  };

  const handleSubmitFinalExam = async () => {
    if (!activeExam) return;
    setIsSubmittingExam(true);
    try {
      // Save current question answer before submitting
      const currentQ = activeExam.questions[currentQuestionIdx];
      if (currentQ) {
        await flushCurrentAnswerSave(currentQ.id);
      }

      const res = await apiClient.submitAssessmentAttempt(activeExam.attempt.id);
      if (res.data) {
        setSubmissionCompleted(res.data.attempt);
        sessionStorage.removeItem('active_assessment_id');
        setShowSubmitConfirm(false);
        setActiveExam(null);
        await loadData();
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to submit examination.');
    } finally {
      setIsSubmittingExam(false);
    }
  };

  const handleViewReview = async (assessmentItem: StudentAssessmentItem) => {
    if (!assessmentItem.currentAttemptId) return;
    setIsLoadingReview(true);
    setReviewData(null);
    try {
      const res = await apiClient.getAttemptReview(assessmentItem.currentAttemptId);
      if (res.data) {
        setReviewData(res.data);
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to load review.');
    } finally {
      setIsLoadingReview(false);
    }
  };

  // Filter items
  const displayedAssessments = assessments.filter((a) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'available') return a.status === 'available';
    if (activeTab === 'in_progress') return a.status === 'in_progress';
    if (activeTab === 'submitted') return a.status === 'submitted';
    if (activeTab === 'evaluated') return a.status === 'evaluated';
    if (activeTab === 'upcoming') return a.status === 'upcoming';
    return true;
  });

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const hrs = Math.floor(mins / 60);
    const displayMins = mins % 60;
    if (hrs > 0) {
      return `${hrs}:${displayMins < 10 ? '0' : ''}${displayMins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${displayMins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-2xl">school</span>
            <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
              My Technical Assessments
            </h1>
          </div>
          <p className="text-xs text-on-surface-variant mt-1">
            Weekly continuous evaluation tests, proctored MCQs, and faculty-graded engineering rubrics.
          </p>
        </div>

        {/* Filter Navigation */}
        <div className="flex flex-wrap bg-surface-container p-1 rounded-xl text-xs font-semibold gap-1">
          {[
            { key: 'all', label: `All (${assessments.length})` },
            {
              key: 'available',
              label: `Available (${assessments.filter((a) => a.status === 'available').length})`,
            },
            {
              key: 'in_progress',
              label: `In Progress (${assessments.filter((a) => a.status === 'in_progress').length})`,
            },
            {
              key: 'submitted',
              label: `Submitted (${assessments.filter((a) => a.status === 'submitted').length})`,
            },
            {
              key: 'evaluated',
              label: `Graded History (${assessments.filter((a) => a.status === 'evaluated').length})`,
            },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                activeTab === tab.key ? 'bg-white text-primary shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
          <span>{errorMessage}</span>
          <Button size="sm" variant="outline" onClick={loadData}>
            Retry
          </Button>
        </div>
      )}

      {isLoadingReview && (
        <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-800 text-xs flex items-center gap-2">
          <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span>Retrieving graded rubrics and evaluation results...</span>
        </div>
      )}

      {/* Main List */}
      {isLoading ? (
        <div className="p-12 text-center text-xs text-slate-400">Loading assessments...</div>
      ) : displayedAssessments.length === 0 ? (
        <Card className="p-12 text-center space-y-2">
          <span className="material-symbols-outlined text-4xl text-slate-300">task_alt</span>
          <p className="text-sm font-semibold text-slate-700">No assessments found</p>
          <p className="text-xs text-slate-400">
            {activeTab === 'all'
              ? 'You have no assigned weekly assessments currently.'
              : `No assessments in '${activeTab}' state.`}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {displayedAssessments.map((a) => (
            <Card
              key={a.id}
              className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:shadow-md transition-shadow"
            >
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      a.status === 'available'
                        ? 'warning'
                        : a.status === 'in_progress'
                        ? 'neutral'
                        : a.status === 'evaluated'
                        ? 'success'
                        : 'neutral'
                    }
                  >
                    {a.status === 'available'
                      ? 'Available • Take Exam'
                      : a.status === 'in_progress'
                      ? 'In Progress'
                      : a.status === 'submitted'
                      ? 'Submitted • Under Review'
                      : a.status === 'evaluated'
                      ? 'Graded & Published'
                      : a.status === 'upcoming'
                      ? 'Scheduled'
                      : 'Deadline Passed'}
                  </Badge>
                  <span className="text-xs font-mono font-semibold text-primary">{a.subject}</span>
                  <span className="text-slate-300">•</span>
                  <span className="text-xs text-slate-500">{a.topic}</span>
                </div>

                <h2 className="text-base font-bold text-slate-900">{a.title}</h2>
                <p className="text-xs text-slate-600 line-clamp-1">{a.description}</p>

                <div className="flex flex-wrap gap-2 text-xs text-slate-500 font-mono pt-1">
                  <span>Mentor: {a.mentorName}</span>
                  <span>•</span>
                  <span>Duration: {a.durationMinutes} mins</span>
                  <span>•</span>
                  <span>Total Marks: {a.totalMarks}</span>
                  <span>•</span>
                  <span>Deadline: {new Date(a.endTime).toLocaleString()}</span>
                </div>
              </div>

              {/* Action Side */}
              <div className="flex items-center gap-4 border-t md:border-t-0 md:border-l border-slate-100 pt-3 md:pt-0 md:pl-6 text-xs shrink-0">
                {a.score !== undefined ? (
                  <div className="text-center">
                    <p className="text-[10px] text-slate-400 uppercase font-semibold">Your Score</p>
                    <p className="font-bold text-emerald-700 text-base mt-0.5 font-display">
                      {a.score} / {a.totalMarks}
                    </p>
                  </div>
                ) : null}

                {a.status === 'available' || a.status === 'in_progress' ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      if (a.status === 'in_progress') {
                        startExam(a);
                      } else {
                        setBriefingAssessment(a);
                      }
                    }}
                    leftIcon={
                      <span className="material-symbols-outlined text-sm">
                        {a.status === 'in_progress' ? 'play_arrow' : 'timer'}
                      </span>
                    }
                  >
                    {a.status === 'in_progress' ? 'Resume Examination' : 'Start Assessment'}
                  </Button>
                ) : a.status === 'evaluated' ? (
                  <Button size="sm" variant="outline" onClick={() => handleViewReview(a)}>
                    View Graded Rubrics & Key
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled>
                    {a.status === 'submitted' ? 'Evaluation Pending' : 'Exam Closed'}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ==================================================================== */}
      {/* 1. PRE-EXAM INSTRUCTION BRIEFING DIALOG */}
      {/* ==================================================================== */}
      {briefingAssessment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-outline-variant max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">verified_user</span>
                <h3 className="font-bold text-base text-slate-900 font-display">Proctored Examination Mode</h3>
              </div>
              <button onClick={() => setBriefingAssessment(null)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <p className="font-bold text-sm text-slate-900">{briefingAssessment.title}</p>
                <p className="text-slate-500 mt-0.5">{briefingAssessment.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-xl border text-[11px] font-mono">
                <div>
                  <span className="text-slate-400 block uppercase">Duration</span>
                  <span className="font-bold text-slate-800">{briefingAssessment.durationMinutes} Minutes</span>
                </div>
                <div>
                  <span className="text-slate-400 block uppercase">Max Marks</span>
                  <span className="font-bold text-slate-800">{briefingAssessment.totalMarks} Marks</span>
                </div>
                <div>
                  <span className="text-slate-400 block uppercase">Passing Score</span>
                  <span className="font-bold text-slate-800">{briefingAssessment.passingMarks} Marks</span>
                </div>
                <div>
                  <span className="text-slate-400 block uppercase">Attempts Allowed</span>
                  <span className="font-bold text-slate-800">
                    {briefingAssessment.attemptsUsed + 1} of {briefingAssessment.allowedAttempts}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-[11px] space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm">lock_clock</span>
                  Important Examination Instructions:
                </p>
                <ul className="list-disc pl-4 space-y-0.5 leading-relaxed">
                  <li>Once you begin, the timer starts immediately and cannot be paused.</li>
                  <li>Your answers are saved securely. Do not close your browser tab until submitted.</li>
                  <li>When time expires, your answers are submitted automatically.</li>
                  <li>No tab-switching or external code assistance during ABET proctored modules.</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t">
              <Button size="sm" variant="outline" onClick={() => setBriefingAssessment(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={() => startExam(briefingAssessment)}>
                I Agree & Begin Examination
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 2. PROCTORED TEST-TAKING INTERFACE MODAL */}
      {/* ==================================================================== */}
      {activeExam && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-900 text-white overflow-hidden">
          {/* Top Proctored Header Bar */}
          <header className="bg-slate-950/90 border-b border-slate-800 px-6 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center font-bold text-white text-xs">
                MB
              </div>
              <div>
                <h2 className="text-sm font-bold text-white tracking-tight">{activeExam.assessment.title}</h2>
                <p className="text-[10px] text-slate-400 font-mono">
                  {activeExam.assessment.subject} • Question {currentQuestionIdx + 1} of{' '}
                  {activeExam.questions.length}
                </p>
              </div>
            </div>

            {/* Countdown Clock */}
            <div className="flex items-center gap-4">
              {saveSuccessMsg && (
                <span className="text-[11px] text-emerald-400 font-mono flex items-center gap-1 animate-pulse">
                  <span className="material-symbols-outlined text-sm">check_circle</span>
                  {saveSuccessMsg}
                </span>
              )}
              <div
                className={`px-3 py-1.5 rounded-xl border flex items-center gap-2 font-mono text-sm font-bold ${
                  activeExam.remainingSeconds < 300
                    ? 'bg-rose-950/60 border-rose-600 text-rose-300 animate-pulse'
                    : 'bg-slate-800/80 border-slate-700 text-emerald-400'
                }`}
              >
                <span className="material-symbols-outlined text-base">timer</span>
                {formatTimer(activeExam.remainingSeconds)}
              </div>

              <Button
                size="sm"
                variant="primary"
                onClick={() => setShowSubmitConfirm(true)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                Finish & Submit Exam
              </Button>
            </div>
          </header>

          {/* Body: Left Question Panel & Right Navigator */}
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-slate-900">
            {/* Center: Current Question */}
            <div className="flex-1 p-6 md:p-8 overflow-y-auto space-y-6 max-w-4xl mx-auto w-full">
              {activeExam.questions.length > 0 && (
                (() => {
                  const q = activeExam.questions[currentQuestionIdx];
                  if (!q) return null;

                  return (
                    <div className="space-y-6">
                      <div className="flex justify-between items-start pb-3 border-b border-slate-800">
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                            {q.questionType === 'mcq' ? 'Multiple Choice' : 'Descriptive'}
                          </span>
                          <span className="text-xs text-slate-400 font-mono">Question #{currentQuestionIdx + 1}</span>

                          {/* Auto-Save Cloud Status Indicator */}
                          {saveStatuses[q.id] === 'saving' && (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full font-mono">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                              Saving to cloud...
                            </span>
                          )}
                          {saveStatuses[q.id] === 'saved' && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full font-mono">
                              <span className="material-symbols-outlined text-[13px]">cloud_done</span>
                              Saved
                            </span>
                          )}
                          {saveStatuses[q.id] === 'error' && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-rose-400 bg-rose-400/10 px-2 py-0.5 rounded-full font-mono">
                              <span className="material-symbols-outlined text-[13px]">error</span>
                              Save failed •{' '}
                              <button
                                type="button"
                                onClick={() => flushCurrentAnswerSave(q.id)}
                                className="underline font-bold hover:text-white"
                              >
                                Retry
                              </button>
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-primary font-bold text-xs bg-primary/10 px-2.5 py-1 rounded-full">
                          {q.marks} Marks
                        </span>
                      </div>

                      {/* Question Text */}
                      <p className="text-base text-slate-100 font-medium leading-relaxed">{q.questionText}</p>

                      {/* MCQ Choice Interface */}
                      {q.questionType === 'mcq' && q.options && (
                        <div className="space-y-3 pt-2">
                          {q.options.map((opt: any, optIdx: number) => {
                            const isSelected = selectedOptions[q.id] === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => handleSelectOption(q.id, opt.id)}
                                className={`w-full text-left p-4 rounded-xl border transition-all flex items-center gap-3 text-xs ${
                                  isSelected
                                    ? 'bg-primary/20 border-primary text-white shadow-md'
                                    : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800 text-slate-300'
                                }`}
                              >
                                <div
                                  className={`w-6 h-6 rounded-full border flex items-center justify-center font-mono font-bold text-[11px] shrink-0 ${
                                    isSelected
                                      ? 'border-primary bg-primary text-white'
                                      : 'border-slate-600 text-slate-400'
                                  }`}
                                >
                                  {String.fromCharCode(65 + optIdx)}
                                </div>
                                <span className="flex-1 font-medium">{opt.optionText}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Descriptive Answer Interface */}
                      {q.questionType === 'descriptive' && (
                        <div className="space-y-2 pt-2">
                          <label className="text-xs font-semibold text-slate-300 block">
                            Your Technical Solution & Explanations:
                          </label>
                          <textarea
                            rows={8}
                            value={descriptiveAnswers[q.id] || ''}
                            onChange={(e) => handleDescriptiveChange(q.id, e.target.value)}
                            onBlur={() => flushCurrentAnswerSave(q.id)}
                            placeholder="Type your structured solution, algorithm explanation, code snippet or derivations here..."
                            className="w-full p-4 rounded-xl border border-slate-700 bg-slate-800/70 text-slate-100 text-xs font-mono focus:outline-none focus:border-primary resize-y leading-relaxed"
                          />
                          <div className="flex justify-between items-center text-[11px] text-slate-400">
                            <span>
                              Word count: {(descriptiveAnswers[q.id] || '').trim().split(/\s+/).filter(Boolean).length}
                            </span>
                            <button
                              type="button"
                              onClick={() => flushCurrentAnswerSave(q.id)}
                              disabled={isSavingAnswer}
                              className="text-primary hover:underline font-semibold"
                            >
                              {isSavingAnswer ? 'Saving...' : 'Save Draft Answer'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Question Navigation Controls */}
                      <div className="flex items-center justify-between pt-6 border-t border-slate-800">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={currentQuestionIdx === 0}
                          onClick={() => {
                            flushCurrentAnswerSave(q.id);
                            setCurrentQuestionIdx(currentQuestionIdx - 1);
                          }}
                          className="border-slate-700 text-slate-300 hover:bg-slate-800"
                        >
                          ← Previous Question
                        </Button>

                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => flushCurrentAnswerSave(q.id)}
                            className="border-slate-700 text-slate-300 hover:bg-slate-800"
                          >
                            Save Answer
                          </Button>
                          {currentQuestionIdx < activeExam.questions.length - 1 ? (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => {
                                flushCurrentAnswerSave(q.id);
                                setCurrentQuestionIdx(currentQuestionIdx + 1);
                              }}
                            >
                              Next Question →
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => {
                                flushCurrentAnswerSave(q.id);
                                setShowSubmitConfirm(true);
                              }}
                              className="bg-emerald-600 hover:bg-emerald-500"
                            >
                              Review & Submit
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()
              )}
            </div>

            {/* Right Question Palette Navigator */}
            <aside className="w-full md:w-64 bg-slate-950/70 border-t md:border-t-0 md:border-l border-slate-800 p-5 space-y-4 shrink-0">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">
                Question Palette
              </h3>

              <div className="grid grid-cols-5 gap-2">
                {activeExam.questions.map((q, idx) => {
                  const isCurrent = idx === currentQuestionIdx;
                  const isAnswered =
                    q.questionType === 'mcq'
                      ? Boolean(selectedOptions[q.id])
                      : Boolean((descriptiveAnswers[q.id] || '').trim().length > 0);

                  return (
                    <button
                      key={q.id}
                      onClick={() => {
                        const currentQ = activeExam.questions[currentQuestionIdx];
                        if (currentQ) flushCurrentAnswerSave(currentQ.id);
                        setCurrentQuestionIdx(idx);
                      }}
                      className={`h-9 rounded-lg font-mono text-xs font-bold transition-all flex items-center justify-center ${
                        isCurrent
                          ? 'ring-2 ring-primary ring-offset-2 ring-offset-slate-900 bg-primary text-white'
                          : isAnswered
                          ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>

              <div className="text-[11px] text-slate-400 space-y-1.5 pt-3 border-t border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded bg-emerald-600/40 border border-emerald-500/50 inline-block" />
                  <span>Answered ({Object.keys(selectedOptions).length + Object.values(descriptiveAnswers).filter((v) => v.trim()).length})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded bg-slate-800 border border-slate-700 inline-block" />
                  <span>Unanswered</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded bg-primary inline-block" />
                  <span>Active Question</span>
                </div>
              </div>
            </aside>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 3. SUBMIT CONFIRMATION MODAL */}
      {/* ==================================================================== */}
      {showSubmitConfirm && activeExam && (
        <div className="fixed inset-0 z-[60] z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs text-slate-900" style={{ zIndex: 60 }}>
          <div className="bg-white rounded-2xl border border-outline-variant max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <span className="material-symbols-outlined text-xl">task_alt</span>
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900 font-display">Confirm Submission</h3>
                <p className="text-xs text-slate-500">You are about to finish your examination.</p>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <p className="text-slate-700">
                Are you ready to submit your answers? Once submitted, your answers will be locked and cannot be edited.
              </p>
              <div className="p-3 bg-slate-50 rounded-xl border text-[11px] font-mono space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Total Questions:</span>
                  <span className="font-bold text-slate-800">{activeExam.questions.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Time Remaining:</span>
                  <span className="font-bold text-emerald-600">{formatTimer(activeExam.remainingSeconds)}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t">
              <Button size="sm" variant="outline" onClick={() => setShowSubmitConfirm(false)}>
                Return to Exam
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={isSubmittingExam}
                onClick={handleSubmitFinalExam}
                className="bg-emerald-600 hover:bg-emerald-500"
              >
                {isSubmittingExam ? 'Submitting...' : 'Yes, Submit Final Exam'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 4. POST-SUBMISSION STATUS SCREEN */}
      {/* ==================================================================== */}
      {submissionCompleted && (
        <div className="fixed inset-0 z-[60] z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs" style={{ zIndex: 60 }}>
          <div className="bg-white rounded-2xl border border-outline-variant max-w-md w-full p-6 shadow-2xl text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
              <span className="material-symbols-outlined text-3xl">check_circle</span>
            </div>
            <div>
              <h3 className="font-bold text-lg text-slate-900 font-display">Assessment Submitted Successfully!</h3>
              <p className="text-xs text-slate-500 mt-1">
                Your examination responses have been securely logged in the institutional database.
              </p>
            </div>
            <p className="text-xs font-mono text-slate-400">
              Submitted at: {new Date(submissionCompleted.submittedAt || Date.now()).toLocaleString()}
            </p>
            <div className="pt-2">
              <Button
                size="sm"
                onClick={() => {
                  setSubmissionCompleted(null);
                  loadData();
                }}
              >
                Return to Assessment Portal
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 5. GRADED RUBRIC & PEDAGOGICAL REVIEW MODAL */}
      {/* ==================================================================== */}
      {reviewData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-outline-variant max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="text-[10px] font-mono text-emerald-700 uppercase font-bold tracking-wider">
                  Graded Assessment Feedback
                </span>
                <h3 className="font-bold text-base text-slate-900 mt-0.5">{reviewData.assessment?.title}</h3>
              </div>
              <button onClick={() => setReviewData(null)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Score Banner */}
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-emerald-950">Official Assessment Score</p>
                <p className="text-xs text-emerald-800">Evaluated and calibrated by your faculty advisor.</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold font-display text-emerald-700">
                  {reviewData.attempt?.totalScore} / {reviewData.assessment?.totalMarks}
                </p>
                <p className="text-[10px] text-emerald-600 font-mono">
                  MCQ: {reviewData.attempt?.mcqScore}m • Descriptive: {reviewData.attempt?.descriptiveScore}m
                </p>
              </div>
            </div>

            {reviewData.attempt?.generalFeedback && (
              <div className="p-3 bg-slate-50 border rounded-xl text-xs space-y-1">
                <span className="font-bold text-slate-800 block">Mentor Feedback:</span>
                <p className="text-slate-700 italic">&quot;{reviewData.attempt.generalFeedback}&quot;</p>
              </div>
            )}

            {/* Questions Breakdown */}
            <div className="space-y-4 text-xs">
              {reviewData.questions?.map((q: any, idx: number) => {
                const ans = reviewData.answers?.find((a: any) => a.questionId === q.id);

                return (
                  <div key={q.id} className="p-4 rounded-xl border border-slate-200 space-y-2">
                    <div className="flex justify-between font-semibold">
                      <span className="text-slate-900">
                        Q{idx + 1}. {q.questionText}
                      </span>
                      <span className="font-mono text-emerald-700 font-bold">
                        {ans?.marksObtained || 0} / {q.marks} Marks
                      </span>
                    </div>

                    {/* MCQ Options with Keys */}
                    {q.questionType === 'mcq' && q.options && (
                      <div className="space-y-1 pl-2">
                        {q.options.map((opt: any, optIdx: number) => {
                          const wasSelected = ans?.selectedOptionId === opt.id;
                          const isCorrect = opt.isCorrect;

                          return (
                            <div
                              key={opt.id}
                              className={`p-2 rounded-lg border text-xs flex items-center justify-between ${
                                isCorrect
                                  ? 'bg-emerald-50 border-emerald-400 text-emerald-950 font-semibold'
                                  : wasSelected
                                  ? 'bg-rose-50 border-rose-300 text-rose-950 font-medium'
                                  : 'border-slate-100 text-slate-600'
                              }`}
                            >
                              <span>
                                {String.fromCharCode(65 + optIdx)}. {opt.optionText}
                              </span>
                              {isCorrect && (
                                <span className="text-[10px] uppercase font-bold text-emerald-700">
                                  Correct Key
                                </span>
                              )}
                              {wasSelected && !isCorrect && (
                                <span className="text-[10px] uppercase font-bold text-rose-600">
                                  Your Choice
                                </span>
                              )}
                            </div>
                          );
                        })}
                        {q.explanation && (
                          <div className="mt-2 p-2.5 bg-sky-50 rounded-lg border border-sky-200 text-sky-900 text-[11px]">
                            <span className="font-bold block">Pedagogical Explanation:</span>
                            {q.explanation}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Descriptive Student Answer and Mentor Feedback */}
                    {q.questionType === 'descriptive' && (
                      <div className="space-y-2">
                        <div className="p-3 bg-slate-50 rounded-lg border text-slate-800 whitespace-pre-wrap font-mono text-[11px]">
                          {ans?.descriptiveAnswer || 'No answer submitted.'}
                        </div>
                        {ans?.mentorFeedback && (
                          <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 text-[11px]">
                            <span className="font-bold block">Mentor Calibration Feedback:</span>
                            {ans.mentorFeedback}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-2 border-t">
              <Button size="sm" onClick={() => setReviewData(null)}>
                Close Review
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

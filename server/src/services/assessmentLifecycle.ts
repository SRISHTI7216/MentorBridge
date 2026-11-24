import { validateQuestion, type QuestionInput } from './assessmentValidation.js';

export type ReadinessIssue = { code: string; message: string; questionOrder?: number };

export function canManageAssessment(assessmentMentorId: string, actorId: string, role: string): boolean {
  return assessmentMentorId === actorId || role === 'admin';
}

export function attemptsBlockingResultReleaseCount(attempts: Array<{ status: string; submittedAt?: string | null; isEvaluated: boolean }>): number {
  return attempts.filter(attempt => attempt.status === 'in_progress'
    || (['submitted', 'evaluated'].includes(attempt.status) && !!attempt.submittedAt && !attempt.isEvaluated)).length;
}

export function validateDraftReadiness(input: {
  assessment: { title: string; subject: string; topic: string; durationMinutes: number; allowedAttempts: number; startTime: string; endTime: string; passingMarks: number; passingPercentage?: number | null };
  questions: Array<QuestionInput & { questionOrder: number }>;
  pendingAiQuestionOrders?: number[];
  moduleError?: string | null;
}): { ready: boolean; totalMarks: number; issues: ReadinessIssue[] } {
  const issues: ReadinessIssue[] = [];
  const { assessment, questions } = input;
  for (const [field, value, label] of [['title', assessment.title, 'Title'], ['subject', assessment.subject, 'Subject'], ['topic', assessment.topic, 'Topic']] as const) {
    if (!value?.trim()) issues.push({ code: `missing_${field}`, message: `${label} is required.` });
  }
  if (!Number.isInteger(assessment.durationMinutes) || assessment.durationMinutes <= 0) issues.push({ code: 'invalid_duration', message: 'Duration must be a positive whole number of minutes.' });
  if (!Number.isInteger(assessment.allowedAttempts) || assessment.allowedAttempts <= 0) issues.push({ code: 'invalid_attempt_limit', message: 'Allowed attempts must be a positive whole number.' });
  const start = Date.parse(assessment.startTime);
  const end = Date.parse(assessment.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) issues.push({ code: 'invalid_availability_window', message: 'A valid end time after the start time is required.' });
  if (input.moduleError) issues.push({ code: 'invalid_module_link', message: input.moduleError });
  if (!questions.length) issues.push({ code: 'missing_questions', message: 'Add at least one active question.' });
  let totalMarks = 0;
  for (const question of questions) {
    totalMarks += Number(question.marks) || 0;
    const invalid = validateQuestion(question);
    if (invalid) issues.push({ code: 'invalid_question', message: invalid, questionOrder: question.questionOrder });
  }
  if (totalMarks <= 0) issues.push({ code: 'invalid_total_marks', message: 'Active questions must have positive total marks.' });
  if (assessment.passingPercentage != null && (!Number.isFinite(Number(assessment.passingPercentage)) || Number(assessment.passingPercentage) < 0 || Number(assessment.passingPercentage) > 100)) {
    issues.push({ code: 'invalid_passing_percentage', message: 'Passing percentage must be between 0 and 100.' });
  } else if ((assessment.passingPercentage == null && (!Number.isFinite(assessment.passingMarks) || assessment.passingMarks < 0 || assessment.passingMarks > totalMarks)) || (assessment.passingPercentage != null && assessment.passingMarks < 0)) {
    issues.push({ code: 'invalid_passing_marks', message: 'Passing marks must be between zero and total marks.' });
  }
  for (const questionOrder of input.pendingAiQuestionOrders || []) issues.push({ code: 'ai_approval_required', message: 'Approve this AI-generated question before publishing.', questionOrder });
  return { ready: issues.length === 0, totalMarks, issues };
}

export function getLifecycleState(input: { status: string; startTime: string; endTime: string; now?: number }): 'draft' | 'scheduled' | 'available' | 'closed' | 'archived' | 'completed' {
  if (input.status === 'draft' || input.status === 'archived' || input.status === 'completed') return input.status;
  const now = input.now ?? Date.now();
  if (now < Date.parse(input.startTime)) return 'scheduled';
  if (now <= Date.parse(input.endTime)) return 'available';
  return 'closed';
}

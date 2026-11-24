type StudentAttempt = {
  id?: string;
  status: string;
  attemptNumber: number;
  submittedAt?: string | null;
  isEvaluated?: boolean;
  totalScore?: number;
};

export function latestStudentSubmittedAttempt<T extends StudentAttempt>(attempts: T[]): T | null {
  return attempts.filter(attempt => ['submitted', 'evaluated'].includes(attempt.status) && !!attempt.submittedAt)
    .sort((a, b) => b.attemptNumber - a.attemptNumber)[0] || null;
}

export function getStudentAssessmentStatus(input: {
  attempts: StudentAttempt[];
  now: number;
  startTime: string;
  endTime: string;
  allowedAttempts: number;
  resultsPublished: boolean;
  assessmentStatus: string;
}): 'available' | 'upcoming' | 'in_progress' | 'submitted' | 'evaluated' | 'missed' | 'unavailable' {
  if (input.attempts.some(attempt => attempt.status === 'in_progress')) return 'in_progress';
  const latestSubmitted = latestStudentSubmittedAttempt(input.attempts);
  if (latestSubmitted) return input.resultsPublished && latestSubmitted.isEvaluated ? 'evaluated' : 'submitted';
  if (input.now < Date.parse(input.startTime)) return input.assessmentStatus === 'published' ? 'upcoming' : 'unavailable';
  if (input.now <= Date.parse(input.endTime) && input.assessmentStatus === 'published') {
    return input.attempts.length < input.allowedAttempts ? 'available' : 'unavailable';
  }
  return input.now > Date.parse(input.endTime) ? 'missed' : 'unavailable';
}

export function studentResultIsVisible<T extends StudentAttempt>(assessment: { isResultsPublished: boolean }, attempt: T) {
  return assessment.isResultsPublished && attempt.isEvaluated === true
    && ['submitted', 'evaluated'].includes(attempt.status) && !!attempt.submittedAt;
}

export async function resumeOrStartAttempt<T extends { status: string }>(
  existingAttempts: T[],
  assessmentStatus: string,
  startNewAttempt: () => Promise<T>,
): Promise<T> {
  const active = [...existingAttempts].reverse().find(attempt => attempt.status === 'in_progress');
  if (active) return active;
  if (assessmentStatus !== 'published') throw new Error('Assessment is not open for testing.');
  return startNewAttempt();
}

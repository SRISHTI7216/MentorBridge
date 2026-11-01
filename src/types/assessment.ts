export type QuestionType = 'mcq' | 'descriptive';
export type AssessmentStatus = 'draft' | 'published' | 'completed' | 'archived';
export type AttemptStatus = 'in_progress' | 'submitted' | 'evaluated' | 'abandoned';

export interface AssessmentOption {
  id?: string;
  questionId?: string;
  optionOrder: number;
  optionText: string;
  isCorrect?: boolean;
}

export interface AssessmentQuestion {
  id?: string;
  assessmentId?: string;
  questionOrder: number;
  questionType: QuestionType;
  questionText: string;
  marks: number;
  evaluationGuidance?: string;
  explanation?: string;
  options?: AssessmentOption[];
}

export interface AssessmentAssignment {
  id?: string;
  assessmentId: string;
  studentId: string;
  cohortId?: string | null;
  assignedAt?: string;
  student?: {
    id: string;
    name: string;
    email: string;
    rollNumber?: string;
  };
}

export interface Assessment {
  id: string;
  mentorId: string;
  academicTermId: string;
  title: string;
  description: string;
  subject: string;
  topic: string;
  durationMinutes: number;
  totalMarks: number;
  passingMarks?: number;
  startTime: string;
  endTime: string;
  allowedAttempts: number;
  status: AssessmentStatus;
  isResultsPublished: boolean;
  resultsPublishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  mentorName?: string;
  academicTermName?: string;
  questionsCount?: number;
  submissionsCount?: number;
  totalAssigned?: number;
  averageScore?: number;
  questions?: AssessmentQuestion[];
  assignments?: AssessmentAssignment[];
}

export interface AssessmentAnswer {
  id?: string;
  attemptId: string;
  questionId: string;
  selectedOptionId?: string | null;
  descriptiveAnswer?: string | null;
  isCorrect?: boolean | null;
  marksObtained?: number;
  mentorFeedback?: string | null;
  evaluatedAt?: string | null;
}

export interface AssessmentAttempt {
  id: string;
  assessmentId: string;
  studentId: string;
  attemptNumber: number;
  startedAt: string;
  submittedAt?: string | null;
  status: AttemptStatus;
  mcqScore: number;
  descriptiveScore: number;
  totalScore: number;
  isEvaluated: boolean;
  evaluatedAt?: string | null;
  evaluatedBy?: string | null;
  generalFeedback?: string | null;
  createdAt: string;
  updatedAt: string;
  assessment?: Assessment;
  student?: {
    id: string;
    name: string;
    email: string;
    rollNumber?: string;
  };
  answers?: AssessmentAnswer[];
}

export interface MentorAssessmentStats {
  totalCreated: number;
  published: number;
  draft: number;
  completed: number;
  pendingSubmissions: number;
}

export interface SubmissionReviewItem {
  attemptId: string;
  assessmentId: string;
  studentId: string;
  studentName: string;
  rollNumber: string;
  studentEmail: string;
  attemptNumber: number;
  startedAt: string;
  submittedAt: string;
  status: AttemptStatus;
  mcqScore: number;
  descriptiveScore: number;
  totalScore: number;
  maxMarks: number;
  isEvaluated: boolean;
  isResultsPublished: boolean;
}

export interface StudentAssessmentItem {
  id: string;
  title: string;
  subject: string;
  topic: string;
  description: string;
  mentorName: string;
  durationMinutes: number;
  totalMarks: number;
  passingMarks: number;
  startTime: string;
  endTime: string;
  status: 'available' | 'upcoming' | 'in_progress' | 'submitted' | 'evaluated' | 'missed';
  currentAttemptId?: string;
  attemptNumber?: number;
  allowedAttempts: number;
  attemptsUsed: number;
  score?: number;
  isResultsPublished?: boolean;
}

export type FeedbackType = 'immediate' | 'weekly';
export type FeedbackStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped_insufficient_data';

export interface AiFeedbackReport {
  id: string;
  studentId: string;
  feedbackType: FeedbackType;
  assessmentId?: string | null;
  attemptId?: string | null;
  academicTermId?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  status: FeedbackStatus;
  summary?: string | null;
  strengths?: string[];
  weaknesses?: string[];
  recommendedActions?: string[];
  provider: string;
  modelName: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  inputSnapshotHash: string;
  errorMessage?: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AttemptAiFeedback {
  id: string;
  status: 'completed';
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendedActions: string[];
  modelName: string;
  createdAt: string;
}

export interface AttemptReviewResponse {
  isResultsPublished: boolean;
  message?: string;
  attempt?: AssessmentAttempt | { id: string; status: AttemptStatus; submittedAt?: string | null };
  assessment?: Assessment;
  questions?: AssessmentQuestion[];
  answers?: AssessmentAnswer[];
  aiFeedback?: AttemptAiFeedback | null;
}



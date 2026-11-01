export interface PerformanceMetricSummary {
  studentId: string;
  hasData: boolean;
  totalAssigned: number;
  completed: number;
  pending: number;
  inProgress: number;
  submitted: number;
  missed: number;
  publishedResults: number;
  totalMarksObtained: number;
  totalMaxMarks: number;
  overallPercentage: number | null;
  averageScore: number | null;
  highestScore: number | null;
  lowestScore: number | null;
  trendDirection: 'improving' | 'declining' | 'stable' | 'insufficient_data';
  performanceDelta: number | null;
  hasConsecutivePoorResults: boolean;
  consecutivePoorDetails?: { previousPercentage: number; latestPercentage: number } | null;
}

export interface StudentCounts {
  totalAssigned: number;
  completed: number;
  pending: number;
  inProgress: number;
  submitted: number;
  missed: number;
  publishedResults: number;
}

export interface AssessmentHistoryItem {
  attemptId: string;
  assessmentId: string;
  title: string;
  subject: string;
  topic: string;
  attemptNumber: number;
  status: string;
  isEvaluated: boolean;
  isResultsPublished: boolean;
  startedAt: string;
  submittedAt: string | null;
  evaluatedAt: string | null;
  resultsPublishedAt: string | null;
  mcqScore: number;
  descriptiveScore: number;
  totalScore: number;
  maxMarks: number;
  percentage: number;
  passingMarks: number;
  passed: boolean;
  mentorFeedback: string | null;
}

export interface TopicAnalyticsItem {
  subject: string;
  topic: string;
  totalQuestions: number;
  questionsAttempted: number;
  mcqQuestionsCount: number;
  mcqAttemptedCount: number;
  mcqCorrectCount: number;
  mcqAccuracy: number | null;
  descriptiveQuestionsCount: number;
  descriptiveMarksObtained: number;
  descriptiveMaxMarks: number;
  descriptivePercentage: number | null;
  totalMarksObtained: number;
  totalMaxMarks: number;
  overallTopicPercentage: number;
  status: 'strong' | 'developing' | 'needs_improvement' | 'insufficient_data';
  confidenceLevel: 'high' | 'medium' | 'low';
}

export interface TrendDataPoint {
  date: string;
  assessmentId: string;
  title: string;
  subject: string;
  topic: string;
  attemptNumber: number;
  score: number;
  maxMarks: number;
  percentage: number;
}

export interface AtRiskStudentItem {
  studentId: string;
  name: string;
  email: string;
  rollNumber: string;
  overallPercentage: number | null;
  missedCount: number;
  trendDelta: number | null;
  riskReasons: string[];
}

export interface MentorOverviewMetrics {
  mentorId: string;
  activeMenteesCount: number;
  completionRate: number;
  cohortAveragePercentage: number | null;
  distribution: {
    below50: number;
    between50And59: number;
    between60And69: number;
    between70And79: number;
    between80And89: number;
    above90: number;
  };
  improvingCount: number;
  decliningCount: number;
  stableCount: number;
  atRiskCount: number;
}

export interface AdminTopicAnalyticsItem {
  subject: string;
  topic: string;
  assessmentCount: number;
  totalQuestions: number;
  totalSubmissionsEvaluated: number;
  mcqQuestionsCount: number;
  mcqAttemptedCount: number;
  mcqCorrectCount: number;
  mcqAccuracy: number | null;
  descriptiveQuestionsCount: number;
  descriptiveMarksObtained: number;
  descriptiveMaxMarks: number;
  descriptivePercentage: number | null;
  totalMarksObtained: number;
  totalMaxMarks: number;
  overallTopicPercentage: number;
  status: 'strong' | 'developing' | 'needs_improvement' | 'insufficient_data';
  confidenceLevel: 'high' | 'medium' | 'low';
}

export interface MenteePerformanceListItem {
  studentId: string;
  name: string;
  email: string;
  rollNumber: string;
  cohortName: string;
  semester: number;
  summary: PerformanceMetricSummary;
}



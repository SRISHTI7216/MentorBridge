import { UserRole } from '../lib/constants';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl: string;
  department: string;
  rollOrEmpId: string;
  cohort?: string;
  specialization?: string;
}

export interface MenteeStudent {
  id: string;
  rollNo: string;
  name: string;
  cohort: string;
  semester: number;
  overallScore: number;
  dsaProficiency: number;
  systemDesignScore: number;
  attendanceRate: number;
  lastReviewDate: string;
  status: 'excelling' | 'on_track' | 'needs_attention';
  flaggedTopic?: string;
  avatarUrl: string;
}

export interface AssessmentItem {
  id: string;
  title: string;
  course: string;
  category: 'DSA' | 'DBMS' | 'OS' | 'System Design' | 'Networks';
  totalQuestions: number;
  durationMinutes: number;
  dueDate: string;
  status: 'active' | 'upcoming' | 'completed' | 'draft';
  submissionsCount?: number;
  totalAssigned?: number;
  averageScore?: number;
  studentScore?: number;
  rubricCriteria?: string[];
}

export interface LearningModuleItem {
  id: string;
  code: string;
  title: string;
  level: 'Fundamental' | 'Intermediate' | 'Advanced';
  weekNumber: number;
  totalLessons: number;
  completedLessons: number;
  estimatedHours: number;
  skills: string[];
  status: 'in_progress' | 'completed' | 'locked';
}

export interface CertificateItem {
  id: string;
  certificateNo: string;
  title: string;
  issuedTo: string;
  rollNo: string;
  issueDate: string;
  verifiableHash: string;
  accreditedBy: string;
  grade: 'Distinction' | 'Merit' | 'Pass';
  status: 'verified' | 'pending';
}

export interface CodingChallengeItem {
  id: string;
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  category: string;
  acceptanceRate: number;
  solvedCount: number;
  points: number;
  tags: string[];
  status?: 'solved' | 'attempted' | 'unsolved';
}

export interface LeaderboardEntry {
  rank: number;
  studentName: string;
  rollNo: string;
  cohort: string;
  points: number;
  assessmentsCompleted: number;
  codingScore: number;
  percentile: number;
  badge: 'Platinum' | 'Gold' | 'Silver' | 'Bronze';
}


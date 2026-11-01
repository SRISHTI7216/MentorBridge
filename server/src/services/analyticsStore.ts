import crypto from 'crypto';
import { supabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin.js';

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

export class AnalyticsStore {
  private getDb() {
    if (!isSupabaseAdminConfigured() || !supabaseAdmin) {
      throw new Error('Supabase database connection is not configured on the server.');
    }
    return supabaseAdmin;
  }

  /**
   * Helper: Resolves all published & assigned assessments and their attempts for a student
   */
  private async getStudentAssessmentUniverse(studentId: string) {
    const db = this.getDb();

    // 1. Fetch explicitly assigned assessment IDs
    const { data: assignments, error: assgnErr } = await db
      .from('assessment_assignments')
      .select('assessment_id')
      .eq('student_id', studentId);

    if (assgnErr) throw new Error(`Database error fetching assignments: ${assgnErr.message}`);
    const assignedIds = new Set<string>((assignments || []).map((a) => a.assessment_id));

    // 2. Also check if student's active mentor authored assessments
    const { data: mentorAssgn } = await db
      .from('mentor_assignments')
      .select('mentor_id')
      .eq('student_id', studentId)
      .eq('is_active', true);

    const mentorIds = (mentorAssgn || []).map((m) => m.mentor_id);

    // 3. Fetch non-draft assessments
    const { data: allAssessments, error: aErr } = await db
      .from('assessments')
      .select('*')
      .in('status', ['published', 'completed'])
      .order('start_time', { ascending: true });

    if (aErr) throw new Error(`Database error fetching assessments: ${aErr.message}`);

    const relevantAssessments = (allAssessments || []).filter((a) => {
      return assignedIds.has(a.id) || mentorIds.includes(a.mentor_id);
    });

    // 4. Fetch all attempts by this student
    const { data: allAttempts, error: attErr } = await db
      .from('assessment_attempts')
      .select('*')
      .eq('student_id', studentId)
      .order('attempt_number', { ascending: true });

    if (attErr) throw new Error(`Database error fetching attempts: ${attErr.message}`);

    return {
      assessments: relevantAssessments,
      attempts: allAttempts || [],
    };
  }

  /**
   * 1. Student Overall Performance Summary
   * Uses highest published evaluated attempt per assessment.
   */
  async getStudentSummary(studentId: string): Promise<PerformanceMetricSummary> {
    const { assessments, attempts } = await this.getStudentAssessmentUniverse(studentId);
    const now = new Date();

    let totalAssigned = assessments.length;
    let completed = 0;
    let pending = 0;
    let inProgress = 0;
    let submitted = 0;
    let missed = 0;
    let publishedResults = 0;

    // Map attempts by assessment_id
    const attemptsByAssessment = new Map<string, any[]>();
    for (const att of attempts) {
      const list = attemptsByAssessment.get(att.assessment_id) || [];
      list.push(att);
      attemptsByAssessment.set(att.assessment_id, list);
    }

    const publishedPercentages: number[] = [];
    let totalMarksObtained = 0;
    let totalMaxMarks = 0;

    for (const a of assessments) {
      const atts = attemptsByAssessment.get(a.id) || [];
      const activeAttempt = atts.find((att) => att.status === 'in_progress');
      const submittedAttempts = atts.filter(
        (att) => att.status === 'submitted' || att.status === 'evaluated'
      );

      const startTime = new Date(a.start_time);
      const endTime = new Date(a.end_time);

      if (submittedAttempts.length > 0) {
        completed++;
      }

      // Check current exam state
      if (activeAttempt) {
        inProgress++;
      } else if (submittedAttempts.length > 0) {
        submitted++;
      } else if (now < startTime) {
        // upcoming
      } else if (now >= startTime && now <= endTime) {
        pending++;
      } else if (now > endTime) {
        // Expired without any submitted attempt and no active attempt
        missed++;
      }

      // Performance calculations: ONLY when results are officially published
      if (a.is_results_published) {
        // Filter evaluated attempts
        const evaluatedAttempts = atts.filter((att) => att.is_evaluated || att.status === 'evaluated');

        if (evaluatedAttempts.length > 0 && Number(a.total_marks) > 0) {
          publishedResults++;

          // Rule: Pick the highest published evaluated attempt
          const highestAttempt = evaluatedAttempts.reduce((max, cur) =>
            Number(cur.total_score) > Number(max.total_score) ? cur : max
          );

          const score = Number(highestAttempt.total_score || 0);
          const max = Number(a.total_marks);
          totalMarksObtained += score;
          totalMaxMarks += max;

          const pct = (score / max) * 100;
          publishedPercentages.push(pct);
        }
      }
    }

    const hasData = publishedPercentages.length > 0;
    const overallPercentage =
      totalMaxMarks > 0 ? Math.round((totalMarksObtained / totalMaxMarks) * 10000) / 100 : null;
    const averageScore =
      hasData
        ? Math.round(
            (publishedPercentages.reduce((acc, curr) => acc + curr, 0) /
              publishedPercentages.length) *
              100
          ) / 100
        : null;
    const highestScore = hasData ? Math.round(Math.max(...publishedPercentages) * 100) / 100 : null;
    const lowestScore = hasData ? Math.round(Math.min(...publishedPercentages) * 100) / 100 : null;

    // Trend Direction
    let trendDirection: 'improving' | 'declining' | 'stable' | 'insufficient_data' =
      'insufficient_data';
    let performanceDelta: number | null = null;

    if (publishedPercentages.length >= 2) {
      const half = Math.floor(publishedPercentages.length / 2);
      const firstHalf = publishedPercentages.slice(0, half);
      const secondHalf = publishedPercentages.slice(half);

      const avg1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const avg2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

      performanceDelta = Math.round((avg2 - avg1) * 100) / 100;

      if (performanceDelta > 5.0) {
        trendDirection = 'improving';
      } else if (performanceDelta < -5.0) {
        trendDirection = 'declining';
      } else {
        trendDirection = 'stable';
      }
    }

    // Check two consecutive poor published assessment results (< 60%)
    let hasConsecutivePoorResults = false;
    let consecutivePoorDetails: { previousPercentage: number; latestPercentage: number } | null = null;

    if (publishedPercentages.length >= 2) {
      const p1 = publishedPercentages[publishedPercentages.length - 2];
      const p2 = publishedPercentages[publishedPercentages.length - 1];

      if (p1 < 60.0 && p2 < 60.0) {
        hasConsecutivePoorResults = true;
        consecutivePoorDetails = {
          previousPercentage: Math.round(p1 * 100) / 100,
          latestPercentage: Math.round(p2 * 100) / 100,
        };
      }
    }

    return {
      studentId,
      hasData,
      totalAssigned,
      completed,
      pending,
      inProgress,
      submitted,
      missed,
      publishedResults,
      totalMarksObtained: Math.round(totalMarksObtained * 100) / 100,
      totalMaxMarks: Math.round(totalMaxMarks * 100) / 100,
      overallPercentage,
      averageScore,
      highestScore,
      lowestScore,
      trendDirection,
      performanceDelta,
      hasConsecutivePoorResults,
      consecutivePoorDetails,
    };
  }

  /**
   * 2. Student Assessment History (Paginated, keeping all attempts visible)
   * Note: Only reveals scores/feedback when results are published!
   */
  async getStudentHistory(
    studentId: string,
    options: { page?: number; limit?: number; subject?: string } = {}
  ): Promise<{ items: AssessmentHistoryItem[]; total: number; page: number; limit: number }> {
    const db = this.getDb();
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 20));
    const offset = (page - 1) * limit;

    // Fetch attempts joined with assessments
    let query = db
      .from('assessment_attempts')
      .select(`
        id,
        assessment_id,
        attempt_number,
        status,
        started_at,
        submitted_at,
        evaluated_at,
        is_evaluated,
        mcq_score,
        descriptive_score,
        total_score,
        general_feedback,
        assessment:assessments!assessment_attempts_assessment_id_fkey (
          id,
          title,
          subject,
          topic,
          total_marks,
          passing_marks,
          is_results_published,
          results_published_at
        )
      `, { count: 'exact' })
      .eq('student_id', studentId)
      .neq('status', 'in_progress')
      .order('submitted_at', { ascending: false });

    if (options.subject) {
      // Handled via inner filter if needed
    }

    const { data: rows, count, error } = await query.range(offset, offset + limit - 1);
    if (error) throw new Error(`Database error fetching history: ${error.message}`);

    const items: AssessmentHistoryItem[] = (rows || []).map((row: any) => {
      const a = Array.isArray(row.assessment) ? row.assessment[0] : row.assessment;
      const isPublished = Boolean(a?.is_results_published);
      const totalMarks = Number(a?.total_marks || 0);
      const score = isPublished ? Number(row.total_score || 0) : 0;
      const pct = isPublished && totalMarks > 0 ? Math.round((score / totalMarks) * 10000) / 100 : 0;
      const passing = Number(a?.passing_marks || 0);

      return {
        attemptId: row.id,
        assessmentId: row.assessment_id,
        title: a?.title || 'Assessment',
        subject: a?.subject || 'CSE',
        topic: a?.topic || 'General',
        attemptNumber: Number(row.attempt_number),
        status: row.status,
        isEvaluated: Boolean(row.is_evaluated),
        isResultsPublished: isPublished,
        startedAt: row.started_at,
        submittedAt: row.submitted_at,
        evaluatedAt: row.evaluated_at,
        resultsPublishedAt: a?.results_published_at || null,
        mcqScore: isPublished ? Number(row.mcq_score || 0) : 0,
        descriptiveScore: isPublished ? Number(row.descriptive_score || 0) : 0,
        totalScore: score,
        maxMarks: totalMarks,
        percentage: pct,
        passingMarks: passing,
        passed: isPublished ? score >= passing : false,
        mentorFeedback: isPublished ? row.general_feedback : null,
      };
    });

    return {
      items,
      total: count || 0,
      page,
      limit,
    };
  }

  /**
   * 3. Topic-wise Performance with Strict Confidence Classification
   * - < 3 questions attempted: insufficient_data
   * - >= 75% accuracy: strong
   * - < 60% accuracy: needs_improvement
   * - 60% - 74.99%: developing
   * Separates MCQ objective accuracy from descriptive marks.
   */
  async getStudentTopicAnalytics(studentId: string): Promise<TopicAnalyticsItem[]> {
    const db = this.getDb();

    // 1. Fetch published assessments where the student has an evaluated attempt
    const { data: attempts, error: attErr } = await db
      .from('assessment_attempts')
      .select(`
        id,
        assessment_id,
        total_score,
        assessment:assessments!assessment_attempts_assessment_id_fkey (
          id,
          subject,
          topic,
          total_marks,
          is_results_published
        )
      `)
      .eq('student_id', studentId)
      .eq('is_evaluated', true);

    if (attErr) throw new Error(`Database error fetching evaluated attempts: ${attErr.message}`);

    const publishedAttempts = (attempts || []).filter((att: any) => {
      const a = Array.isArray(att.assessment) ? att.assessment[0] : att.assessment;
      return a && a.is_results_published;
    });

    if (publishedAttempts.length === 0) {
      return [];
    }

    // Deduplicate to highest scoring attempt per assessment
    const highestAttemptsMap = new Map<string, any>();
    for (const att of publishedAttempts) {
      const existing = highestAttemptsMap.get(att.assessment_id);
      if (!existing || Number(att.total_score) > Number(existing.total_score)) {
        highestAttemptsMap.set(att.assessment_id, att);
      }
    }

    const attemptIds = Array.from(highestAttemptsMap.values()).map((a) => a.id);
    const assessmentIds = Array.from(highestAttemptsMap.keys());

    // 2. Fetch all questions for these assessments
    const { data: questions, error: qErr } = await db
      .from('assessment_questions')
      .select('*')
      .in('assessment_id', assessmentIds);

    if (qErr) throw new Error(`Database error fetching questions: ${qErr.message}`);

    // 3. Fetch answers for these attempts
    const { data: answers, error: ansErr } = await db
      .from('assessment_answers')
      .select('*')
      .in('attempt_id', attemptIds);

    if (ansErr) throw new Error(`Database error fetching answers: ${ansErr.message}`);

    const answersMap = new Map<string, any>();
    for (const ans of answers || []) {
      // Key: attempt_id:question_id
      answersMap.set(`${ans.attempt_id}:${ans.question_id}`, ans);
    }

    // Build assessment lookup
    const assessmentMap = new Map<string, any>();
    for (const att of highestAttemptsMap.values()) {
      const a = Array.isArray(att.assessment) ? att.assessment[0] : att.assessment;
      assessmentMap.set(a.id, a);
    }

    // 4. Aggregate by (subject, topic)
    interface TopicAccumulator {
      subject: string;
      topic: string;
      totalQuestions: number;
      questionsAttempted: number;
      mcqQuestionsCount: number;
      mcqAttemptedCount: number;
      mcqCorrectCount: number;
      descriptiveQuestionsCount: number;
      descriptiveMarksObtained: number;
      descriptiveMaxMarks: number;
      totalMarksObtained: number;
      totalMaxMarks: number;
    }

    const topicMap = new Map<string, TopicAccumulator>();

    for (const q of questions || []) {
      const a = assessmentMap.get(q.assessment_id);
      if (!a) continue;

      const key = `${a.subject}:::${a.topic}`;
      let acc = topicMap.get(key);
      if (!acc) {
        acc = {
          subject: a.subject,
          topic: a.topic,
          totalQuestions: 0,
          questionsAttempted: 0,
          mcqQuestionsCount: 0,
          mcqAttemptedCount: 0,
          mcqCorrectCount: 0,
          descriptiveQuestionsCount: 0,
          descriptiveMarksObtained: 0,
          descriptiveMaxMarks: 0,
          totalMarksObtained: 0,
          totalMaxMarks: 0,
        };
        topicMap.set(key, acc);
      }

      acc.totalQuestions++;
      const qMarks = Number(q.marks || 0);
      acc.totalMaxMarks += qMarks;

      const att = highestAttemptsMap.get(q.assessment_id);
      const studentAns = att ? answersMap.get(`${att.id}:${q.id}`) : null;

      if (q.question_type === 'mcq') {
        acc.mcqQuestionsCount++;
        if (studentAns && studentAns.selected_option_id) {
          acc.questionsAttempted++;
          acc.mcqAttemptedCount++;
          if (studentAns.is_correct === true) {
            acc.mcqCorrectCount++;
          }
          const marks = Number(studentAns.marks_obtained || 0);
          acc.totalMarksObtained += marks;
        }
      } else {
        // Descriptive question
        acc.descriptiveQuestionsCount++;
        acc.descriptiveMaxMarks += qMarks;
        if (studentAns && studentAns.descriptive_answer && studentAns.descriptive_answer.trim() !== '') {
          acc.questionsAttempted++;
          const marks = Number(studentAns.marks_obtained || 0);
          acc.descriptiveMarksObtained += marks;
          acc.totalMarksObtained += marks;
        }
      }
    }

    // 5. Compute rates and classify
    const result: TopicAnalyticsItem[] = [];

    for (const acc of topicMap.values()) {
      const mcqAccuracy =
        acc.mcqAttemptedCount > 0
          ? Math.round((acc.mcqCorrectCount / acc.mcqAttemptedCount) * 10000) / 100
          : null;

      const descriptivePercentage =
        acc.descriptiveMaxMarks > 0
          ? Math.round((acc.descriptiveMarksObtained / acc.descriptiveMaxMarks) * 10000) / 100
          : null;

      const overallTopicPercentage =
        acc.totalMaxMarks > 0
          ? Math.round((acc.totalMarksObtained / acc.totalMaxMarks) * 10000) / 100
          : 0;

      // Confidence & Classification rules
      let status: 'strong' | 'developing' | 'needs_improvement' | 'insufficient_data';
      let confidenceLevel: 'high' | 'medium' | 'low';

      if (acc.questionsAttempted < 3) {
        status = 'insufficient_data';
        confidenceLevel = 'low';
      } else if (overallTopicPercentage >= 75.0) {
        status = 'strong';
        confidenceLevel = 'high';
      } else if (overallTopicPercentage < 60.0) {
        status = 'needs_improvement';
        confidenceLevel = 'high';
      } else {
        status = 'developing';
        confidenceLevel = 'medium';
      }

      result.push({
        subject: acc.subject,
        topic: acc.topic,
        totalQuestions: acc.totalQuestions,
        questionsAttempted: acc.questionsAttempted,
        mcqQuestionsCount: acc.mcqQuestionsCount,
        mcqAttemptedCount: acc.mcqAttemptedCount,
        mcqCorrectCount: acc.mcqCorrectCount,
        mcqAccuracy,
        descriptiveQuestionsCount: acc.descriptiveQuestionsCount,
        descriptiveMarksObtained: Math.round(acc.descriptiveMarksObtained * 100) / 100,
        descriptiveMaxMarks: Math.round(acc.descriptiveMaxMarks * 100) / 100,
        descriptivePercentage,
        totalMarksObtained: Math.round(acc.totalMarksObtained * 100) / 100,
        totalMaxMarks: Math.round(acc.totalMaxMarks * 100) / 100,
        overallTopicPercentage,
        status,
        confidenceLevel,
      });
    }

    return result.sort((a, b) => b.overallTopicPercentage - a.overallTopicPercentage);
  }

  /**
   * 4. Student Performance Trends Over Time
   */
  async getStudentTrends(studentId: string): Promise<{ timeline: TrendDataPoint[]; overallTrend: string }> {
    const db = this.getDb();

    const { data: attempts, error } = await db
      .from('assessment_attempts')
      .select(`
        id,
        assessment_id,
        attempt_number,
        submitted_at,
        total_score,
        is_evaluated,
        assessment:assessments!assessment_attempts_assessment_id_fkey (
          id,
          title,
          subject,
          topic,
          total_marks,
          is_results_published,
          results_published_at
        )
      `)
      .eq('student_id', studentId)
      .eq('is_evaluated', true)
      .order('submitted_at', { ascending: true });

    if (error) throw new Error(`Database error fetching trends: ${error.message}`);

    const timeline: TrendDataPoint[] = [];

    for (const att of attempts || []) {
      const a = Array.isArray(att.assessment) ? att.assessment[0] : att.assessment;
      if (!a || !a.is_results_published) continue;

      const totalMarks = Number(a.total_marks || 0);
      const score = Number(att.total_score || 0);
      const pct = totalMarks > 0 ? Math.round((score / totalMarks) * 10000) / 100 : 0;

      timeline.push({
        date: a.results_published_at || att.submitted_at || new Date().toISOString(),
        assessmentId: a.id,
        title: a.title,
        subject: a.subject,
        topic: a.topic,
        attemptNumber: Number(att.attempt_number),
        score,
        maxMarks: totalMarks,
        percentage: pct,
      });
    }

    let overallTrend = 'insufficient_data';
    if (timeline.length >= 2) {
      const half = Math.floor(timeline.length / 2);
      const first = timeline.slice(0, half).reduce((s, p) => s + p.percentage, 0) / half;
      const second = timeline.slice(half).reduce((s, p) => s + p.percentage, 0) / (timeline.length - half);
      const diff = second - first;
      if (diff > 5) overallTrend = 'improving';
      else if (diff < -5) overallTrend = 'declining';
      else overallTrend = 'stable';
    }

    return { timeline, overallTrend };
  }

  /**
   * 5. Student Recent Assessment Activity
   */
  async getStudentRecentActivity(studentId: string, limit: number = 5) {
    const history = await this.getStudentHistory(studentId, { page: 1, limit });
    return history.items;
  }

  // ==========================================================================
  // MENTOR ANALYTICS
  // ==========================================================================

  /**
   * Helper: Validates that a student is actively assigned to the given mentor
   */
  async verifyMentorAssignment(mentorId: string, studentId: string): Promise<boolean> {
    const db = this.getDb();
    const { data } = await db
      .from('mentor_assignments')
      .select('id')
      .eq('mentor_id', mentorId)
      .eq('student_id', studentId)
      .eq('is_active', true)
      .maybeSingle();

    return Boolean(data);
  }

  /**
   * Helper: Fetches list of active mentee profile IDs for a mentor
   */
  async getActiveMenteeIds(mentorId: string): Promise<string[]> {
    const db = this.getDb();
    const { data, error } = await db
      .from('mentor_assignments')
      .select('student_id')
      .eq('mentor_id', mentorId)
      .eq('is_active', true);

    if (error) throw new Error(`Database error querying mentees: ${error.message}`);
    return (data || []).map((m) => m.student_id);
  }

  /**
   * Mentor Dashboard Overview
   */
  async getMentorDashboardOverview(mentorId: string): Promise<MentorOverviewMetrics> {
    const menteeIds = await this.getActiveMenteeIds(mentorId);

    if (menteeIds.length === 0) {
      return {
        mentorId,
        activeMenteesCount: 0,
        completionRate: 0,
        cohortAveragePercentage: null,
        distribution: {
          below50: 0,
          between50And59: 0,
          between60And69: 0,
          between70And79: 0,
          between80And89: 0,
          above90: 0,
        },
        improvingCount: 0,
        decliningCount: 0,
        stableCount: 0,
        atRiskCount: 0,
      };
    }

    // Evaluate summary for each mentee
    const summaries = await Promise.all(
      menteeIds.map((sId) => this.getStudentSummary(sId))
    );

    let totalCompleted = 0;
    let totalAssigned = 0;
    let sumPercentage = 0;
    let withDataCount = 0;

    let improvingCount = 0;
    let decliningCount = 0;
    let stableCount = 0;
    let atRiskCount = 0;

    const distribution = {
      below50: 0,
      between50And59: 0,
      between60And69: 0,
      between70And79: 0,
      between80And89: 0,
      above90: 0,
    };

    for (const s of summaries) {
      totalCompleted += s.completed;
      totalAssigned += s.totalAssigned;

      if (s.overallPercentage !== null) {
        sumPercentage += s.overallPercentage;
        withDataCount++;

        const p = s.overallPercentage;
        if (p < 50) distribution.below50++;
        else if (p < 60) distribution.between50And59++;
        else if (p < 70) distribution.between60And69++;
        else if (p < 80) distribution.between70And79++;
        else if (p < 90) distribution.between80And89++;
        else distribution.above90++;
      }

      if (s.trendDirection === 'improving') improvingCount++;
      else if (s.trendDirection === 'declining') decliningCount++;
      else if (s.trendDirection === 'stable') stableCount++;

      // At risk indicator evaluation
      if (
        (s.overallPercentage !== null && s.overallPercentage < 60) ||
        s.missed >= 2 ||
        (s.performanceDelta !== null && s.performanceDelta < -10) ||
        s.hasConsecutivePoorResults
      ) {
        atRiskCount++;
      }
    }

    const completionRate =
      totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 10000) / 100 : 0;
    const cohortAveragePercentage =
      withDataCount > 0 ? Math.round((sumPercentage / withDataCount) * 100) / 100 : null;

    return {
      mentorId,
      activeMenteesCount: menteeIds.length,
      completionRate,
      cohortAveragePercentage,
      distribution,
      improvingCount,
      decliningCount,
      stableCount,
      atRiskCount,
    };
  }

  /**
   * Mentor Mentees Performance List
   */
  async getMentorMenteesList(mentorId: string) {
    const db = this.getDb();
    const menteeIds = await this.getActiveMenteeIds(mentorId);

    if (menteeIds.length === 0) return [];

    // Fetch mentee profiles & details
    const { data: profiles, error } = await db
      .from('profiles')
      .select(`
        id,
        name,
        email,
        avatar_url,
        student_details (
          roll_number,
          branch,
          semester,
          division,
          cohort:cohorts(name)
        )
      `)
      .in('id', menteeIds);

    if (error) throw new Error(`Database error fetching mentee profiles: ${error.message}`);

    const summaries = await Promise.all(
      menteeIds.map(async (sId) => {
        const summary = await this.getStudentSummary(sId);
        const prof = (profiles || []).find((p) => p.id === sId);
        const details = Array.isArray(prof?.student_details)
          ? prof?.student_details[0]
          : prof?.student_details;
        const cohort = (details as any)?.cohort?.name || 'CSE Cohort';

        return {
          studentId: sId,
          name: prof?.name || 'Student',
          email: prof?.email || '',
          rollNumber: details?.roll_number || 'N/A',
          cohortName: cohort,
          semester: details?.semester || 1,
          summary,
        };
      })
    );

    return summaries;
  }

  /**
   * At-Risk Mentee Indicators
   */
  async getMentorAtRiskMentees(mentorId: string): Promise<AtRiskStudentItem[]> {
    const mentees = await this.getMentorMenteesList(mentorId);
    const atRisk: AtRiskStudentItem[] = [];

    for (const m of mentees) {
      const s = m.summary;
      const reasons: string[] = [];

      if (s.overallPercentage !== null && s.overallPercentage < 60) {
        reasons.push(`Overall published performance (${s.overallPercentage}%) below 60% threshold.`);
      }
      if (s.missed >= 2) {
        reasons.push(`${s.missed} assessment deadlines missed.`);
      }
      if (s.performanceDelta !== null && s.performanceDelta < -10) {
        reasons.push(`Performance declined by ${Math.abs(s.performanceDelta)}% over recent assessments.`);
      }
      if (s.hasConsecutivePoorResults && s.consecutivePoorDetails) {
        reasons.push(
          `Two consecutive poor published assessment results (${s.consecutivePoorDetails.previousPercentage}% and ${s.consecutivePoorDetails.latestPercentage}%).`
        );
      }

      if (reasons.length > 0) {
        atRisk.push({
          studentId: m.studentId,
          name: m.name,
          email: m.email,
          rollNumber: m.rollNumber,
          overallPercentage: s.overallPercentage,
          missedCount: s.missed,
          trendDelta: s.performanceDelta,
          riskReasons: reasons,
        });
      }
    }

    return atRisk;
  }

  // ==========================================================================
  // ADMIN ANALYTICS
  // ==========================================================================

  /**
   * Admin Institution Overview
   */
  async getAdminInstitutionOverview() {
    const db = this.getDb();

    const [
      studentsRes,
      mentorsRes,
      assignmentsRes,
      assessmentsRes,
      attemptsRes,
    ] = await Promise.all([
      db.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student').eq('is_active', true),
      db.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'mentor').eq('is_active', true),
      db.from('mentor_assignments').select('id', { count: 'exact', head: true }).eq('is_active', true),
      db.from('assessments').select('*').in('status', ['published', 'completed']),
      db.from('assessment_attempts').select('total_score, is_evaluated, assessment_id').eq('is_evaluated', true),
    ]);

    const assessments = assessmentsRes.data || [];
    const publishedAssessmentIds = new Set(
      assessments.filter((a) => a.is_results_published).map((a) => a.id)
    );

    const publishedAttempts = (attemptsRes.data || []).filter((att) =>
      publishedAssessmentIds.has(att.assessment_id)
    );

    const totalStudents = studentsRes.count || 0;
    const totalMentors = mentorsRes.count || 0;
    const totalAssignments = assignmentsRes.count || 0;

    let totalMarksSum = 0;
    let totalMaxSum = 0;

    for (const att of publishedAttempts) {
      const a = assessments.find((ass) => ass.id === att.assessment_id);
      if (a && Number(a.total_marks) > 0) {
        totalMarksSum += Number(att.total_score || 0);
        totalMaxSum += Number(a.total_marks);
      }
    }

    const institutionAverage =
      totalMaxSum > 0 ? Math.round((totalMarksSum / totalMaxSum) * 10000) / 100 : null;

    return {
      totalActiveStudents: totalStudents,
      totalFacultyMentors: totalMentors,
      totalActiveAssignments: totalAssignments,
      totalAssessmentsConducted: assessments.length,
      totalEvaluatedSubmissions: publishedAttempts.length,
      institutionAveragePercentage: institutionAverage,
    };
  }

  /**
   * Admin Cohort-Wise Performance
   */
  async getAdminCohortPerformance() {
    const db = this.getDb();

    const { data: cohorts, error: cErr } = await db
      .from('cohorts')
      .select('id, name, code, admission_year, graduation_year')
      .order('admission_year', { ascending: false });

    if (cErr) throw new Error(`Database error fetching cohorts: ${cErr.message}`);

    const result = [];

    for (const cohort of cohorts || []) {
      const { data: students } = await db
        .from('student_details')
        .select('profile_id')
        .eq('cohort_id', cohort.id);

      const sIds = (students || []).map((s) => s.profile_id);

      let cohortAvg: number | null = null;
      let activeStudentsCount = sIds.length;

      if (sIds.length > 0) {
        const summaries = await Promise.all(sIds.map((id) => this.getStudentSummary(id)));
        const withData = summaries.filter((s) => s.overallPercentage !== null);
        if (withData.length > 0) {
          cohortAvg =
            Math.round(
              (withData.reduce((acc, curr) => acc + curr.overallPercentage!, 0) / withData.length) * 100
            ) / 100;
        }
      }

      result.push({
        cohortId: cohort.id,
        name: cohort.name,
        code: cohort.code,
        studentCount: activeStudentsCount,
        cohortAveragePercentage: cohortAvg,
      });
    }

    return result;
  }

  // ==========================================================================
  // AI FEEDBACK SNAPSHOT PREPARATION (Deterministic & Secret-Free)
  // ==========================================================================

  /**
   * Prepares structured deterministic input snapshot for immediate assessment feedback
   */
  async constructImmediateFeedbackSnapshot(
    studentId: string,
    assessmentId: string,
    attemptId: string
  ): Promise<{
    isEligible: boolean;
    reason?: string;
    payload?: any;
    inputSnapshotHash?: string;
  }> {
    const db = this.getDb();

    // 1. Fetch Assessment
    const { data: assessment, error: aErr } = await db
      .from('assessments')
      .select('*')
      .eq('id', assessmentId)
      .maybeSingle();

    if (aErr || !assessment) {
      return { isEligible: false, reason: 'Assessment record not found.' };
    }

    // Must be officially published
    if (!assessment.is_results_published) {
      return {
        isEligible: false,
        reason: 'Results have not been officially published yet. Feedback creation withheld.',
      };
    }

    // 2. Fetch Attempt
    const { data: attempt, error: attErr } = await db
      .from('assessment_attempts')
      .select('*')
      .eq('id', attemptId)
      .eq('student_id', studentId)
      .maybeSingle();

    if (attErr || !attempt) {
      return { isEligible: false, reason: 'Assessment attempt record not found or unauthorized.' };
    }

    if (!attempt.is_evaluated || attempt.status !== 'evaluated') {
      return {
        isEligible: false,
        reason: 'Attempt has not completed mentor evaluation rubric.',
      };
    }

    // 3. Fetch Questions and Options
    const { data: questions } = await db
      .from('assessment_questions')
      .select('*, options:assessment_options(*)')
      .eq('assessment_id', assessmentId)
      .order('question_order', { ascending: true });

    // 4. Fetch Answers
    const { data: answers } = await db
      .from('assessment_answers')
      .select('*')
      .eq('attempt_id', attemptId);

    const answersMap = new Map((answers || []).map((ans) => [ans.question_id, ans]));

    // 5. Build sanitized question breakdown (No PII, zero credentials)
    const questionItems = (questions || []).map((q: any) => {
      const studentAns = answersMap.get(q.id);
      if (q.question_type === 'mcq') {
        const selectedOpt = (q.options || []).find((o: any) => o.id === studentAns?.selected_option_id);
        const correctOpt = (q.options || []).find((o: any) => o.is_correct === true);
        return {
          questionOrder: q.question_order,
          questionType: 'mcq',
          questionText: q.question_text,
          maxMarks: Number(q.marks),
          selectedOptionText: selectedOpt?.option_text || 'Unanswered',
          isCorrect: studentAns?.is_correct === true,
          correctOptionText: correctOpt?.option_text || '',
          explanation: q.explanation || '',
        };
      } else {
        return {
          questionOrder: q.question_order,
          questionType: 'descriptive',
          questionText: q.question_text,
          maxMarks: Number(q.marks),
          studentAnswer: studentAns?.descriptive_answer || 'Unanswered',
          marksObtained: Number(studentAns?.marks_obtained || 0),
          mentorFeedback: studentAns?.mentor_feedback || '',
          evaluationGuidance: q.evaluation_guidance || '',
        };
      }
    });

    const payload = {
      feedbackType: 'immediate',
      studentId,
      assessment: {
        id: assessment.id,
        title: assessment.title,
        subject: assessment.subject,
        topic: assessment.topic,
        totalMarks: Number(assessment.total_marks),
        passingMarks: Number(assessment.passing_marks),
      },
      attempt: {
        id: attempt.id,
        attemptNumber: attempt.attempt_number,
        mcqScore: Number(attempt.mcq_score),
        descriptiveScore: Number(attempt.descriptive_score),
        totalScore: Number(attempt.total_score),
        percentage:
          Number(assessment.total_marks) > 0
            ? Math.round((Number(attempt.total_score) / Number(assessment.total_marks)) * 10000) / 100
            : 0,
        generalFeedback: attempt.general_feedback || null,
      },
      questions: questionItems,
    };

    const inputSnapshotHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');

    return {
      isEligible: true,
      payload,
      inputSnapshotHash,
    };
  }

  /**
   * Prepares structured deterministic input snapshot for weekly progress summary
   */
  async constructWeeklyFeedbackSnapshot(
    studentId: string,
    academicTermId: string,
    periodStart: string,
    periodEnd: string
  ): Promise<{
    isEligible: boolean;
    reason?: string;
    payload?: any;
    inputSnapshotHash?: string;
  }> {
    if (new Date(periodEnd) < new Date(periodStart)) {
      return { isEligible: false, reason: 'Invalid reporting window: periodEnd precedes periodStart.' };
    }

    const db = this.getDb();

    // 1. Fetch published assessments in this window for student
    const { data: attempts, error } = await db
      .from('assessment_attempts')
      .select(`
        id,
        total_score,
        mcq_score,
        descriptive_score,
        general_feedback,
        assessment:assessments!assessment_attempts_assessment_id_fkey (
          id,
          title,
          subject,
          topic,
          total_marks,
          is_results_published,
          results_published_at
        )
      `)
      .eq('student_id', studentId)
      .eq('is_evaluated', true)
      .gte('submitted_at', periodStart)
      .lte('submitted_at', periodEnd);

    if (error) throw new Error(`Database error querying weekly attempts: ${error.message}`);

    const published = (attempts || []).filter((att: any) => {
      const a = Array.isArray(att.assessment) ? att.assessment[0] : att.assessment;
      return a && a.is_results_published;
    });

    if (published.length === 0) {
      return {
        isEligible: false,
        reason: 'Insufficient data: No published assessment results exist within this reporting window.',
      };
    }

    const payload = {
      feedbackType: 'weekly',
      studentId,
      academicTermId,
      periodStart,
      periodEnd,
      assessmentsEvaluatedCount: published.length,
      assessments: published.map((att: any) => {
        const a = Array.isArray(att.assessment) ? att.assessment[0] : att.assessment;
        return {
          title: a.title,
          subject: a.subject,
          topic: a.topic,
          totalMarks: Number(a.total_marks),
          totalScore: Number(att.total_score),
          mentorFeedback: att.general_feedback || null,
        };
      }),
    };

    const inputSnapshotHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');

    return {
      isEligible: true,
      payload,
      inputSnapshotHash,
    };
  }

  /**
   * Admin Institution-Wide Subject & Topic Performance Analytics
   * Aggregates topic mastery across all published assessments and evaluated submissions in the institution.
   */
  async getAdminTopicPerformance(): Promise<AdminTopicAnalyticsItem[]> {
    const db = this.getDb();

    // 1. Fetch all published assessments
    const { data: assessments, error: aErr } = await db
      .from('assessments')
      .select('id, subject, topic, total_marks, is_results_published')
      .eq('is_results_published', true);

    if (aErr) throw new Error(`Database error querying published assessments: ${aErr.message}`);
    if (!assessments || assessments.length === 0) return [];

    const assessmentIds = assessments.map((a) => a.id);
    const assessmentMap = new Map(assessments.map((a) => [a.id, a]));

    // 2. Fetch all questions for these assessments
    const { data: questions, error: qErr } = await db
      .from('assessment_questions')
      .select('*')
      .in('assessment_id', assessmentIds);

    if (qErr) throw new Error(`Database error querying questions: ${qErr.message}`);

    // 3. Fetch all evaluated attempts for these assessments
    const { data: attempts, error: attErr } = await db
      .from('assessment_attempts')
      .select('id, assessment_id, student_id, total_score')
      .in('assessment_id', assessmentIds)
      .eq('is_evaluated', true);

    if (attErr) throw new Error(`Database error querying evaluated attempts: ${attErr.message}`);
    if (!attempts || attempts.length === 0) return [];

    const attemptIds = attempts.map((a) => a.id);

    // 4. Fetch answers for these attempts
    const { data: answers, error: ansErr } = await db
      .from('assessment_answers')
      .select('attempt_id, question_id, selected_option_id, descriptive_answer, is_correct, marks_obtained')
      .in('attempt_id', attemptIds);

    if (ansErr) throw new Error(`Database error querying answers: ${ansErr.message}`);

    const answersMap = new Map<string, any>();
    for (const ans of answers || []) {
      answersMap.set(`${ans.attempt_id}:${ans.question_id}`, ans);
    }

    interface AdminTopicAccumulator {
      subject: string;
      topic: string;
      assessmentIds: Set<string>;
      questionIds: Set<string>;
      submissionsEvaluated: number;
      mcqQuestionsCount: number;
      mcqAttemptedCount: number;
      mcqCorrectCount: number;
      descriptiveQuestionsCount: number;
      descriptiveMarksObtained: number;
      descriptiveMaxMarks: number;
      totalMarksObtained: number;
      totalMaxMarks: number;
    }

    const topicMap = new Map<string, AdminTopicAccumulator>();

    for (const q of questions || []) {
      const a = assessmentMap.get(q.assessment_id);
      if (!a) continue;

      const key = `${a.subject}:::${a.topic}`;
      let acc = topicMap.get(key);
      if (!acc) {
        acc = {
          subject: a.subject,
          topic: a.topic,
          assessmentIds: new Set<string>(),
          questionIds: new Set<string>(),
          submissionsEvaluated: 0,
          mcqQuestionsCount: 0,
          mcqAttemptedCount: 0,
          mcqCorrectCount: 0,
          descriptiveQuestionsCount: 0,
          descriptiveMarksObtained: 0,
          descriptiveMaxMarks: 0,
          totalMarksObtained: 0,
          totalMaxMarks: 0,
        };
        topicMap.set(key, acc);
      }
      acc.assessmentIds.add(a.id);
      acc.questionIds.add(q.id);
      if (q.question_type === 'mcq') {
        acc.mcqQuestionsCount++;
      } else {
        acc.descriptiveQuestionsCount++;
      }
    }

    for (const att of attempts) {
      const a = assessmentMap.get(att.assessment_id);
      if (!a) continue;

      const key = `${a.subject}:::${a.topic}`;
      const acc = topicMap.get(key);
      if (!acc) continue;

      acc.submissionsEvaluated++;

      const assessmentQuestions = (questions || []).filter((q) => q.assessment_id === a.id);
      for (const q of assessmentQuestions) {
        const qMarks = Number(q.marks || 0);
        acc.totalMaxMarks += qMarks;

        const ans = answersMap.get(`${att.id}:${q.id}`);
        if (!ans) continue;

        if (q.question_type === 'mcq') {
          if (ans.selected_option_id) {
            acc.mcqAttemptedCount++;
            if (ans.is_correct === true) {
              acc.mcqCorrectCount++;
            }
            acc.totalMarksObtained += Number(ans.marks_obtained || 0);
          }
        } else {
          acc.descriptiveMaxMarks += qMarks;
          if (ans.descriptive_answer && ans.descriptive_answer.trim() !== '') {
            const marks = Number(ans.marks_obtained || 0);
            acc.descriptiveMarksObtained += marks;
            acc.totalMarksObtained += marks;
          }
        }
      }
    }

    const items: AdminTopicAnalyticsItem[] = [];

    for (const acc of topicMap.values()) {
      const mcqAccuracy =
        acc.mcqAttemptedCount > 0
          ? Math.round((acc.mcqCorrectCount / acc.mcqAttemptedCount) * 10000) / 100
          : null;

      const descriptivePercentage =
        acc.descriptiveMaxMarks > 0
          ? Math.round((acc.descriptiveMarksObtained / acc.descriptiveMaxMarks) * 10000) / 100
          : null;

      const overallTopicPercentage =
        acc.totalMaxMarks > 0
          ? Math.round((acc.totalMarksObtained / acc.totalMaxMarks) * 10000) / 100
          : 0;

      let status: 'strong' | 'developing' | 'needs_improvement' | 'insufficient_data';
      let confidenceLevel: 'high' | 'medium' | 'low';

      if (acc.mcqAttemptedCount + (acc.descriptiveMarksObtained > 0 ? 1 : 0) < 3) {
        status = 'insufficient_data';
        confidenceLevel = 'low';
      } else if (overallTopicPercentage >= 75.0) {
        status = 'strong';
        confidenceLevel = 'high';
      } else if (overallTopicPercentage < 60.0) {
        status = 'needs_improvement';
        confidenceLevel = 'high';
      } else {
        status = 'developing';
        confidenceLevel = 'medium';
      }

      items.push({
        subject: acc.subject,
        topic: acc.topic,
        assessmentCount: acc.assessmentIds.size,
        totalQuestions: acc.questionIds.size,
        totalSubmissionsEvaluated: acc.submissionsEvaluated,
        mcqQuestionsCount: acc.mcqQuestionsCount,
        mcqAttemptedCount: acc.mcqAttemptedCount,
        mcqCorrectCount: acc.mcqCorrectCount,
        mcqAccuracy,
        descriptiveQuestionsCount: acc.descriptiveQuestionsCount,
        descriptiveMarksObtained: Math.round(acc.descriptiveMarksObtained * 100) / 100,
        descriptiveMaxMarks: Math.round(acc.descriptiveMaxMarks * 100) / 100,
        descriptivePercentage,
        totalMarksObtained: Math.round(acc.totalMarksObtained * 100) / 100,
        totalMaxMarks: Math.round(acc.totalMaxMarks * 100) / 100,
        overallTopicPercentage,
        status,
        confidenceLevel,
      });
    }

    return items.sort((a, b) => b.overallTopicPercentage - a.overallTopicPercentage);
  }

  /**
   * Mentor Cohort Topic Analytics
   * Aggregates topic performance across all actively assigned mentees of the mentor
   */
  async getMentorCohortTopicAnalytics(mentorId: string): Promise<TopicAnalyticsItem[]> {
    const menteeIds = await this.getActiveMenteeIds(mentorId);
    if (menteeIds.length === 0) return [];

    const allMenteeTopics = await Promise.all(
      menteeIds.map((sId) => this.getStudentTopicAnalytics(sId))
    );

    const mergedMap = new Map<string, {
      subject: string;
      topic: string;
      totalQuestions: number;
      questionsAttempted: number;
      mcqQuestionsCount: number;
      mcqAttemptedCount: number;
      mcqCorrectCount: number;
      descriptiveQuestionsCount: number;
      descriptiveMarksObtained: number;
      descriptiveMaxMarks: number;
      totalMarksObtained: number;
      totalMaxMarks: number;
    }>();

    for (const menteeTopics of allMenteeTopics) {
      for (const t of menteeTopics) {
        const key = `${t.subject}:::${t.topic}`;
        let acc = mergedMap.get(key);
        if (!acc) {
          acc = {
            subject: t.subject,
            topic: t.topic,
            totalQuestions: 0,
            questionsAttempted: 0,
            mcqQuestionsCount: 0,
            mcqAttemptedCount: 0,
            mcqCorrectCount: 0,
            descriptiveQuestionsCount: 0,
            descriptiveMarksObtained: 0,
            descriptiveMaxMarks: 0,
            totalMarksObtained: 0,
            totalMaxMarks: 0,
          };
          mergedMap.set(key, acc);
        }
        acc.totalQuestions += t.totalQuestions;
        acc.questionsAttempted += t.questionsAttempted;
        acc.mcqQuestionsCount += t.mcqQuestionsCount;
        acc.mcqAttemptedCount += t.mcqAttemptedCount;
        acc.mcqCorrectCount += t.mcqCorrectCount;
        acc.descriptiveQuestionsCount += t.descriptiveQuestionsCount;
        acc.descriptiveMarksObtained += t.descriptiveMarksObtained;
        acc.descriptiveMaxMarks += t.descriptiveMaxMarks;
        acc.totalMarksObtained += t.totalMarksObtained;
        acc.totalMaxMarks += t.totalMaxMarks;
      }
    }

    const items: TopicAnalyticsItem[] = [];
    for (const acc of mergedMap.values()) {
      const mcqAccuracy =
        acc.mcqAttemptedCount > 0
          ? Math.round((acc.mcqCorrectCount / acc.mcqAttemptedCount) * 10000) / 100
          : null;
      const descriptivePercentage =
        acc.descriptiveMaxMarks > 0
          ? Math.round((acc.descriptiveMarksObtained / acc.descriptiveMaxMarks) * 10000) / 100
          : null;
      const overallTopicPercentage =
        acc.totalMaxMarks > 0
          ? Math.round((acc.totalMarksObtained / acc.totalMaxMarks) * 10000) / 100
          : 0;

      let status: 'strong' | 'developing' | 'needs_improvement' | 'insufficient_data';
      let confidenceLevel: 'high' | 'medium' | 'low';

      if (acc.questionsAttempted < 3) {
        status = 'insufficient_data';
        confidenceLevel = 'low';
      } else if (overallTopicPercentage >= 75.0) {
        status = 'strong';
        confidenceLevel = 'high';
      } else if (overallTopicPercentage < 60.0) {
        status = 'needs_improvement';
        confidenceLevel = 'high';
      } else {
        status = 'developing';
        confidenceLevel = 'medium';
      }

      items.push({
        subject: acc.subject,
        topic: acc.topic,
        totalQuestions: acc.totalQuestions,
        questionsAttempted: acc.questionsAttempted,
        mcqQuestionsCount: acc.mcqQuestionsCount,
        mcqAttemptedCount: acc.mcqAttemptedCount,
        mcqCorrectCount: acc.mcqCorrectCount,
        mcqAccuracy,
        descriptiveQuestionsCount: acc.descriptiveQuestionsCount,
        descriptiveMarksObtained: Math.round(acc.descriptiveMarksObtained * 100) / 100,
        descriptiveMaxMarks: Math.round(acc.descriptiveMaxMarks * 100) / 100,
        descriptivePercentage,
        totalMarksObtained: Math.round(acc.totalMarksObtained * 100) / 100,
        totalMaxMarks: Math.round(acc.totalMaxMarks * 100) / 100,
        overallTopicPercentage,
        status,
        confidenceLevel,
      });
    }

    return items.sort((a, b) => b.overallTopicPercentage - a.overallTopicPercentage);
  }
}

export const analyticsStore = new AnalyticsStore();


import { Router, Response } from 'express';
import {
  AuthenticatedRequest,
  requireAuth,
  requireStudent,
  requireMentorOrAdmin,
  requireAdminAuth,
} from '../middleware/auth.js';
import { analyticsStore } from '../services/analyticsStore.js';

const router = Router();

// ============================================================================
// 1. STUDENT ANALYTICS APIS (Authenticated Student Only)
// ============================================================================

/**
 * GET /api/analytics/student/summary
 * Returns overall student performance metrics, published scores, and trend
 */
router.get(
  '/student/summary',
  requireStudent,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const studentId = req.user!.id;
      const summary = await analyticsStore.getStudentSummary(studentId);
      res.json({ summary });
    } catch (err: any) {
      console.error('[StudentAnalyticsSummary] Error:', err);
      res.status(500).json({ error: 'Failed to retrieve student performance summary.' });
    }
  }
);

/**
 * GET /api/analytics/student/history
 * Returns paginated assessment attempt history
 */
router.get(
  '/student/history',
  requireStudent,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const studentId = req.user!.id;
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 20));
      const subject = typeof req.query.subject === 'string' ? req.query.subject : undefined;

      const history = await analyticsStore.getStudentHistory(studentId, { page, limit, subject });
      res.json(history);
    } catch (err: any) {
      console.error('[StudentAnalyticsHistory] Error:', err);
      res.status(500).json({ error: 'Failed to retrieve assessment history.' });
    }
  }
);

/**
 * GET /api/analytics/student/topics
 * Returns subject and topic-wise mastery analytics with confidence thresholds
 */
router.get(
  '/student/topics',
  requireStudent,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const studentId = req.user!.id;
      const topics = await analyticsStore.getStudentTopicAnalytics(studentId);
      res.json({ topics });
    } catch (err: any) {
      console.error('[StudentTopicAnalytics] Error:', err);
      res.status(500).json({ error: 'Failed to retrieve topic-wise analytics.' });
    }
  }
);

/**
 * GET /api/analytics/student/trends
 * Returns score trajectory over time
 */
router.get(
  '/student/trends',
  requireStudent,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const studentId = req.user!.id;
      const trends = await analyticsStore.getStudentTrends(studentId);
      res.json(trends);
    } catch (err: any) {
      console.error('[StudentAnalyticsTrends] Error:', err);
      res.status(500).json({ error: 'Failed to retrieve performance trends.' });
    }
  }
);

/**
 * GET /api/analytics/student/recent
 * Returns recent assessment activity for dashboard widgets
 */
router.get(
  '/student/recent',
  requireStudent,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const studentId = req.user!.id;
      const limit = Math.max(1, Math.min(20, parseInt(req.query.limit as string, 10) || 5));
      const recent = await analyticsStore.getStudentRecentActivity(studentId, limit);
      res.json({ recent });
    } catch (err: any) {
      console.error('[StudentRecentActivity] Error:', err);
      res.status(500).json({ error: 'Failed to retrieve recent activity.' });
    }
  }
);

/**
 * GET /api/analytics/student/counts
 * Returns available published-result counts, pending assessment counts, and status breakdowns
 */
router.get(
  '/student/counts',
  requireStudent,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const studentId = req.user!.id;
      const summary = await analyticsStore.getStudentSummary(studentId);
      res.json({
        counts: {
          totalAssigned: summary.totalAssigned,
          completed: summary.completed,
          pending: summary.pending,
          inProgress: summary.inProgress,
          submitted: summary.submitted,
          missed: summary.missed,
          publishedResults: summary.publishedResults,
        },
      });
    } catch (err: any) {
      console.error('[StudentCounts] Error:', err);
      res.status(500).json({ error: 'Failed to retrieve assessment counts.' });
    }
  }
);

// ============================================================================
// 2. MENTOR ANALYTICS APIS (Authenticated Mentor Only, Scoped to Assigned Mentees)
// ============================================================================

/**
 * GET /api/analytics/mentor/overview
 * Returns aggregate metrics across all active mentees assigned to authenticated mentor
 */
router.get(
  '/mentor/overview',
  requireMentorOrAdmin,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const mentorId = req.user!.id;
      const overview = await analyticsStore.getMentorDashboardOverview(mentorId);
      res.json({ overview });
    } catch (err: any) {
      console.error('[MentorDashboardOverview] Error:', err);
      res.status(500).json({ error: 'Failed to retrieve mentor dashboard overview.' });
    }
  }
);

/**
 * GET /api/analytics/mentor/mentees
 * Returns performance summaries for all active mentees
 */
router.get(
  '/mentor/mentees',
  requireMentorOrAdmin,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const mentorId = req.user!.id;
      const mentees = await analyticsStore.getMentorMenteesList(mentorId);
      res.json({ mentees });
    } catch (err: any) {
      console.error('[MentorMenteesList] Error:', err);
      res.status(500).json({ error: 'Failed to retrieve assigned mentees.' });
    }
  }
);

/**
 * GET /api/analytics/mentor/at-risk
 * Returns list of mentees exhibiting at-risk academic indicators
 */
router.get(
  '/mentor/at-risk',
  requireMentorOrAdmin,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const mentorId = req.user!.id;
      const atRiskStudents = await analyticsStore.getMentorAtRiskMentees(mentorId);
      res.json({ atRiskStudents });
    } catch (err: any) {
      console.error('[MentorAtRisk] Error:', err);
      res.status(500).json({ error: 'Failed to retrieve at-risk mentees.' });
    }
  }
);

/**
 * GET /api/analytics/mentor/topics
 * Returns cohort topic-wise performance across all assigned active mentees
 */
router.get(
  '/mentor/topics',
  requireMentorOrAdmin,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const mentorId = req.user!.id;
      const topics = await analyticsStore.getMentorCohortTopicAnalytics(mentorId);
      res.json({ topics });
    } catch (err: any) {
      console.error('[MentorCohortTopics] Error:', err);
      res.status(500).json({ error: 'Failed to retrieve mentor cohort topic analytics.' });
    }
  }
);

/**
 * GET /api/analytics/mentor/mentees/:studentId
 * Returns individual mentee summary (strictly validates active assignment)
 */
router.get(
  '/mentor/mentees/:studentId',
  requireMentorOrAdmin,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const mentorId = req.user!.id;
      const { studentId } = req.params;

      // Admin bypass or verify active mentor-student assignment
      if (req.user!.role !== 'admin') {
        const isAssigned = await analyticsStore.verifyMentorAssignment(mentorId, studentId);
        if (!isAssigned) {
          res.status(403).json({
            error: 'Forbidden: You are not authorized to view analytics for this student.',
          });
          return;
        }
      }

      const summary = await analyticsStore.getStudentSummary(studentId);
      res.json({ summary });
    } catch (err: any) {
      console.error('[IndividualMenteeSummary] Error:', err);
      res.status(500).json({ error: 'Failed to retrieve mentee analytics.' });
    }
  }
);

/**
 * GET /api/analytics/mentor/mentees/:studentId/topics
 * Returns individual mentee topic performance (strictly validates active assignment)
 */
router.get(
  '/mentor/mentees/:studentId/topics',
  requireMentorOrAdmin,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const mentorId = req.user!.id;
      const { studentId } = req.params;

      if (req.user!.role !== 'admin') {
        const isAssigned = await analyticsStore.verifyMentorAssignment(mentorId, studentId);
        if (!isAssigned) {
          res.status(403).json({
            error: 'Forbidden: You are not authorized to view analytics for this student.',
          });
          return;
        }
      }

      const topics = await analyticsStore.getStudentTopicAnalytics(studentId);
      res.json({ topics });
    } catch (err: any) {
      console.error('[IndividualMenteeTopics] Error:', err);
      res.status(500).json({ error: 'Failed to retrieve mentee topic analytics.' });
    }
  }
);

/**
 * GET /api/analytics/mentor/mentees/:studentId/trends
 * Returns individual mentee performance trends (strictly validates active assignment)
 */
router.get(
  '/mentor/mentees/:studentId/trends',
  requireMentorOrAdmin,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const mentorId = req.user!.id;
      const { studentId } = req.params;

      if (req.user!.role !== 'admin') {
        const isAssigned = await analyticsStore.verifyMentorAssignment(mentorId, studentId);
        if (!isAssigned) {
          res.status(403).json({
            error: 'Forbidden: You are not authorized to view analytics for this student.',
          });
          return;
        }
      }

      const trends = await analyticsStore.getStudentTrends(studentId);
      res.json(trends);
    } catch (err: any) {
      console.error('[IndividualMenteeTrends] Error:', err);
      res.status(500).json({ error: 'Failed to retrieve mentee trends.' });
    }
  }
);

// ============================================================================
// 3. ADMIN ANALYTICS APIS (Authenticated Institutional Admin Only)
// ============================================================================

/**
 * GET /api/analytics/admin/overview
 * Returns institution-wide academic metrics and student completion stats
 */
router.get(
  '/admin/overview',
  requireAdminAuth,
  async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const overview = await analyticsStore.getAdminInstitutionOverview();
      res.json({ overview });
    } catch (err: any) {
      console.error('[AdminAnalyticsOverview] Error:', err);
      res.status(500).json({ error: 'Failed to retrieve institution overview.' });
    }
  }
);

/**
 * GET /api/analytics/admin/cohorts
 * Returns performance broken down across academic cohorts
 */
router.get(
  '/admin/cohorts',
  requireAdminAuth,
  async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const cohorts = await analyticsStore.getAdminCohortPerformance();
      res.json({ cohorts });
    } catch (err: any) {
      console.error('[AdminCohortPerformance] Error:', err);
      res.status(500).json({ error: 'Failed to retrieve cohort performance.' });
    }
  }
);

/**
 * GET /api/analytics/admin/topics
 * Returns institution-wide subject/topic performance analytics
 */
router.get(
  '/admin/topics',
  requireAdminAuth,
  async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const topics = await analyticsStore.getAdminTopicPerformance();
      res.json({ topics });
    } catch (err: any) {
      console.error('[AdminTopicAnalytics] Error:', err);
      res.status(500).json({ error: 'Failed to retrieve institution topic performance.' });
    }
  }
);

export default router;


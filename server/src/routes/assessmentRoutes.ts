import { Router, Response } from 'express';
import { AuthenticatedRequest, requireAuth, requireMentorOrAdmin, requireStudent } from '../middleware/auth.js';
import { assessmentStore, StoredQuestion } from '../services/assessmentStore.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { aiFeedbackStore } from '../services/aiFeedbackStore.js';
import { aiFeedbackQueue } from '../services/aiFeedbackQueue.js';
import { analyticsStore } from '../services/analyticsStore.js';

const router = Router();

// ============================================================================
// 1. MENTOR ROUTES
// ============================================================================

/**
 * GET /api/assessments/mentor
 * Returns mentor's assessments and aggregate metrics
 */
router.get('/mentor', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const mentorId = req.user!.id;
    const assessments = await assessmentStore.getMentorAssessments(mentorId);

    // Compute metrics
    let totalCreated = assessments.length;
    let published = 0;
    let draft = 0;
    let completed = 0;
    let pendingSubmissions = 0;

    const enriched = await Promise.all(
      assessments.map(async (a) => {
        if (a.status === 'published') published++;
        else if (a.status === 'draft') draft++;
        else if (a.status === 'completed') completed++;

        const questions = await assessmentStore.getAssessmentQuestions(a.id);
        const submissions = await assessmentStore.getAssessmentSubmissions(a.id);
        const assignments = await assessmentStore.getAssessmentAssignments(a.id);

        const unevaluated = submissions.filter((s) => !s.isEvaluated).length;
        pendingSubmissions += unevaluated;

        const evaluated = submissions.filter((s) => s.isEvaluated);
        const avgScore =
          evaluated.length > 0 && a.totalMarks > 0
            ? Math.round(
                (evaluated.reduce((acc, curr) => acc + curr.totalScore, 0) /
                  (evaluated.length * a.totalMarks)) *
                  100
              )
            : undefined;

        return {
          ...a,
          questionsCount: questions.length,
          submissionsCount: submissions.length,
          totalAssigned: assignments.length > 0 ? assignments.length : submissions.length,
          averageScore: avgScore,
        };
      })
    );

    res.json({
      assessments: enriched,
      stats: {
        totalCreated,
        published,
        draft,
        completed,
        pendingSubmissions,
      },
    });
  } catch (err: any) {
    console.error('[GetMentorAssessments] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve mentor assessments.' });
  }
});

/**
 * GET /api/assessments/student
 * Returns all assessments assigned to the authenticated student
 */
router.get('/student', requireStudent, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const studentId = req.user!.id;
    const assessments = await assessmentStore.getStudentAssessments(studentId);
    const now = new Date();

    const items = await Promise.all(
      assessments.map(async (a) => {
        const attempts = await assessmentStore.getStudentAttempts(a.id, studentId);
        const latestAttempt = attempts[attempts.length - 1];
        const activeAttempt = attempts.find((att) => att.status === 'in_progress');

        const startTime = new Date(a.startTime);
        const endTime = new Date(a.endTime);

        let dynamicStatus: 'available' | 'upcoming' | 'in_progress' | 'submitted' | 'evaluated' | 'missed' = 'upcoming';

        if (activeAttempt) {
          dynamicStatus = 'in_progress';
        } else if (latestAttempt && (latestAttempt.status === 'submitted' || latestAttempt.status === 'evaluated')) {
          dynamicStatus = a.isResultsPublished ? 'evaluated' : 'submitted';
        } else if (now < startTime) {
          dynamicStatus = 'upcoming';
        } else if (now >= startTime && now <= endTime) {
          dynamicStatus = attempts.length < a.allowedAttempts ? 'available' : 'submitted';
        } else if (now > endTime) {
          dynamicStatus = attempts.length > 0 ? (a.isResultsPublished ? 'evaluated' : 'submitted') : 'missed';
        }

        // Mentor name
        let mentorName = 'Faculty Advisor';
        if (supabaseAdmin) {
          try {
            const { data: mentorProf } = await supabaseAdmin.from('profiles').select('name').eq('id', a.mentorId).maybeSingle();
            if (mentorProf?.name) mentorName = mentorProf.name;
          } catch {}
        }

        return {
          id: a.id,
          title: a.title,
          subject: a.subject,
          topic: a.topic,
          description: a.description,
          mentorName,
          durationMinutes: a.durationMinutes,
          totalMarks: a.totalMarks,
          passingMarks: a.passingMarks,
          startTime: a.startTime,
          endTime: a.endTime,
          status: dynamicStatus,
          currentAttemptId: activeAttempt?.id || latestAttempt?.id,
          attemptNumber: latestAttempt?.attemptNumber || 0,
          allowedAttempts: a.allowedAttempts,
          attemptsUsed: attempts.length,
          score: a.isResultsPublished && latestAttempt ? latestAttempt.totalScore : undefined,
          isResultsPublished: a.isResultsPublished,
        };
      })
    );

    res.json({ assessments: items });
  } catch (err: any) {
    console.error('[GetStudentAssessments] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve student assessments.' });
  }
});

/**
 * POST /api/assessments
 * Creates a new assessment draft
 */
router.post('/', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      title,
      description = '',
      subject,
      topic,
      academicTermId = 'a0000000-0000-0000-0000-000000000001',
      durationMinutes = 60,
      totalMarks = 0,
      passingMarks = 0,
      startTime,
      endTime,
      allowedAttempts = 1,
      assignedStudentIds = [],
      assignedCohortId = null,
    } = req.body;

    if (!title || !title.trim()) {
      res.status(400).json({ error: 'Assessment title is required.' });
      return;
    }
    if (!subject || !subject.trim()) {
      res.status(400).json({ error: 'Subject/Discipline is required.' });
      return;
    }
    if (!topic || !topic.trim()) {
      res.status(400).json({ error: 'Weekly curriculum topic is required.' });
      return;
    }
    if (!startTime || !endTime) {
      res.status(400).json({ error: 'Start time and deadline are required.' });
      return;
    }
    if (new Date(endTime) <= new Date(startTime)) {
      res.status(400).json({ error: 'Assessment deadline must be after start time.' });
      return;
    }

    const mentorId = req.user!.id;

    const assessment = await assessmentStore.createAssessment({
      mentorId,
      academicTermId,
      title: title.trim(),
      description: description.trim(),
      subject: subject.trim(),
      topic: topic.trim(),
      durationMinutes: Number(durationMinutes) || 60,
      totalMarks: Number(totalMarks) || 0,
      passingMarks: Number(passingMarks) || 0,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      allowedAttempts: Number(allowedAttempts) || 1,
      status: 'draft',
      isResultsPublished: false,
    });

    // Populate assignments if provided
    if (Array.isArray(assignedStudentIds) && assignedStudentIds.length > 0) {
      await assessmentStore.assignAssessment(assessment.id, assignedStudentIds, assignedCohortId);
    }

    res.status(201).json({
      message: 'Assessment draft created successfully.',
      assessment,
    });
  } catch (err: any) {
    console.error('[CreateAssessment] Error:', err);
    res.status(500).json({ error: 'Failed to create assessment.' });
  }
});

/**
 * GET /api/assessments/:id
 * Retrieves full assessment details (including questions and options)
 */
router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const assessment = await assessmentStore.getAssessment(id);

    if (!assessment) {
      res.status(404).json({ error: 'Assessment not found.' });
      return;
    }

    // Role check:
    const isMentorOrAdmin = req.user!.role === 'mentor' || req.user!.role === 'admin';
    const isAuthor = assessment.mentorId === req.user!.id || assessment.mentorId === 'system-mentor-seed';

    if (req.user!.role === 'student') {
      const isAssigned = await assessmentStore.isStudentAssigned(id, req.user!.id);
      if (!isAssigned || assessment.status === 'draft') {
        res.status(403).json({ error: 'Access denied: You are not assigned to this assessment.' });
        return;
      }
    }

    const questions = await assessmentStore.getAssessmentQuestions(id);
    const assignments = await assessmentStore.getAssessmentAssignments(id);

    // Sanitize questions for student during active examination
    const sanitizedQuestions = questions.map((q) => {
      if (isMentorOrAdmin || assessment.isResultsPublished) {
        return q;
      }
      return {
        ...q,
        explanation: undefined,
        evaluationGuidance: undefined,
        options: q.options.map((opt) => ({
          id: opt.id,
          questionId: opt.questionId,
          optionOrder: opt.optionOrder,
          optionText: opt.optionText,
          isCorrect: undefined, // Hidden from student until publication
        })),
      };
    });

    res.json({
      assessment: {
        ...assessment,
        questions: sanitizedQuestions,
        assignments,
      },
    });
  } catch (err: any) {
    console.error('[GetAssessment] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve assessment details.' });
  }
});

/**
 * PUT /api/assessments/:id
 * Updates draft assessment metadata
 */
router.put('/:id', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await assessmentStore.getAssessment(id);

    if (!existing) {
      res.status(404).json({ error: 'Assessment not found.' });
      return;
    }

    if (existing.mentorId !== req.user!.id && req.user!.role !== 'admin' && existing.mentorId !== 'system-mentor-seed') {
      res.status(403).json({ error: 'Forbidden: You do not own this assessment.' });
      return;
    }

    // Safe editing policy: Block structural modifications if attempts have been initiated
    const submissions = await assessmentStore.getAssessmentSubmissions(id);
    if (submissions.length > 0 && req.body.durationMinutes && req.body.durationMinutes !== existing.durationMinutes) {
      res.status(400).json({
        error: 'Active attempts exist for this assessment. Structural changes (e.g., duration) are locked.',
      });
      return;
    }

    const updated = await assessmentStore.updateAssessment(id, req.body);
    res.json({ message: 'Assessment updated successfully.', assessment: updated });
  } catch (err: any) {
    console.error('[UpdateAssessment] Error:', err);
    res.status(500).json({ error: 'Failed to update assessment.' });
  }
});

/**
 * DELETE /api/assessments/:id
 * Deletes an assessment draft
 */
router.delete('/:id', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await assessmentStore.getAssessment(id);

    if (!existing) {
      res.status(404).json({ error: 'Assessment not found.' });
      return;
    }

    const submissions = await assessmentStore.getAssessmentSubmissions(id);
    if (submissions.length > 0) {
      res.status(400).json({
        error: 'Cannot delete assessment with existing student attempts. Archive the assessment instead.',
      });
      return;
    }

    await assessmentStore.deleteAssessment(id);
    res.json({ message: 'Assessment deleted successfully.' });
  } catch (err: any) {
    console.error('[DeleteAssessment] Error:', err);
    res.status(500).json({ error: 'Failed to delete assessment.' });
  }
});

/**
 * POST /api/assessments/:id/publish
 * Publishes an assessment to assigned students
 */
router.post('/:id/publish', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await assessmentStore.getAssessment(id);

    if (!existing) {
      res.status(404).json({ error: 'Assessment not found.' });
      return;
    }

    const questions = await assessmentStore.getAssessmentQuestions(id);
    if (questions.length === 0) {
      res.status(400).json({
        error: 'Cannot publish assessment: Add at least one question before publishing.',
      });
      return;
    }

    // Auto-calculate total marks from questions
    const sumMarks = questions.reduce((acc, q) => acc + q.marks, 0);

    const updated = await assessmentStore.updateAssessment(id, {
      status: 'published',
      totalMarks: sumMarks,
    });

    res.json({ message: 'Assessment published successfully.', assessment: updated });
  } catch (err: any) {
    console.error('[PublishAssessment] Error:', err);
    res.status(500).json({ error: 'Failed to publish assessment.' });
  }
});

/**
 * POST /api/assessments/:id/questions
 * Adds a question (MCQ or Descriptive) to an assessment
 */
router.post('/:id/questions', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await assessmentStore.getAssessment(id);

    if (!existing) {
      res.status(404).json({ error: 'Assessment not found.' });
      return;
    }

    const {
      questionType,
      questionText,
      marks = 1,
      options = [],
      evaluationGuidance,
      explanation,
    } = req.body;

    if (!questionText || !questionText.trim()) {
      res.status(400).json({ error: 'Question text is required.' });
      return;
    }
    if (Number(marks) <= 0) {
      res.status(400).json({ error: 'Question marks must be greater than zero.' });
      return;
    }

    if (questionType === 'mcq') {
      if (!Array.isArray(options) || options.length < 2) {
        res.status(400).json({ error: 'MCQ questions require at least two answer options.' });
        return;
      }
      const correctCount = options.filter((o: any) => o.isCorrect === true).length;
      if (correctCount !== 1) {
        res.status(400).json({ error: 'Single-choice MCQ must designate exactly one correct option.' });
        return;
      }
    }

    const currentQuestions = await assessmentStore.getAssessmentQuestions(id);
    const questionOrder = currentQuestions.length + 1;

    const question = await assessmentStore.addQuestion({
      assessmentId: id,
      questionOrder,
      questionType: questionType === 'mcq' ? 'mcq' : 'descriptive',
      questionText: questionText.trim(),
      marks: Number(marks),
      evaluationGuidance: evaluationGuidance?.trim(),
      explanation: explanation?.trim(),
      options: questionType === 'mcq' ? options : [],
    });

    res.status(201).json({ message: 'Question added successfully.', question });
  } catch (err: any) {
    console.error('[AddQuestion] Error:', err);
    res.status(500).json({ error: 'Failed to add question.' });
  }
});

/**
 * PUT /api/assessments/:id/questions/:questionId
 * Updates an existing question
 */
router.put('/:id/questions/:questionId', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id, questionId } = req.params;
    const updated = await assessmentStore.updateQuestion(questionId, req.body);
    if (!updated) {
      res.status(404).json({ error: 'Question not found.' });
      return;
    }
    res.json({ message: 'Question updated successfully.', question: updated });
  } catch (err: any) {
    console.error('[UpdateQuestion] Error:', err);
    res.status(500).json({ error: 'Failed to update question.' });
  }
});

/**
 * DELETE /api/assessments/:id/questions/:questionId
 * Deletes a question
 */
router.delete('/:id/questions/:questionId', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id, questionId } = req.params;
    const ok = await assessmentStore.deleteQuestion(questionId);
    if (!ok) {
      res.status(404).json({ error: 'Question not found.' });
      return;
    }
    res.json({ message: 'Question deleted successfully.' });
  } catch (err: any) {
    console.error('[DeleteQuestion] Error:', err);
    res.status(500).json({ error: 'Failed to delete question.' });
  }
});

/**
 * PUT /api/assessments/:id/questions/reorder
 * Reorders questions within an assessment
 */
router.put('/:id/questions/reorder', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { orderedQuestionIds } = req.body;
    if (!Array.isArray(orderedQuestionIds)) {
      res.status(400).json({ error: 'orderedQuestionIds array is required.' });
      return;
    }
    await assessmentStore.reorderQuestions(id, orderedQuestionIds);
    res.json({ message: 'Questions reordered successfully.' });
  } catch (err: any) {
    console.error('[ReorderQuestions] Error:', err);
    res.status(500).json({ error: 'Failed to reorder questions.' });
  }
});

/**
 * GET /api/assessments/:id/submissions
 * Review Queue: Fetches all student attempts for an assessment
 */
router.get('/:id/submissions', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const assessment = await assessmentStore.getAssessment(id);
    if (!assessment) {
      res.status(404).json({ error: 'Assessment not found.' });
      return;
    }

    const submissions = await assessmentStore.getAssessmentSubmissions(id);

    // Enrich submission records with student names and roll numbers
    const enriched = await Promise.all(
      submissions.map(async (sub) => {
        let name = 'Student';
        let rollNumber = 'N/A';
        let email = '';

        if (supabaseAdmin) {
          try {
            const { data: p } = await supabaseAdmin.from('profiles').select('name, email').eq('id', sub.studentId).maybeSingle();
            const { data: d } = await supabaseAdmin.from('student_details').select('roll_number').eq('profile_id', sub.studentId).maybeSingle();
            if (p) {
              name = p.name;
              email = p.email;
            }
            if (d) rollNumber = d.roll_number;
          } catch {}
        }

        return {
          attemptId: sub.id,
          assessmentId: sub.assessmentId,
          studentId: sub.studentId,
          studentName: name,
          rollNumber,
          studentEmail: email,
          attemptNumber: sub.attemptNumber,
          startedAt: sub.startedAt,
          submittedAt: sub.submittedAt || sub.updatedAt,
          status: sub.status,
          mcqScore: sub.mcqScore,
          descriptiveScore: sub.descriptiveScore,
          totalScore: sub.totalScore,
          maxMarks: assessment.totalMarks,
          isEvaluated: sub.isEvaluated,
          isResultsPublished: assessment.isResultsPublished,
        };
      })
    );

    res.json({ submissions: enriched, assessmentTitle: assessment.title, totalMarks: assessment.totalMarks });
  } catch (err: any) {
    console.error('[GetSubmissions] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve assessment submissions.' });
  }
});

/**
 * GET /api/assessments/submissions/:attemptId
 * Loads student submission answers for mentor grading
 */
router.get('/submissions/:attemptId', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { attemptId } = req.params;
    const attempt = await assessmentStore.getAttempt(attemptId);
    if (!attempt) {
      res.status(404).json({ error: 'Assessment attempt not found.' });
      return;
    }

    const assessment = await assessmentStore.getAssessment(attempt.assessmentId);
    const questions = await assessmentStore.getAssessmentQuestions(attempt.assessmentId);
    const answers = await assessmentStore.getAttemptAnswers(attemptId);

    res.json({
      attempt,
      assessment,
      questions,
      answers,
    });
  } catch (err: any) {
    console.error('[GetSubmissionDetail] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve submission details.' });
  }
});

/**
 * POST /api/assessments/submissions/:attemptId/evaluate
 * Mentor evaluates descriptive questions and writes feedback
 */
router.post('/submissions/:attemptId/evaluate', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { attemptId } = req.params;
    const { evaluations = [], generalFeedback = '' } = req.body;

    const evaluated = await assessmentStore.evaluateAttempt(
      attemptId,
      req.user!.id,
      evaluations,
      generalFeedback
    );

    if (!evaluated) {
      res.status(404).json({ error: 'Attempt not found.' });
      return;
    }

    // Phase 4A Step 5.3: If assessment results are already published, enqueue immediate feedback for this evaluated attempt
    try {
      const assessment = await assessmentStore.getAssessment(evaluated.assessmentId);
      if (assessment && assessment.isResultsPublished) {
        const snapshot = await analyticsStore.constructImmediateFeedbackSnapshot(
          evaluated.studentId,
          evaluated.assessmentId,
          evaluated.id
        );
        if (snapshot.isEligible && snapshot.inputSnapshotHash) {
          await aiFeedbackStore.createOrGetImmediateReport({
            studentId: evaluated.studentId,
            assessmentId: evaluated.assessmentId,
            attemptId: evaluated.id,
            inputSnapshotHash: snapshot.inputSnapshotHash,
          });
          aiFeedbackQueue.kick();
        }
      }
    } catch (aiErr) {
      console.error('[EvaluateSubmission] Non-fatal error triggering AI feedback workflow:', aiErr);
    }

    res.json({ message: 'Submission evaluated successfully.', attempt: evaluated });
  } catch (err: any) {
    console.error('[EvaluateSubmission] Error:', err);
    res.status(500).json({ error: 'Failed to save evaluation.' });
  }
});

/**
 * POST /api/assessments/:id/publish-results
 * Mentor publishes grades and feedback to students
 */
router.post('/:id/publish-results', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await assessmentStore.getAssessment(id);
    if (!existing) {
      res.status(404).json({ error: 'Assessment not found.' });
      return;
    }

    // Set publication timestamp on initial publication; do not overwrite on duplicate requests
    const resultsPublishedAt = existing.resultsPublishedAt || new Date().toISOString();

    const updated = await assessmentStore.updateAssessment(id, {
      isResultsPublished: true,
      status: 'completed',
      resultsPublishedAt,
    });

    if (!updated) {
      res.status(404).json({ error: 'Assessment not found.' });
      return;
    }

    // Phase 4A Step 5.3: Enqueue immediate AI feedback for all evaluated attempts
    // Asynchronously trigger feedback creation without blocking or failing the publication response
    try {
      const submissions = await assessmentStore.getAssessmentSubmissions(id);
      const evaluatedSubmissions = submissions.filter((s) => s.isEvaluated && s.status === 'evaluated');

      for (const sub of evaluatedSubmissions) {
        try {
          const snapshot = await analyticsStore.constructImmediateFeedbackSnapshot(
            sub.studentId,
            id,
            sub.id
          );

          if (snapshot.isEligible && snapshot.inputSnapshotHash) {
            await aiFeedbackStore.createOrGetImmediateReport({
              studentId: sub.studentId,
              assessmentId: id,
              attemptId: sub.id,
              inputSnapshotHash: snapshot.inputSnapshotHash,
            });
          }
        } catch (subErr) {
          console.error(`[PublishResults] Error enqueueing AI feedback for attempt ${sub.id}:`, subErr);
        }
      }

      // Kick queue processor in background (non-blocking)
      aiFeedbackQueue.kick();
    } catch (aiErr) {
      // AI failure must not undo or block successful result publication
      console.error('[PublishResults] Non-fatal error triggering AI feedback workflow:', aiErr);
    }

    res.json({ message: 'Assessment results published to students.', assessment: updated });
  } catch (err: any) {
    console.error('[PublishResults] Error:', err);
    res.status(500).json({ error: 'Failed to publish assessment results.' });
  }
});

// ============================================================================
// 2. STUDENT ROUTES
// ============================================================================

/**
 * POST /api/assessments/:id/start
 * Student begins or resumes an assessment attempt
 */
router.post('/:id/start', requireStudent, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const studentId = req.user!.id;

    const assessment = await assessmentStore.getAssessment(id);
    if (!assessment) {
      res.status(404).json({ error: 'Assessment not found.' });
      return;
    }

    if (assessment.status !== 'published') {
      res.status(400).json({ error: 'Assessment is not open for testing.' });
      return;
    }

    const now = new Date();
    const startTime = new Date(assessment.startTime);
    const endTime = new Date(assessment.endTime);

    if (now < startTime) {
      res.status(400).json({ error: `Assessment has not started yet. Begins at ${assessment.startTime}.` });
      return;
    }

    const isAssigned = await assessmentStore.isStudentAssigned(id, studentId);
    if (!isAssigned) {
      res.status(403).json({ error: 'You are not assigned to this assessment.' });
      return;
    }

    const existingAttempts = await assessmentStore.getStudentAttempts(id, studentId);
    const activeAttempt = existingAttempts.find((a) => a.status === 'in_progress');

    // Deadline check for new attempt
    if (!activeAttempt) {
      if (now > endTime) {
        res.status(400).json({ error: 'Assessment deadline has passed.' });
        return;
      }
      if (existingAttempts.length >= assessment.allowedAttempts) {
        res.status(400).json({
          error: `Maximum allowed attempts (${assessment.allowedAttempts}) already reached.`,
        });
        return;
      }
    }

    const attempt = await assessmentStore.startAttempt(id, studentId);

    // Retrieve questions with answer options (sanitized: NO correct answer leaks)
    const questions = await assessmentStore.getAssessmentQuestions(id);
    const sanitizedQuestions = questions.map((q) => ({
      id: q.id,
      questionOrder: q.questionOrder,
      questionType: q.questionType,
      questionText: q.questionText,
      marks: q.marks,
      options: q.options.map((opt) => ({
        id: opt.id,
        optionOrder: opt.optionOrder,
        optionText: opt.optionText,
      })),
    }));

    const savedAnswers = await assessmentStore.getAttemptAnswers(attempt.id);

    // Calculate remaining seconds
    const elapsedSeconds = Math.floor((now.getTime() - new Date(attempt.startedAt).getTime()) / 1000);
    const totalAllowedSeconds = assessment.durationMinutes * 60;
    const remainingSeconds = Math.max(0, totalAllowedSeconds - elapsedSeconds);

    res.json({
      attempt,
      assessment: {
        id: assessment.id,
        title: assessment.title,
        subject: assessment.subject,
        topic: assessment.topic,
        durationMinutes: assessment.durationMinutes,
        totalMarks: assessment.totalMarks,
        endTime: assessment.endTime,
      },
      questions: sanitizedQuestions,
      answers: savedAnswers,
      remainingSeconds,
    });
  } catch (err: any) {
    console.error('[StartAttempt] Error:', err);
    res.status(500).json({ error: 'Failed to initiate assessment attempt.' });
  }
});

/**
 * GET /api/assessments/attempts/:attemptId
 * Resumes active attempt state
 */
router.get('/attempts/:attemptId', requireStudent, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { attemptId } = req.params;
    const studentId = req.user!.id;

    const attempt = await assessmentStore.getAttempt(attemptId);
    if (!attempt || attempt.studentId !== studentId) {
      res.status(404).json({ error: 'Assessment attempt not found or unauthorized.' });
      return;
    }

    const assessment = await assessmentStore.getAssessment(attempt.assessmentId);
    if (!assessment) {
      res.status(404).json({ error: 'Parent assessment not found.' });
      return;
    }

    const questions = await assessmentStore.getAssessmentQuestions(attempt.assessmentId);
    const sanitizedQuestions = questions.map((q) => ({
      id: q.id,
      questionOrder: q.questionOrder,
      questionType: q.questionType,
      questionText: q.questionText,
      marks: q.marks,
      options: q.options.map((opt) => ({
        id: opt.id,
        optionOrder: opt.optionOrder,
        optionText: opt.optionText,
      })),
    }));

    const savedAnswers = await assessmentStore.getAttemptAnswers(attempt.id);

    const now = new Date();
    const elapsedSeconds = Math.floor((now.getTime() - new Date(attempt.startedAt).getTime()) / 1000);
    const totalAllowedSeconds = assessment.durationMinutes * 60;
    const remainingSeconds = Math.max(0, totalAllowedSeconds - elapsedSeconds);

    res.json({
      attempt,
      assessment: {
        id: assessment.id,
        title: assessment.title,
        subject: assessment.subject,
        durationMinutes: assessment.durationMinutes,
        totalMarks: assessment.totalMarks,
      },
      questions: sanitizedQuestions,
      answers: savedAnswers,
      remainingSeconds,
    });
  } catch (err: any) {
    console.error('[GetAttempt] Error:', err);
    res.status(500).json({ error: 'Failed to resume assessment attempt.' });
  }
});

/**
 * GET /api/assessments/attempts/:attemptId/answers
 * Retrieves saved answers for an attempt (restores answers upon refresh)
 */
router.get('/attempts/:attemptId/answers', requireStudent, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { attemptId } = req.params;
    const studentId = req.user!.id;

    const attempt = await assessmentStore.getAttempt(attemptId);
    if (!attempt || attempt.studentId !== studentId) {
      res.status(403).json({ error: 'Unauthorized attempt access.' });
      return;
    }

    const answers = await assessmentStore.getAttemptAnswers(attemptId);
    const sanitized = answers.map((a) => ({
      id: a.id,
      attemptId: a.attemptId,
      questionId: a.questionId,
      selectedOptionId: a.selectedOptionId,
      descriptiveAnswer: a.descriptiveAnswer,
      updatedAt: a.updatedAt,
    }));

    res.json({ answers: sanitized });
  } catch (err: any) {
    console.error('[GetAttemptAnswers] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve saved answers.' });
  }
});

/**
 * POST /api/assessments/attempts/:attemptId/answers
 * Saves/auto-saves answer for a question
 */
router.post('/attempts/:attemptId/answers', requireStudent, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { attemptId } = req.params;
    const studentId = req.user!.id;
    const { questionId, selectedOptionId, descriptiveAnswer } = req.body;

    const attempt = await assessmentStore.getAttempt(attemptId);
    if (!attempt || attempt.studentId !== studentId) {
      res.status(403).json({ error: 'Unauthorized attempt access.' });
      return;
    }

    if (attempt.status !== 'in_progress') {
      res.status(400).json({ error: 'Cannot modify answers for an already submitted attempt.' });
      return;
    }

    // Verify time remaining
    const assessment = await assessmentStore.getAssessment(attempt.assessmentId);
    if (assessment) {
      const now = new Date();
      const elapsedSeconds = Math.floor((now.getTime() - new Date(attempt.startedAt).getTime()) / 1000);
      const totalAllowedSeconds = assessment.durationMinutes * 60 + 30; // 30s grace period for network latency
      if (elapsedSeconds > totalAllowedSeconds) {
        // Auto-submit expired attempt
        await assessmentStore.submitAttempt(attemptId);
        res.status(400).json({ error: 'Assessment time limit expired. Attempt auto-submitted.' });
        return;
      }
    }

    const saved = await assessmentStore.saveAnswer(attemptId, questionId, {
      selectedOptionId,
      descriptiveAnswer,
    });

    res.json({ message: 'Answer saved successfully.', answer: saved });
  } catch (err: any) {
    console.error('[SaveAnswer] Error:', err);
    res.status(500).json({ error: 'Failed to save question answer.' });
  }
});

/**
 * POST /api/assessments/attempts/:attemptId/submit
 * Submits the assessment attempt and auto-evaluates MCQs
 */
router.post('/attempts/:attemptId/submit', requireStudent, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { attemptId } = req.params;
    const studentId = req.user!.id;

    const attempt = await assessmentStore.getAttempt(attemptId);
    if (!attempt || attempt.studentId !== studentId) {
      res.status(403).json({ error: 'Unauthorized attempt access.' });
      return;
    }

    if (attempt.status !== 'in_progress') {
      res.status(400).json({ error: 'Attempt is already submitted.' });
      return;
    }

    const submitted = await assessmentStore.submitAttempt(attemptId);
    if (!submitted) {
      res.status(500).json({ error: 'Failed to process submission.' });
      return;
    }

    res.json({
      message: 'Assessment submitted successfully.',
      attempt: {
        id: submitted.id,
        status: submitted.status,
        submittedAt: submitted.submittedAt,
        isEvaluated: submitted.isEvaluated,
      },
    });
  } catch (err: any) {
    console.error('[SubmitAttempt] Error:', err);
    res.status(500).json({ error: 'Failed to submit assessment.' });
  }
});

/**
 * GET /api/assessments/attempts/:attemptId/review
 * Student reviews graded assessment once results are published
 */
router.get('/attempts/:attemptId/review', requireStudent, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { attemptId } = req.params;
    const studentId = req.user!.id;

    const attempt = await assessmentStore.getAttempt(attemptId);
    if (!attempt || attempt.studentId !== studentId) {
      res.status(403).json({ error: 'Unauthorized attempt access.' });
      return;
    }

    const assessment = await assessmentStore.getAssessment(attempt.assessmentId);
    if (!assessment) {
      res.status(404).json({ error: 'Assessment not found.' });
      return;
    }

    const questions = await assessmentStore.getAssessmentQuestions(attempt.assessmentId);
    const answers = await assessmentStore.getAttemptAnswers(attemptId);

    // If results are NOT yet published, do not expose correct answers or scores
    if (!assessment.isResultsPublished) {
      res.json({
        isResultsPublished: false,
        message: 'Evaluation is in progress. Official scores and feedback will be visible once published by your mentor.',
        attempt: {
          id: attempt.id,
          status: attempt.status,
          submittedAt: attempt.submittedAt,
        },
      });
      return;
    }

    // Results ARE published: provide full pedagogical feedback, breakdown, and explanations
    let aiFeedback: any = null;
    try {
      const report = await aiFeedbackStore.getImmediateReport(studentId, attemptId);
      // Requirement 5: Do not expose feedback to students until report status is completed
      if (report && report.status === 'completed') {
        aiFeedback = {
          id: report.id,
          status: report.status,
          summary: report.summary,
          strengths: report.strengths,
          weaknesses: report.weaknesses,
          recommendedActions: report.recommendedActions,
          modelName: report.modelName,
          createdAt: report.createdAt,
        };
      }
    } catch (fbErr) {
      console.warn('[ReviewAttempt] Non-fatal error fetching completed AI feedback:', fbErr);
    }

    res.json({
      isResultsPublished: true,
      attempt,
      assessment,
      questions,
      answers,
      aiFeedback,
    });
  } catch (err: any) {
    console.error('[ReviewAttempt] Error:', err);
    res.status(500).json({ error: 'Failed to load assessment review.' });
  }
});

export default router;


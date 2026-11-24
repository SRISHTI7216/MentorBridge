import { Router, Response } from 'express';
import { AuthenticatedRequest, requireMentorOrAdmin, requireStudent } from '../middleware/auth.js';
import { learningStore, LearningStoreError, validateDraftLearningModule } from '../services/learningStore.js';

const router = Router();

const mentorActor = (req: AuthenticatedRequest) => ({ id: req.user!.id, role: req.user!.role });

function sendLearningFailure(res: Response, err: unknown, fallback: string, label: string): void {
  console.error(`[${label}] Error:`, err);
  const status = err instanceof LearningStoreError ? err.status : 500;
  res.status(status).json({ error: err instanceof Error && status !== 500 ? err.message : fallback });
}

router.get('/mentor/modules', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json({ modules: await learningStore.listMentorModules({ id: req.user!.id, role: req.user!.role }) });
  } catch (err: any) {
    console.error('[MentorLearningModules] Error:', err);
    const status = err instanceof LearningStoreError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error && status !== 500 ? err.message : 'Failed to retrieve learning modules.' });
  }
});

router.get('/mentor/module-options', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json(await learningStore.getMentorModuleOptions({ id: req.user!.id, role: req.user!.role }));
  } catch (err: any) {
    console.error('[MentorLearningModuleOptions] Error:', err);
    const status = err instanceof LearningStoreError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error && status !== 500 ? err.message : 'Failed to retrieve module creation options.' });
  }
});

router.post('/mentor/modules', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const input = validateDraftLearningModule(req.body);
    const module = await learningStore.createDraftModule(input, { id: req.user!.id, role: req.user!.role });
    res.status(201).json({ module });
  } catch (err: any) {
    console.error('[CreateMentorLearningModule] Error:', err);
    const status = err instanceof LearningStoreError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error && status !== 500 ? err.message : 'Failed to create learning module.' });
  }
});

router.post('/mentor/modules/:moduleId/publish', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await learningStore.publishMentorModule(req.params.moduleId, mentorActor(req));
    res.json({ message: 'Learning module published successfully.', ...result });
  } catch (err) {
    sendLearningFailure(res, err, 'Failed to publish learning module.', 'PublishMentorLearningModule');
  }
});

router.get('/mentor/modules/:moduleId/mentees', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json({ students: await learningStore.eligibleModuleMentees(req.params.moduleId, mentorActor(req)) });
  } catch (err) {
    sendLearningFailure(res, err, 'Failed to retrieve eligible students.', 'EligibleLearningMentees');
  }
});

router.get('/mentor/modules/:moduleId/assignments', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json({ assignments: await learningStore.listModuleAssignments(req.params.moduleId, mentorActor(req)) });
  } catch (err) {
    sendLearningFailure(res, err, 'Failed to retrieve module assignments.', 'ListLearningAssignments');
  }
});

router.post('/mentor/modules/:moduleId/assignments', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const studentId = typeof req.body?.student_id === 'string' ? req.body.student_id : '';
    const assignment = await learningStore.createModuleAssignment(req.params.moduleId, studentId, mentorActor(req));
    res.status(201).json({ assignment });
  } catch (err) {
    sendLearningFailure(res, err, 'Failed to assign learning module.', 'CreateLearningAssignment');
  }
});

router.get('/mentor/modules/:moduleId/lessons', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json({ lessons: await learningStore.listMentorLessons(req.params.moduleId, mentorActor(req)) });
  } catch (err) {
    sendLearningFailure(res, err, 'Failed to retrieve module lessons.', 'MentorLearningLessons');
  }
});

router.post('/mentor/modules/:moduleId/lessons', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const lesson = await learningStore.createMentorLesson(req.params.moduleId, req.body, mentorActor(req));
    res.status(201).json({ lesson });
  } catch (err) {
    sendLearningFailure(res, err, 'Failed to create lesson.', 'CreateMentorLearningLesson');
  }
});

router.put('/mentor/modules/:moduleId/lessons/reorder', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const lessons = await learningStore.reorderMentorLessons(req.params.moduleId, req.body?.lessonIds, mentorActor(req));
    res.json({ lessons });
  } catch (err) {
    sendLearningFailure(res, err, 'Failed to reorder lessons.', 'ReorderMentorLearningLessons');
  }
});

router.patch('/mentor/modules/:moduleId/lessons/:lessonId', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const lesson = await learningStore.updateMentorLesson(req.params.moduleId, req.params.lessonId, req.body, mentorActor(req));
    res.json({ lesson });
  } catch (err) {
    sendLearningFailure(res, err, 'Failed to update lesson.', 'UpdateMentorLearningLesson');
  }
});

router.delete('/mentor/modules/:moduleId/lessons/:lessonId', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json(await learningStore.deleteMentorLesson(req.params.moduleId, req.params.lessonId, mentorActor(req)));
  } catch (err) {
    sendLearningFailure(res, err, 'Failed to delete lesson.', 'DeleteMentorLearningLesson');
  }
});

router.get('/mentor/modules/:moduleId/resources', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json({ resources: await learningStore.listMentorResources(req.params.moduleId, mentorActor(req)) });
  } catch (err) {
    sendLearningFailure(res, err, 'Failed to retrieve module resources.', 'MentorLearningResources');
  }
});

router.post('/mentor/modules/:moduleId/resources', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const resource = await learningStore.createMentorResource(req.params.moduleId, req.body, mentorActor(req));
    res.status(201).json({ resource });
  } catch (err) {
    sendLearningFailure(res, err, 'Failed to create resource.', 'CreateMentorLearningResource');
  }
});

router.patch('/mentor/modules/:moduleId/resources/:resourceId', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const resource = await learningStore.updateMentorResource(req.params.moduleId, req.params.resourceId, req.body, mentorActor(req));
    res.json({ resource });
  } catch (err) {
    sendLearningFailure(res, err, 'Failed to update resource.', 'UpdateMentorLearningResource');
  }
});

router.delete('/mentor/modules/:moduleId/resources/:resourceId', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json(await learningStore.deleteMentorResource(req.params.moduleId, req.params.resourceId, mentorActor(req)));
  } catch (err) {
    sendLearningFailure(res, err, 'Failed to delete resource.', 'DeleteMentorLearningResource');
  }
});

router.get('/student/modules', requireStudent, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json({ modules: await learningStore.listModules(req.user!.id) });
  } catch (err: any) {
    console.error('[StudentLearningModules] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve learning modules.' });
  }
});

router.get('/student/modules/:moduleId', requireStudent, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const detail = await learningStore.getModule(req.params.moduleId, req.user!.id);
    if (!detail) { res.status(404).json({ error: 'Learning module not found or unavailable.' }); return; }
    res.json(detail);
  } catch (err: any) {
    console.error('[StudentLearningModuleDetail] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve learning module.' });
  }
});

router.post('/student/modules/:moduleId/enroll', requireStudent, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await learningStore.enroll(req.params.moduleId, req.user!.id);
    if (!result) { res.status(403).json({ error: 'You are not eligible to enroll in this module.' }); return; }
    res.json(result);
  } catch (err: any) {
    console.error('[StudentLearningEnroll] Error:', err);
    res.status(500).json({ error: 'Failed to enroll in learning module.' });
  }
});

router.post('/student/modules/:moduleId/assigned-enroll', requireStudent, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json(await learningStore.enrollAssignedModule(req.params.moduleId, req.user!.id));
  } catch (err) {
    sendLearningFailure(res, err, 'Failed to start assigned learning module.', 'AssignedLearningEnroll');
  }
});

router.get('/student/modules/:moduleId/progress', requireStudent, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await learningStore.getProgress(req.params.moduleId, req.user!.id);
    if (!result) { res.status(404).json({ error: 'Learning module not found or unavailable.' }); return; }
    res.json(result);
  } catch (err: any) {
    console.error('[StudentLearningProgress] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve learning progress.' });
  }
});

router.post('/student/modules/:moduleId/lessons/:lessonId/complete', requireStudent, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await learningStore.completeLesson(req.params.moduleId, req.params.lessonId, req.user!.id);
    if (!result) { res.status(403).json({ error: 'An active enrollment and a lesson in this module are required.' }); return; }
    res.json(result);
  } catch (err: any) {
    console.error('[StudentLessonCompletion] Error:', err);
    res.status(500).json({ error: 'Failed to record lesson completion.' });
  }
});

export default router;

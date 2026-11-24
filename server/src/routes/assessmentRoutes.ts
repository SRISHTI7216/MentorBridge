import { Router, Response } from 'express';
import { AuthenticatedRequest, requireAuth, requireMentorOrAdmin, requireStudent } from '../middleware/auth.js';
import { assessmentStore } from '../services/assessmentStore.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { aiFeedbackStore } from '../services/aiFeedbackStore.js';
import { aiFeedbackQueue } from '../services/aiFeedbackQueue.js';
import { analyticsStore } from '../services/analyticsStore.js';
import { validateQuestion, studentSafeQuestion } from '../services/assessmentValidation.js';
import { mentorAssessmentAnalyticsStore } from '../services/mentorAssessmentAnalyticsStore.js';
import { getStudentAssessmentStatus, latestStudentSubmittedAttempt, resumeOrStartAttempt, studentResultIsVisible } from '../services/studentAssessmentPresentation.js';
import { attemptsBlockingResultReleaseCount, canManageAssessment, validateDraftReadiness } from '../services/assessmentLifecycle.js';
import { validateDraftAssessmentModuleLink } from '../services/assessmentModuleLinking.js';

const router = Router();
const verifyDraftModuleWorkflow=async(assessmentId:string,actorId:string,role:string,requireModule = false)=>{
  const {data:assessment,error:assessmentError}=await supabaseAdmin!.from('assessments').select('mentor_id,status').eq('id',assessmentId).maybeSingle();
  if(assessmentError||!assessment)return {ok:false,status:404 as const,error:'Assessment not found.'};
  if(assessment.status!=='draft')return {ok:false,status:409 as const,error:'Assessment must remain draft.'};
  const {data:link,error:linkError}=await supabaseAdmin!.from('module_assessment_links').select('module_id').eq('assessment_id',assessmentId).maybeSingle();
  if(linkError)return {ok:false,status:409 as const,error:'A linked learning module is unavailable.'};
  if(!link) {
    if(requireModule) return {ok:false,status:409 as const,error:'A linked learning module is required.'};
    return {ok:true,status:200 as const,error:'',module:null};
  }
  const {data:module,error}=await supabaseAdmin!.from('learning_modules').select('id,created_by,status').eq('id',link.module_id).maybeSingle();
  if(error||!module)return {ok:false,status:409 as const,error:'Linked learning module is unavailable.'};
  if(module.created_by!==assessment.mentor_id)return {ok:false,status:409 as const,error:'Assessment and linked module ownership do not match.'};
  if(module.status!=='draft')return {ok:false,status:409 as const,error:'The linked learning module must remain draft.'};
  if(module.created_by!==actorId&&role!=='admin')return {ok:false,status:403 as const,error:'Module ownership is required.'};
  return {ok:true,status:200 as const,error:'',module};
};
const isAiGeneratedQuestion=async(questionId:string)=>{
  const {data,error}=await supabaseAdmin!.from('assessment_questions').select('generation_job_id').eq('id',questionId).maybeSingle();
  if(error)throw error; return !!data?.generation_job_id;
};

// Review endpoints expose provenance labels and locations only; storage paths are never selected.
router.get('/:id/review/questions', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const assessment = await assessmentStore.getAssessment(req.params.id);
    if (!assessment) { res.status(404).json({ error: 'Assessment not found.' }); return; }
    if (assessment.mentorId !== req.user!.id && req.user!.role !== 'admin') { res.status(403).json({ error: 'Forbidden.' }); return; }
    if(assessment.status!=='draft'){res.status(409).json({error:'Question review is available only for draft assessments.'});return;}
    const { data: link } = await supabaseAdmin!.from('module_assessment_links').select('module_id').eq('assessment_id', assessment.id).maybeSingle();
    if (!link) { res.status(409).json({ error: 'Assessment is not linked to a learning module.' }); return; }
    const { data: module } = await supabaseAdmin!.from('learning_modules').select('id,created_by,status,code,title,week_number').eq('id', link.module_id).maybeSingle();
    if (!module || module.created_by!==assessment.mentorId || (module.created_by !== req.user!.id && req.user!.role !== 'admin')) { res.status(403).json({ error: 'Assessment and module ownership must match.' }); return; }
    if(module.status!=='draft'){res.status(409).json({error:'Question review requires a draft learning module.'});return;}
    const { data: rows, error } = await supabaseAdmin!.from('assessment_questions').select('*,assessment_options(*),assessment_question_generation_jobs(actual_model,status,created_at,completed_at),assessment_question_source_references(source_document_id,location_kind,location_start,location_end,assessment_source_documents(original_filename))').eq('assessment_id', assessment.id).is('removed_at', null).order('question_order');
    if (error) throw error;
    res.json({ assessment: { id: assessment.id, status: assessment.status }, module: { id: module.id, code: module.code, title: module.title, weekNumber: module.week_number, status: module.status }, questions: (rows || []).map((q: any) => ({
      id:q.id, questionOrder:q.question_order, questionType:q.question_type, questionText:q.question_text, marks:q.marks,
      explanation:q.explanation, evaluationGuidance:q.evaluation_guidance, options:(q.assessment_options||[]).sort((a:any,b:any)=>a.option_order-b.option_order).map((o:any)=>({id:o.id,optionOrder:o.option_order,optionText:o.option_text,isCorrect:o.is_correct})),
      origin:q.generation_job_id?'ai_generated':'manual', mentorEdited:!!q.mentor_edited_at, approval:{approved:!!q.is_approved,approvedBy:q.approved_by,approvedAt:q.approved_at},
      generation:{jobId:q.generation_job_id,difficulty:q.generation_difficulty,cognitiveLevel:q.generation_cognitive_level,topic:q.generation_topic,model:q.assessment_question_generation_jobs?.actual_model,status:q.assessment_question_generation_jobs?.status,createdAt:q.assessment_question_generation_jobs?.created_at,completedAt:q.assessment_question_generation_jobs?.completed_at},
      sources:(q.assessment_question_source_references||[]).map((r:any)=>({documentId:r.source_document_id,filename:r.assessment_source_documents?.original_filename,kind:r.location_kind,start:r.location_start,end:r.location_end}))
    })) });
  } catch { res.status(500).json({ error: 'Failed to load question review.' }); }
});

router.get('/:id/questions/:questionId/history', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const assessment = await assessmentStore.getAssessment(req.params.id);
    if (!assessment || (assessment.mentorId !== req.user!.id && req.user!.role !== 'admin')) { res.status(404).json({ error: 'Question history not found.' }); return; }
    const {data:q}=await supabaseAdmin!.from('assessment_questions').select('id').eq('assessment_id',assessment.id).eq('id',req.params.questionId).maybeSingle();
    if(!q){res.status(404).json({error:'Question history not found.'});return;}
    const [{data,error},{data:regens, error:regenError}]=await Promise.all([
      supabaseAdmin!.from('assessment_question_revisions').select('id,actor_id,action,revision,created_at').eq('assessment_id', assessment.id).eq('question_id', req.params.questionId).order('created_at',{ascending:false}),
      supabaseAdmin!.from('assessment_question_regenerations').select('id,actor_id,status,actual_model,error_code,created_at,completed_at').eq('assessment_id',assessment.id).eq('question_id',req.params.questionId).order('created_at',{ascending:false})
    ]);
    if (error||regenError) throw error||regenError; res.json({ history:[...(data||[]),...(regens||[]).map((r:any)=>({...r,action:'regeneration_job',revision:{status:r.status,actualModel:r.actual_model,errorCode:r.error_code}}))].sort((a:any,b:any)=>Date.parse(b.created_at)-Date.parse(a.created_at)) });
  } catch { res.status(500).json({ error: 'Failed to load question history.' }); }
});

router.post('/:id/questions/:questionId/approve', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const assessment = await assessmentStore.getAssessment(req.params.id);
    if (!assessment || (assessment.mentorId !== req.user!.id && req.user!.role !== 'admin')) { res.status(404).json({ error: 'Question not found.' }); return; }
    if (assessment.status !== 'draft') { res.status(409).json({ error: 'Only draft questions can be approved.' }); return; }
    const workflow=await verifyDraftModuleWorkflow(assessment.id,req.user!.id,req.user!.role); if(!workflow.ok){res.status(workflow.status).json({error:workflow.error});return;}
    const { data: q, error: loadError } = await supabaseAdmin!.from('assessment_questions').select('*,assessment_options(*)').eq('id',req.params.questionId).eq('assessment_id',assessment.id).is('removed_at',null).maybeSingle();
    if (loadError || !q) { res.status(404).json({ error: 'Question not found.' }); return; }
    if (!q.generation_job_id) { res.status(409).json({ error: 'Only AI-generated questions use this approval workflow.' }); return; }
    const invalid=validateQuestion({questionType:q.question_type,questionText:q.question_text,marks:Number(q.marks),options:(q.assessment_options||[]).sort((a:any,b:any)=>a.option_order-b.option_order).map((o:any)=>({optionText:o.option_text,isCorrect:o.is_correct}))});
    if(invalid){res.status(400).json({error:`Question is invalid: ${invalid}`});return;}
    const {data,error}=await supabaseAdmin!.rpc('approve_assessment_question',{p_assessment_id:assessment.id,p_question_id:q.id,p_actor_id:req.user!.id});
    if(error)throw error; const result=Array.isArray(data)?data[0]:data;
    res.json({message:result?.changed?'Question approved.':'Question was already approved.',changed:result?.changed===true,approvedAt:result?.approved_at||q.approved_at});
  } catch { res.status(500).json({ error: 'Failed to approve question.' }); }
});

router.post('/:id/questions/:questionId/reject', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const assessment = await assessmentStore.getAssessment(req.params.id);
    if (!assessment || (assessment.mentorId !== req.user!.id && req.user!.role !== 'admin')) { res.status(404).json({ error: 'Question not found.' }); return; }
    if (assessment.status !== 'draft') { res.status(409).json({ error: 'Only draft questions can be removed.' }); return; }
    const workflow=await verifyDraftModuleWorkflow(assessment.id,req.user!.id,req.user!.role); if(!workflow.ok){res.status(workflow.status).json({error:workflow.error});return;}
    const {data:q}=await supabaseAdmin!.from('assessment_questions').select('*').eq('id',req.params.questionId).eq('assessment_id',assessment.id).is('removed_at',null).maybeSingle();
    if(!q){res.status(404).json({error:'Question not found.'});return;} if(!q.generation_job_id){res.status(409).json({error:'Manual questions cannot be rejected through this action.'});return;}
    const reason=typeof req.body?.reason==='string'?req.body.reason.trim().slice(0,500):null;
    const {data,error}=await supabaseAdmin!.rpc('reject_assessment_question',{p_assessment_id:assessment.id,p_question_id:q.id,p_actor_id:req.user!.id,p_reason:reason});
    if(error)throw error; res.json({message:data?'AI question removed from the active assessment.':'Question was already removed.',changed:data===true});
  } catch { res.status(500).json({ error: 'Failed to remove question.' }); }
});
const studentAttemptSummary = (attempt: any, includeResult = false) => ({
  id: attempt.id, assessmentId: attempt.assessmentId, attemptNumber: attempt.attemptNumber,
  startedAt: attempt.startedAt, submittedAt: attempt.submittedAt,
  status: !includeResult && attempt.status === 'evaluated' ? 'submitted' : attempt.status,
  ...(includeResult ? { mcqScore: attempt.mcqScore, descriptiveScore: attempt.descriptiveScore, totalScore: attempt.totalScore, isEvaluated: attempt.isEvaluated, generalFeedback: attempt.generalFeedback } : {}),
});
const studentAnswerDraft = (answer: any) => ({ id: answer.id, attemptId: answer.attemptId, questionId: answer.questionId, selectedOptionId: answer.selectedOptionId, selectedOptionIds: answer.selectedOptionIds, descriptiveAnswer: answer.descriptiveAnswer, updatedAt: answer.updatedAt });

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
    const moduleLinksByAssessment = new Map<string, Array<{ id: string; code: string; title: string; status: string; version: number }>>();
    if (assessments.length) {
      const { data: links, error: linksError } = await supabaseAdmin!.from('module_assessment_links')
        .select('assessment_id,module_id').in('assessment_id', assessments.map((assessment) => assessment.id));
      if (linksError) throw linksError;
      const moduleIds = [...new Set((links || []).map((link: any) => link.module_id))];
      const { data: modules, error: modulesError } = moduleIds.length
        ? await supabaseAdmin!.from('learning_modules').select('id,code,title,status,version').in('id', moduleIds)
        : { data: [], error: null };
      if (modulesError) throw modulesError;
      const byId = new Map((modules || []).map((module: any) => [module.id, module]));
      for (const link of links || []) {
        const module: any = byId.get(link.module_id);
        if (module) moduleLinksByAssessment.set(link.assessment_id, [...(moduleLinksByAssessment.get(link.assessment_id) || []), module]);
      }
    }

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
          modules: moduleLinksByAssessment.get(a.id) || [],
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

// Reporting is scoped to the authenticated assessment owner and their active
// allocations. Admins retain the existing cross-owner administrative access.
router.get('/:id/report', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const report = await mentorAssessmentAnalyticsStore.getAssessmentReport(req.params.id, req.user!.id, req.user!.role === 'admin');
    if (!report) { res.status(404).json({ error: 'Assessment report not found.' }); return; }
    res.json({ report });
  } catch (err: any) {
    console.error('[MentorAssessmentReport] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve assessment report.' });
  }
});

router.get('/modules/:moduleId/assessments', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { data: module, error } = await supabaseAdmin!.from('learning_modules').select('id,created_by').eq('id', req.params.moduleId).maybeSingle();
    if (error || !module || (module.created_by !== req.user!.id && req.user!.role !== 'admin')) { res.status(404).json({ error: 'Module not found.' }); return; }
    const { data: links, error: linkError } = await supabaseAdmin!.from('module_assessment_links').select('assessment_id').eq('module_id', req.params.moduleId);
    if (linkError) throw linkError;
    const assessments = await Promise.all((links || []).map((link) => assessmentStore.getAssessment(link.assessment_id)));
    res.json({ assessments: assessments.filter(Boolean) });
  } catch { res.status(500).json({ error: 'Failed to retrieve module assessments.' }); }
});

router.post('/:id/modules/:moduleId', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const assessment = await assessmentStore.getAssessment(req.params.id);
    const { data: module, error: moduleError } = await supabaseAdmin!.from('learning_modules').select('id,created_by,status,code,version').eq('id', req.params.moduleId).maybeSingle();
    if (moduleError) throw moduleError;
    if (!assessment || !module) { res.status(404).json({ error: 'Assessment or module not found.' }); return; }
    let originModule: any = null;
    if (assessment.originModuleId && assessment.originModuleId !== module.id) {
      const { data: origin, error: originError } = await supabaseAdmin!.from('learning_modules').select('id,created_by,code').eq('id', assessment.originModuleId).maybeSingle();
      if (originError) throw originError;
      originModule = origin ? { id: origin.id, ownerId: origin.created_by, code: origin.code, status: 'draft' } : null;
    }
    const { data: existingLinks, error: linksError } = await supabaseAdmin!.from('module_assessment_links').select('module_id').eq('assessment_id', assessment.id);
    if (linksError) throw linksError;
    const linkCheck = validateDraftAssessmentModuleLink({
      assessment: { id: assessment.id, ownerId: assessment.mentorId, status: assessment.status, code: '', originModuleId: assessment.originModuleId },
      module: { id: module.id, ownerId: module.created_by, status: module.status, code: module.code },
      originModule, actorId: req.user!.id, role: req.user!.role,
      existingLinks: (existingLinks || []).map((link: any) => ({ moduleId: link.module_id })),
    });
    if (!linkCheck.ok) { res.status(linkCheck.status).json({ error: linkCheck.error }); return; }
    if (linkCheck.alreadyLinked) { res.json({ message: 'Assessment is already linked to this module.' }); return; }
    const { error } = await supabaseAdmin!.from('module_assessment_links').insert({ module_id: module.id, assessment_id: assessment.id });
    if (error) { res.status(409).json({ error: 'Assessment could not be linked to this module.' }); return; }
    res.status(201).json({ message: 'Assessment linked to module.' });
  } catch { res.status(500).json({ error: 'Failed to link assessment.' }); }
});

router.get('/:id/history', requireStudent, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const assessment = await assessmentStore.getAssessment(req.params.id);
    if (!assessment) { res.status(404).json({ error: 'Assessment not found.' }); return; }
    if (!(await assessmentStore.canStudentAccessAssessment(assessment.id, req.user!.id))) { res.status(403).json({ error: 'Assessment access is no longer available.' }); return; }
    const attempts = await assessmentStore.getStudentAttempts(assessment.id, req.user!.id);
    res.json({ attempts: attempts.map((attempt) => ({ ...studentAttemptSummary(attempt, studentResultIsVisible(assessment, attempt)),
      scorePercentage: studentResultIsVisible(assessment, attempt) && assessment.totalMarks > 0 ? Number(((attempt.totalScore / assessment.totalMarks) * 100).toFixed(2)) : undefined,
      passed: studentResultIsVisible(assessment, attempt) ? attempt.totalScore >= assessment.passingMarks : undefined,
      resultsVisible: studentResultIsVisible(assessment, attempt),
    })) });
  } catch { res.status(500).json({ error: 'Failed to retrieve attempt history.' }); }
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
    const moduleLinksByAssessment = new Map<string, any[]>();
    if (assessments.length && supabaseAdmin) {
      const { data: moduleLinks, error: moduleLinksError } = await supabaseAdmin.from('module_assessment_links')
        .select('assessment_id,module_id,learning_modules(id,title,code)')
        .in('assessment_id', assessments.map((assessment) => assessment.id));
      if (moduleLinksError) throw moduleLinksError;
      for (const link of moduleLinks || []) {
        const list = moduleLinksByAssessment.get(link.assessment_id) || [];
        const rawModule: any = Array.isArray(link.learning_modules) ? link.learning_modules[0] : link.learning_modules;
        if (rawModule) {
          list.push({
            id: rawModule.id,
            title: rawModule.title,
            name: rawModule.title,
            code: rawModule.code,
          });
        }
        moduleLinksByAssessment.set(link.assessment_id, list);
      }
    }

    const items = await Promise.all(
      assessments.map(async (a) => {
        const attempts = await assessmentStore.getStudentAttempts(a.id, studentId);
        const latestAttempt = attempts[attempts.length - 1];
        const activeAttempt = attempts.find((att) => att.status === 'in_progress');

        const latestSubmittedAttempt = latestStudentSubmittedAttempt(attempts);
        const dynamicStatus = getStudentAssessmentStatus({ attempts, now: now.getTime(), startTime: a.startTime, endTime: a.endTime,
          allowedAttempts: a.allowedAttempts, resultsPublished: a.isResultsPublished, assessmentStatus: a.status });

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
          modules: moduleLinksByAssessment.get(a.id) || [],
          mentorName,
          durationMinutes: a.durationMinutes,
          totalMarks: a.totalMarks,
          passingMarks: a.passingMarks,
          passingPercentage: a.passingPercentage ?? (a.totalMarks > 0 ? Number(((a.passingMarks / a.totalMarks) * 100).toFixed(2)) : 0),
          startTime: a.startTime,
          endTime: a.endTime,
          status: dynamicStatus,
          currentAttemptId: activeAttempt?.id || latestSubmittedAttempt?.id || latestAttempt?.id,
          attemptNumber: latestAttempt?.attemptNumber || 0,
          allowedAttempts: a.allowedAttempts,
          attemptsUsed: attempts.length,
          remainingAttempts: Math.max(0, a.allowedAttempts - attempts.length),
          score: latestSubmittedAttempt && studentResultIsVisible(a, latestSubmittedAttempt) ? latestSubmittedAttempt.totalScore : undefined,
          scorePercentage: latestSubmittedAttempt && studentResultIsVisible(a, latestSubmittedAttempt) && a.totalMarks > 0 ? Number(((latestSubmittedAttempt.totalScore / a.totalMarks) * 100).toFixed(2)) : undefined,
          passed: latestSubmittedAttempt && studentResultIsVisible(a, latestSubmittedAttempt) ? latestSubmittedAttempt.totalScore >= a.passingMarks : undefined,
          isResultsPublished: a.isResultsPublished,
          resultsVisible: a.isResultsPublished && !!latestAttempt?.isEvaluated,
          attemptHistory: attempts.map((attempt) => ({
            id: attempt.id, attemptNumber: attempt.attemptNumber,
            status: !a.isResultsPublished && attempt.status === 'evaluated' ? 'submitted' : attempt.status,
            startedAt: attempt.startedAt, submittedAt: attempt.submittedAt,
            ...(studentResultIsVisible(a, attempt) ? {
              totalScore: attempt.totalScore,
              scorePercentage: a.totalMarks > 0 ? Number(((attempt.totalScore / a.totalMarks) * 100).toFixed(2)) : 0,
              passed: attempt.totalScore >= a.passingMarks,
            } : {}),
          })),
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
      passingPercentage = null,
      startTime,
      endTime,
      allowedAttempts = 1,
      assignedStudentIds = [],
      assignedCohortId = null,
      originModuleId = null,
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
    if (passingPercentage !== null && (!Number.isFinite(Number(passingPercentage)) || Number(passingPercentage) < 0 || Number(passingPercentage) > 100)) {
      res.status(400).json({ error: 'Passing percentage must be between 0 and 100.' }); return;
    }

    const mentorId = req.user!.id;
    if (originModuleId) {
      const { data: module, error: moduleError } = await supabaseAdmin!.from('learning_modules').select('id,created_by,status').eq('id', originModuleId).maybeSingle();
      if (moduleError || !module || module.created_by !== mentorId || module.status !== 'draft') {
        res.status(400).json({ error: 'Assessments can originate only from a draft module owned by this mentor.' }); return;
      }
    }

    const assessment = await assessmentStore.createAssessment({
      mentorId,
      originModuleId,
      academicTermId,
      title: title.trim(),
      description: description.trim(),
      subject: subject.trim(),
      topic: topic.trim(),
      durationMinutes: Number(durationMinutes) || 60,
      totalMarks: Number(totalMarks) || 0,
      passingMarks: Number(passingMarks) || 0,
      passingPercentage: passingPercentage === null ? null : Number(passingPercentage),
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      allowedAttempts: Number(allowedAttempts) || 1,
      status: 'draft',
      isResultsPublished: false,
    });

    if (originModuleId) {
      const { error: linkError } = await supabaseAdmin!.from('module_assessment_links').insert({ module_id: originModuleId, assessment_id: assessment.id });
      if (linkError) { await assessmentStore.deleteAssessment(assessment.id); res.status(400).json({ error: 'Assessment could not be linked to the draft module.' }); return; }
    }

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
    const isAdmin = req.user!.role === 'admin';
    const isAuthor = assessment.mentorId === req.user!.id || (isAdmin && assessment.mentorId === 'system-mentor-seed');

    if (req.user!.role === 'student') {
      const eligible = await assessmentStore.canStudentAccessAssessment(id, req.user!.id);
      if (!eligible) {
        res.status(403).json({ error: 'Access denied: You are not assigned to this assessment.' });
        return;
      }
      const attempts = await assessmentStore.getStudentAttempts(id, req.user!.id);
      if (!attempts.some((attempt) => attempt.status === 'in_progress')) {
        res.status(409).json({ error: 'Question content is available only during an active attempt.' }); return;
      }
      const questions = await assessmentStore.getStudentAssessmentQuestions(id, req.user!.id);
      res.json({ assessment: { ...assessment, questions: questions.map(studentSafeQuestion), assignments: undefined } });
      return;
    }

    if (!isAdmin && !isAuthor) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const questions = await assessmentStore.getAssessmentQuestions(id);
    const assignments = await assessmentStore.getAssessmentAssignments(id);

    // Sanitize questions for student during active examination
    const sanitizedQuestions = questions.map((q) => {
      if (isAdmin || isAuthor) {
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

    if (!canManageAssessment(existing.mentorId, req.user!.id, req.user!.role)) {
      res.status(403).json({ error: 'Forbidden: You do not own this assessment.' });
      return;
    }
    if (existing.status !== 'draft') {
      res.status(409).json({ error: 'Only draft assessments can be edited.' });
      return;
    }
    if (['status', 'isResultsPublished', 'resultsPublishedAt'].some((field) => req.body[field] !== undefined)) {
      res.status(400).json({ error: 'Assessment lifecycle and result visibility must use their dedicated workflow endpoints.' }); return;
    }
    if (req.body.mentorId || req.body.originModuleId || req.body.totalMarks !== undefined) {
      res.status(400).json({ error: 'Ownership, module association, and calculated totals cannot be changed through assessment metadata.' }); return;
    }

    // Safe editing policy: Block structural modifications if attempts have been initiated
    const submissions = await assessmentStore.getAssessmentSubmissions(id);
    if (submissions.length > 0 && req.body.durationMinutes && req.body.durationMinutes !== existing.durationMinutes) {
      res.status(400).json({
        error: 'Active attempts exist for this assessment. Structural changes (e.g., duration) are locked.',
      });
      return;
    }

    const updates = { ...req.body };
    if (updates.passingPercentage !== undefined && updates.passingPercentage !== null && (!Number.isFinite(Number(updates.passingPercentage)) || Number(updates.passingPercentage) < 0 || Number(updates.passingPercentage) > 100)) {
      res.status(400).json({ error: 'Passing percentage must be between 0 and 100.' }); return;
    }
    const updated = await assessmentStore.updateAssessment(id, updates);
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

    if (!canManageAssessment(existing.mentorId, req.user!.id, req.user!.role)) {
      res.status(403).json({ error: 'Forbidden: You do not own this assessment.' }); return;
    }
    if (existing.status !== 'draft') { res.status(409).json({ error: 'Only draft assessments can be deleted.' }); return; }

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

router.post('/:id/archive', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const existing = await assessmentStore.getAssessment(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Assessment not found.' }); return; }
    if (!canManageAssessment(existing.mentorId, req.user!.id, req.user!.role)) { res.status(403).json({ error: 'Forbidden: You do not own this assessment.' }); return; }
    if (existing.status === 'archived') { res.json({ message: 'Assessment is already archived.', assessment: existing }); return; }
    if (!['published', 'completed'].includes(existing.status)) { res.status(409).json({ error: 'Only published assessments can be archived.' }); return; }
    const archived = await assessmentStore.updateAssessment(existing.id, { status: 'archived' }, [existing.status]);
    if (!archived) { res.status(409).json({ error: 'Assessment changed during archiving. Reload and try again.' }); return; }
    res.json({ message: 'Assessment archived. Existing attempts and released results remain available in history.', assessment: archived });
  } catch (error) { console.error('[ArchiveAssessment] Error:', error); res.status(500).json({ error: 'Failed to archive assessment.' }); }
});

router.get('/:id/readiness', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const assessment = await assessmentStore.getAssessment(req.params.id);
    if (!assessment) { res.status(404).json({ error: 'Assessment not found.' }); return; }
    if (!canManageAssessment(assessment.mentorId, req.user!.id, req.user!.role)) { res.status(403).json({ error: 'Forbidden: You do not own this assessment.' }); return; }
    if (assessment.status !== 'draft') { res.status(409).json({ error: 'Readiness is available only for draft assessments.' }); return; }
    let moduleError: string | null = null;
    const workflow = await verifyDraftModuleWorkflow(assessment.id, req.user!.id, req.user!.role);
    if (!workflow.ok) moduleError = workflow.error;
    const questions = await assessmentStore.getAssessmentQuestions(assessment.id);
    const { data: pending, error } = await supabaseAdmin!.from('assessment_questions').select('id')
      .eq('assessment_id', assessment.id).not('generation_job_id', 'is', null).is('removed_at', null)
      .or('is_approved.eq.false,approved_by.is.null,approved_at.is.null');
    if (error) throw error;
    const orderById = new Map(questions.map(question => [question.id, question.questionOrder]));
    const readiness = validateDraftReadiness({ assessment, questions, moduleError, pendingAiQuestionOrders: (pending || []).map((question: any) => orderById.get(question.id) || 0) });
    res.json(readiness);
  } catch (error) { console.error('[AssessmentReadiness] Error:', error); res.status(500).json({ error: 'Failed to check assessment readiness.' }); }
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

    if (!canManageAssessment(existing.mentorId, req.user!.id, req.user!.role)) { res.status(403).json({ error: 'Forbidden: You do not own this assessment.' }); return; }
    if (existing.status !== 'draft') { res.status(409).json({ error: 'Only draft assessments can be published.' }); return; }
    const workflow=await verifyDraftModuleWorkflow(existing.id,req.user!.id,req.user!.role);

    const questions = await assessmentStore.getAssessmentQuestions(id);
    const { data: pendingApproval, error: approvalError } = await supabaseAdmin!.from('assessment_questions').select('id')
      .eq('assessment_id', id).not('generation_job_id', 'is', null).is('removed_at', null)
      .or('is_approved.eq.false,approved_by.is.null,approved_at.is.null').limit(1);
    if (approvalError) throw approvalError;
    const orderById = new Map(questions.map(question => [question.id, question.questionOrder]));
    const readiness = validateDraftReadiness({ assessment: existing, questions, moduleError: workflow.ok ? null : workflow.error,
      pendingAiQuestionOrders: (pendingApproval || []).map((question: any) => orderById.get(question.id) || 0) });
    if (!readiness.ready) { res.status(400).json({ error: 'Assessment is not ready to publish.', issues: readiness.issues }); return; }

    const sumMarks = readiness.totalMarks;

    // Match Phase 5C.1 assessment_required_marks: ceil(total * percent) / 100.
    const requiredMarks = existing.passingPercentage == null ? existing.passingMarks : Math.ceil(sumMarks * existing.passingPercentage) / 100;
    const updated = await assessmentStore.updateAssessment(id, {
      status: 'published',
      totalMarks: sumMarks,
      passingMarks: requiredMarks,
    }, ['draft']);
    if (!updated) { res.status(409).json({ error: 'Assessment changed during publication. Recheck readiness and try again.' }); return; }

    // Ensure active mentees of this mentor are assigned to the published assessment
    try {
      const { data: mentees } = await supabaseAdmin!
        .from('mentor_assignments')
        .select('student_id')
        .eq('mentor_id', existing.mentorId)
        .eq('is_active', true);
      if (mentees && mentees.length > 0) {
        const assignmentsToInsert = mentees.map((m: any) => ({
          assessment_id: id,
          student_id: m.student_id,
        }));
        await supabaseAdmin!.from('assessment_assignments').upsert(assignmentsToInsert, {
          onConflict: 'assessment_id,student_id',
          ignoreDuplicates: true,
        });
      }
    } catch (syncErr: any) {
      console.warn('[PublishAssessment] Mentee sync notice:', syncErr?.message);
    }

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

    if (!canManageAssessment(existing.mentorId, req.user!.id, req.user!.role)) { res.status(403).json({ error: 'Forbidden: You do not own this assessment.' }); return; }
    if (existing.status !== 'draft') { res.status(409).json({ error: 'Only draft assessments can be changed.' }); return; }
    const workflow=await verifyDraftModuleWorkflow(existing.id,req.user!.id,req.user!.role); if(!workflow.ok){res.status(workflow.status).json({error:workflow.error});return;}
    const validation = validateQuestion({ questionType, questionText, marks: Number(marks), options });
    if (validation) { res.status(400).json({ error: validation }); return; }

    const currentQuestions = await assessmentStore.getAssessmentQuestions(id);
    const questionOrder = currentQuestions.length + 1;

    const question = await assessmentStore.addQuestion({
      assessmentId: id,
      questionOrder,
      questionType,
      questionText: questionText.trim(),
      marks: Number(marks),
      evaluationGuidance: evaluationGuidance?.trim(),
      explanation: explanation?.trim(),
      options,
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
    const parent = await assessmentStore.getAssessment(id);
    if (!parent) { res.status(404).json({ error: 'Assessment not found.' }); return; }
    if (parent.mentorId !== req.user!.id && req.user!.role !== 'admin') { res.status(403).json({ error: 'Forbidden.' }); return; }
    if (parent.status !== 'draft') { res.status(409).json({ error: 'Only draft questions can be changed.' }); return; }
    const workflow=await verifyDraftModuleWorkflow(parent.id,req.user!.id,req.user!.role); if(!workflow.ok){res.status(workflow.status).json({error:workflow.error});return;}
    const allowed=['questionType','questionText','marks','evaluationGuidance','explanation','options','difficulty','cognitiveLevel','topic'];
    if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).some((field)=>!allowed.includes(field))){res.status(400).json({error:'Question update payload contains unsupported fields.'});return;}
    const oldQuestion = (await assessmentStore.getAssessmentQuestions(id)).find((q) => q.id === questionId);
    if (!oldQuestion) { res.status(404).json({ error: 'Question not found.' }); return; }
    const merged = { ...oldQuestion, ...req.body, options: req.body.options ?? oldQuestion.options };
    const validation = validateQuestion(merged as any);
    if (validation) { res.status(400).json({ error: validation }); return; }
    for(const field of ['questionText','evaluationGuidance','explanation','difficulty','cognitiveLevel','topic']) if(req.body[field]!==undefined&&req.body[field]!==null&&typeof req.body[field]!=='string'){res.status(400).json({error:`${field} must be text.`});return;}
    if(req.body.marks!==undefined&&(!Number.isFinite(Number(req.body.marks))||Number(req.body.marks)<=0||Number(req.body.marks)>999.99)){res.status(400).json({error:'Marks must be greater than zero and no more than 999.99.'});return;}
    if(req.body.difficulty!==undefined&&req.body.difficulty!==null&&!['easy','medium','hard'].includes(req.body.difficulty)){res.status(400).json({error:'Difficulty must be easy, medium or hard.'});return;}
    if(req.body.cognitiveLevel!==undefined&&req.body.cognitiveLevel!==null&&!['remember','understand','apply','analyze','evaluate','create'].includes(req.body.cognitiveLevel)){res.status(400).json({error:'Cognitive level is invalid.'});return;}
    if(req.body.topic!==undefined&&req.body.topic!==null&&req.body.topic.length>120){res.status(400).json({error:'Topic must be 120 characters or fewer.'});return;}
    if(req.body.options!==undefined&&(!Array.isArray(req.body.options)||req.body.options.length>6||req.body.options.some((o:any)=>!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some((key)=>!['id','questionId','optionText','optionOrder','isCorrect'].includes(key))||typeof o.optionText!=='string'||typeof o.isCorrect!=='boolean'||(o.optionOrder!==undefined&&!Number.isInteger(o.optionOrder))))){res.status(400).json({error:'Options must contain valid text, order and correct-answer flags.'});return;}
    if(req.body.options!==undefined&&req.body.options.some((o:any,i:number)=>o.optionOrder!==undefined&&o.optionOrder!==i+1)){res.status(400).json({error:'Option order must be contiguous and match the submitted order.'});return;}
    const {data:metadata,error:metadataError}=await supabaseAdmin!.from('assessment_questions').select('generation_difficulty,generation_cognitive_level,generation_topic').eq('id',questionId).maybeSingle();
    if(metadataError||!metadata){res.status(404).json({error:'Question not found.'});return;}
    const {data:changed,error:editError}=await supabaseAdmin!.rpc('save_reviewed_assessment_question',{
      p_assessment_id:id,p_question_id:questionId,p_actor_id:req.user!.id,p_type:merged.questionType,p_text:merged.questionText,
      p_marks:Number(merged.marks),p_explanation:merged.explanation??null,p_guidance:merged.evaluationGuidance??null,
      p_difficulty:req.body.difficulty??metadata.generation_difficulty,p_cognitive:req.body.cognitiveLevel??metadata.generation_cognitive_level,
      p_topic:req.body.topic??metadata.generation_topic,
      p_options:(merged.options||[]).map((option:any,index:number)=>({optionText:option.optionText,optionOrder:option.optionOrder||index+1,isCorrect:!!option.isCorrect}))
    });
    if(editError)throw editError;
    if(changed!==true){res.status(404).json({error:'Question was not updated.'});return;}
    const updated=(await assessmentStore.getAssessmentQuestions(id)).find((question)=>question.id===questionId);
    if(!updated){res.status(404).json({error:'Question not found.'});return;}
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
    const parent = await assessmentStore.getAssessment(id);
    if (!parent) { res.status(404).json({ error: 'Assessment not found.' }); return; }
    if (parent.mentorId !== req.user!.id && req.user!.role !== 'admin') { res.status(403).json({ error: 'Forbidden.' }); return; }
    if (parent.status !== 'draft') { res.status(409).json({ error: 'Only draft questions can be deleted.' }); return; }
    const workflow=await verifyDraftModuleWorkflow(parent.id,req.user!.id,req.user!.role); if(!workflow.ok){res.status(workflow.status).json({error:workflow.error});return;}
    const targetQuestion=(await assessmentStore.getAssessmentQuestions(id)).find((question) => question.id === questionId); if (!targetQuestion) { res.status(404).json({ error: 'Question not found.' }); return; }
    if(targetQuestion&&await isAiGeneratedQuestion(questionId)){res.status(409).json({error:'AI-generated questions must be removed through the audited rejection workflow.'});return;}
    const {data:deleted,error:deleteError}=await supabaseAdmin!.rpc('delete_manual_assessment_question',{p_assessment_id:id,p_question_id:questionId,p_actor_id:req.user!.id});
    if(deleteError)throw deleteError;
    if (deleted!==true) {
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
    const parent = await assessmentStore.getAssessment(id);
    if (!parent) { res.status(404).json({ error: 'Assessment not found.' }); return; }
    if (parent.mentorId !== req.user!.id && req.user!.role !== 'admin') { res.status(403).json({ error: 'Forbidden.' }); return; }
    if (parent.status !== 'draft') { res.status(409).json({ error: 'Only draft questions can be reordered.' }); return; }
    const workflow=await verifyDraftModuleWorkflow(parent.id,req.user!.id,req.user!.role); if(!workflow.ok){res.status(workflow.status).json({error:workflow.error});return;}
    const currentIds = (await assessmentStore.getAssessmentQuestions(id)).map((question) => question.id);
    if (orderedQuestionIds.length !== currentIds.length || new Set(orderedQuestionIds).size !== currentIds.length || orderedQuestionIds.some((qid: string) => !currentIds.includes(qid))) {
      res.status(400).json({ error: 'Question order must contain every assessment question exactly once.' }); return;
    }
    const {data:reordered,error:reorderError}=await supabaseAdmin!.rpc('reorder_review_assessment_questions',{p_assessment_id:id,p_actor_id:req.user!.id,p_question_ids:orderedQuestionIds});
    if(reorderError)throw reorderError;
    if(reordered!==true){res.status(409).json({error:'Question order could not be updated.'});return;}
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
    if (assessment.mentorId !== req.user!.id && req.user!.role !== 'admin') { res.status(403).json({ error: 'Forbidden.' }); return; }

    const requestedLimit = Number.parseInt(String(req.query.limit ?? '50'), 10);
    const requestedOffset = Number.parseInt(String(req.query.offset ?? '0'), 10);
    const pageLimit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
    const pageOffset = Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0;
    const { attempts: submissions, total: submissionCount } = await assessmentStore.getAssessmentSubmissionsPage(id, pageLimit, pageOffset);

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
          scorePercentage: assessment.totalMarks > 0 ? Number(((sub.totalScore / assessment.totalMarks) * 100).toFixed(2)) : 0,
          passingMarks: assessment.passingMarks,
          passed: sub.isEvaluated && sub.totalScore >= assessment.passingMarks,
          isEvaluated: sub.isEvaluated,
          isResultsPublished: assessment.isResultsPublished,
        };
      })
    );

    res.json({ submissions: enriched, assessmentTitle: assessment.title, totalMarks: assessment.totalMarks, pagination: { limit: pageLimit, offset: pageOffset, total: submissionCount } });
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
    if (!assessment || (assessment.mentorId !== req.user!.id && req.user!.role !== 'admin')) { res.status(403).json({ error: 'Forbidden.' }); return; }
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

    const targetAttempt = await assessmentStore.getAttempt(attemptId);
    const parent = targetAttempt ? await assessmentStore.getAssessment(targetAttempt.assessmentId) : null;
    if (!parent || (parent.mentorId !== req.user!.id && req.user!.role !== 'admin')) { res.status(403).json({ error: 'Forbidden.' }); return; }
    if (parent.isResultsPublished) { res.status(409).json({ error: 'Published results are immutable.' }); return; }
    if (!['submitted', 'evaluated'].includes(targetAttempt!.status)) { res.status(409).json({ error: 'Only submitted attempts can be evaluated.' }); return; }
    const questionSet = await assessmentStore.getAssessmentQuestions(parent.id);
    const descriptive = questionSet.filter((q) => q.questionType === 'descriptive');
    if (!Array.isArray(evaluations) || new Set(evaluations.map((item: any) => item.questionId)).size !== evaluations.length || evaluations.some((item: any) => {
      const question = descriptive.find((candidate) => candidate.id === item.questionId);
      return !question || !Number.isFinite(Number(item.marksObtained)) || Number(item.marksObtained) < 0 || Number(item.marksObtained) > question.marks;
    })) { res.status(400).json({ error: 'Evaluation contains an invalid question or mark value.' }); return; }

    const evaluated = await assessmentStore.evaluateAttempt(
      attemptId,
      req.user!.id,
      evaluations,
      generalFeedback,
      req.user!.role === 'admin',
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
    if (!canManageAssessment(existing.mentorId, req.user!.id, req.user!.role)) { res.status(403).json({ error: 'Forbidden.' }); return; }
    if (!['published', 'completed'].includes(existing.status)) { res.status(409).json({ error: 'Only published assessments can have results released.' }); return; }
    if (existing.isResultsPublished) { res.json({ message: 'Assessment results are already published.', assessment: existing }); return; }

    const submissionsBeforeRelease = await assessmentStore.getAssessmentLifecycleAttempts(id);
    const pendingEvaluations = attemptsBlockingResultReleaseCount(submissionsBeforeRelease);
    if (pendingEvaluations) {
      res.status(409).json({ error: `${pendingEvaluations} active or unevaluated attempt${pendingEvaluations === 1 ? ' must be' : 's must be'} submitted and evaluated before results are released.` }); return;
    }

    // Set publication timestamp on initial publication; do not overwrite on duplicate requests
    const resultsPublishedAt = existing.resultsPublishedAt || new Date().toISOString();

    const updated = await assessmentStore.updateAssessment(id, {
      isResultsPublished: true,
      status: 'completed',
      resultsPublishedAt,
    }, [existing.status], false);

    if (!updated) {
      const current = await assessmentStore.getAssessment(id);
      if (current?.isResultsPublished) { res.json({ message: 'Assessment results are already published.', assessment: current }); return; }
      res.status(409).json({ error: 'Assessment changed during result release. Reload and try again.' });
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

    const eligible = await assessmentStore.canStudentAccessAssessment(id, studentId);
    if (!eligible) {
      res.status(403).json({ error: 'You are not assigned to this assessment.' });
      return;
    }

    const previousAttempts = await assessmentStore.getStudentAttempts(id, studentId);
    // Resume an existing attempt even after the assessment window/status changes.
    // New attempts still go through the atomic server-side start RPC.
    const attempt = await resumeOrStartAttempt(previousAttempts, assessment.status, () => assessmentStore.startAttempt(id, studentId));

    // Retrieve questions with answer options (sanitized: NO correct answer leaks)
    const questions = await assessmentStore.getStudentAssessmentQuestions(id, studentId);
    const sanitizedQuestions = questions.map(studentSafeQuestion);

    const savedAnswers = await assessmentStore.getAttemptAnswers(attempt.id);

    // Calculate remaining seconds
    const elapsedSeconds = Math.floor((Date.now() - new Date(attempt.startedAt).getTime()) / 1000);
    const durationRemaining = assessment.durationMinutes * 60 - elapsedSeconds;
    const scheduleRemaining = Math.floor((new Date(assessment.endTime).getTime() - Date.now()) / 1000);
    const remainingSeconds = Math.max(0, Math.min(durationRemaining, scheduleRemaining));

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
      answers: savedAnswers.map(studentAnswerDraft),
      remainingSeconds,
    });
  } catch (err: any) {
    console.error('[StartAttempt] Error:', err);
    const message = typeof err?.message === 'string' ? err.message : '';
    if (message === 'Attempt limit reached.' || message === 'Assessment is outside its availability window.' || message === 'Assessment is not open for testing.') {
      res.status(409).json({ error: message }); return;
    }
    if (message === 'Assessment is not available to this student.') { res.status(403).json({ error: message }); return; }
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
    if (!(await assessmentStore.canStudentAccessAssessment(attempt.assessmentId, studentId))) { res.status(403).json({ error: 'Assessment access is no longer available.' }); return; }
    if (attempt.status !== 'in_progress') { res.status(409).json({ error: 'Question content is available only during an active attempt.' }); return; }

    const assessment = await assessmentStore.getAssessment(attempt.assessmentId);
    if (!assessment) {
      res.status(404).json({ error: 'Parent assessment not found.' });
      return;
    }

    const questions = await assessmentStore.getStudentAssessmentQuestions(attempt.assessmentId, studentId);
    const sanitizedQuestions = questions.map(studentSafeQuestion);

    const savedAnswers = await assessmentStore.getAttemptAnswers(attempt.id);

    const elapsedSeconds = Math.floor((Date.now() - new Date(attempt.startedAt).getTime()) / 1000);
    const durationRemaining = assessment.durationMinutes * 60 - elapsedSeconds;
    const scheduleRemaining = Math.floor((new Date(assessment.endTime).getTime() - Date.now()) / 1000);
    const remainingSeconds = Math.max(0, Math.min(durationRemaining, scheduleRemaining));

    res.json({
      attempt: studentAttemptSummary(attempt),
      assessment: {
        id: assessment.id,
        title: assessment.title,
        subject: assessment.subject,
        durationMinutes: assessment.durationMinutes,
        totalMarks: assessment.totalMarks,
      },
      questions: sanitizedQuestions,
      answers: savedAnswers.map(studentAnswerDraft),
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
    if (attempt.status !== 'in_progress' || !(await assessmentStore.canStudentAccessAssessment(attempt.assessmentId, studentId))) { res.status(403).json({ error: 'Attempt is not accessible.' }); return; }

    const answers = await assessmentStore.getAttemptAnswers(attemptId);
    const sanitized = answers.map((a) => ({
      id: a.id,
      attemptId: a.attemptId,
      questionId: a.questionId,
      selectedOptionId: a.selectedOptionId,
      selectedOptionIds: a.selectedOptionIds,
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
    const { questionId, selectedOptionId, selectedOptionIds, descriptiveAnswer } = req.body;

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (typeof questionId !== 'string' || !uuidPattern.test(questionId)
      || (selectedOptionId !== undefined && selectedOptionId !== null && (typeof selectedOptionId !== 'string' || !uuidPattern.test(selectedOptionId)))
      || (selectedOptionIds !== undefined && (!Array.isArray(selectedOptionIds) || selectedOptionIds.some((value: unknown) => typeof value !== 'string' || !uuidPattern.test(value)) || new Set(selectedOptionIds).size !== selectedOptionIds.length))
      || (descriptiveAnswer !== undefined && descriptiveAnswer !== null && typeof descriptiveAnswer !== 'string')
      || (descriptiveAnswer != null && (selectedOptionId != null || (selectedOptionIds?.length ?? 0) > 0))) {
      res.status(400).json({ error: 'Answer format is invalid.' }); return;
    }

    const attempt = await assessmentStore.getAttempt(attemptId);
    if (!attempt || attempt.studentId !== studentId) {
      res.status(403).json({ error: 'Unauthorized attempt access.' });
      return;
    }
    if (!(await assessmentStore.canStudentAccessAssessment(attempt.assessmentId, studentId))) { res.status(403).json({ error: 'Assessment access is no longer available.' }); return; }

    if (attempt.status !== 'in_progress') {
      res.status(400).json({ error: 'Cannot modify answers for an already submitted attempt.' });
      return;
    }

    const saved = await assessmentStore.saveAnswer(attemptId, questionId, {
      selectedOptionId,
      selectedOptionIds,
      descriptiveAnswer,
    });

    res.json({ message: 'Answer saved successfully.', answer: studentAnswerDraft(saved) });
  } catch (err: any) {
    console.error('[SaveAnswer] Error:', err);
    if (err?.message === 'Attempt has expired.' || err?.message === 'Attempt is no longer active.') { res.status(409).json({ error: err.message }); return; }
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

    if (!(await assessmentStore.canStudentAccessAssessment(attempt.assessmentId, studentId))) { res.status(403).json({ error: 'Assessment access is no longer available.' }); return; }

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
    if (!(await assessmentStore.canStudentAccessAssessment(attempt.assessmentId, studentId)) || !['submitted', 'evaluated'].includes(attempt.status)) { res.status(403).json({ error: 'Review is not available for this attempt.' }); return; }

    const assessment = await assessmentStore.getAssessment(attempt.assessmentId);
    if (!assessment) {
      res.status(404).json({ error: 'Assessment not found.' });
      return;
    }

    // If results are NOT yet published, do not expose correct answers or scores
    if (!assessment.isResultsPublished || !attempt.isEvaluated) {
      res.json({
        isResultsPublished: false,
        message: 'Evaluation is in progress. Official scores and feedback will be visible once published by your mentor.',
        attempt: {
          id: attempt.id,
          status: attempt.status === 'evaluated' ? 'submitted' : attempt.status,
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
      attempt: studentAttemptSummary(attempt, true),
      assessment: { id: assessment.id, title: assessment.title, subject: assessment.subject, totalMarks: assessment.totalMarks, passingMarks: assessment.passingMarks },
      result: { scorePercentage: assessment.totalMarks > 0 ? Number(((attempt.totalScore / assessment.totalMarks) * 100).toFixed(2)) : 0, requiredMarks: assessment.passingMarks, passed: attempt.totalScore >= assessment.passingMarks },
      questionReviewAvailable: false,
      aiFeedback,
    });
  } catch (err: any) {
    console.error('[ReviewAttempt] Error:', err);
    res.status(500).json({ error: 'Failed to load assessment review.' });
  }
});

export default router;


import { Router, Response } from 'express';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth.js';
import { AssessmentGenerationError, AssessmentQuestionGenerationEngine, validateGenerationRequest } from '../services/assessmentQuestionGeneration.js';
import { groqAssessmentQuestionService } from '../services/groqAssessmentQuestionService.js';
import { SupabaseAssessmentQuestionGenerationRepository } from '../services/assessmentQuestionGenerationStore.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import crypto from 'node:crypto';

const router = Router();
const engine = new AssessmentQuestionGenerationEngine(groqAssessmentQuestionService, new SupabaseAssessmentQuestionGenerationRepository());

router.post('/:assessmentId/modules/:moduleId/generate-questions', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== 'mentor') { res.status(403).json({ error: 'Only the owning mentor can generate assessment questions.' }); return; }
  try {
    const request = validateGenerationRequest(req.body, req.params.assessmentId, req.params.moduleId);
    const result = await engine.generate(req.user.id, request);
    res.status(200).json({ generation: { jobId: result.jobId, status: result.status }, questions: result.questions });
  } catch (error) {
    if (error instanceof AssessmentGenerationError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
    const status = error instanceof Error && error.message === 'generation_not_authorized' ? 404 :
      error instanceof Error && error.message === 'generation_source_unavailable' ? 404 : 503;
    res.status(status).json({ error: status === 404 ? 'Assessment, module, or source documents are unavailable for draft generation.' : 'Question generation is temporarily unavailable.' });
  }
});

router.post('/:assessmentId/questions/:questionId/regenerate',requireAuth,async(req:AuthenticatedRequest,res:Response)=>{
  const actor=req.user; if(!actor||!['mentor','admin'].includes(actor.role)){res.status(403).json({error:'Mentor authorization is required.'});return;}
  try{
    const key=req.body?.idempotencyKey;
    if(typeof key!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(key)){res.status(400).json({error:'A UUID idempotencyKey is required.'});return;}
    const {data:q,error:qError}=await supabaseAdmin!.from('assessment_questions').select('id,assessment_id,generation_job_id,generation_difficulty,generation_cognitive_level,generation_topic,marks,question_type,removed_at').eq('id',req.params.questionId).eq('assessment_id',req.params.assessmentId).maybeSingle();
    if(qError||!q){res.status(404).json({error:'Question not found.'});return;} if(!q.generation_job_id){res.status(409).json({error:'Only AI-generated questions can be regenerated.'});return;}
    const {data:job,error:jobError}=await supabaseAdmin!.from('assessment_question_generation_jobs').select('module_id,selected_sources,request_metadata').eq('id',q.generation_job_id).maybeSingle();
    if(jobError||!job){res.status(409).json({error:'Original generation constraints are unavailable.'});return;}
    const {data:leaseData,error:leaseError}=await supabaseAdmin!.rpc('begin_assessment_question_regeneration',{p_assessment_id:q.assessment_id,p_question_id:q.id,p_actor_id:actor.id,p_key:key});
    if(leaseError){const busy=leaseError.message?.includes('regeneration_in_progress');res.status(busy?409:403).json({error:busy?'A regeneration is already in progress.':'Question regeneration is not authorized.'});return;}
    const lease=Array.isArray(leaseData)?leaseData[0]:leaseData;
    const selected=lease?.selected_sources as Array<{documentId:string;rangeKind:string;ranges:Array<{start:number;end:number}>}>;
    if(!lease?.job_id||!lease.lease_token||!Array.isArray(selected)){res.status(503).json({error:'Regeneration lease unavailable.'});return;}
    const {data:leaseState,error:stateError}=await supabaseAdmin!.from('assessment_question_regenerations').select('status,candidate').eq('id',lease.job_id).maybeSingle();
    if(stateError)throw stateError;
    if(leaseState?.status==='completed'){res.json({message:'Question was already regenerated for this request.',questionId:q.id,question:leaseState.candidate});return;}
    const type=q.question_type;
    if(!['mcq','multiple_select','true_false'].includes(type)){await supabaseAdmin!.rpc('fail_assessment_question_regeneration',{p_job_id:lease.job_id,p_lease:lease.lease_token,p_actor_id:actor.id,p_error:'unsupported_question_type'});res.status(409).json({error:'This generated question type cannot be regenerated safely.'});return;}
    const counts={mcq:type==='mcq'?1:0,multiple_select:type==='multiple_select'?1:0,true_false:type==='true_false'?1:0};
    const diff=q.generation_difficulty||'medium'; const dist={easy:diff==='easy'?1:0,medium:diff==='medium'?1:0,hard:diff==='hard'?1:0};
    const metadata=lease.request_metadata||{};
    const request=validateGenerationRequest({assessmentId:q.assessment_id,moduleId:job.module_id,idempotencyKey:crypto.randomUUID(),documents:selected.map(s=>({documentId:s.documentId,ranges:s.ranges})),questionCounts:counts,difficultyDistribution:dist,
      cognitiveLevels:[q.generation_cognitive_level||metadata.cognitiveLevels?.[0]||'understand'],topicCoverage:[q.generation_topic||metadata.topicCoverage?.[0]||'General'],additionalInstructions:'Regenerate only this question using its original selected source material. Preserve its pedagogical intent and use the original marks value.'},q.assessment_id,job.module_id);
    try{
      const {data:owner}=await supabaseAdmin!.from('assessments').select('mentor_id').eq('id',q.assessment_id).maybeSingle();
      const candidates=await engine.generateCandidate(owner?.mentor_id||actor.id,request); const candidate={...candidates[0],marks:Number(q.marks)};
      const {data:completed,error:completeError}=await supabaseAdmin!.rpc('complete_assessment_question_regeneration',{p_job_id:lease.job_id,p_lease:lease.lease_token,p_candidate:candidate,p_model:groqAssessmentQuestionService.getValidatedModel()});
      if(completeError||completed!==true)throw new Error('regeneration_persist_failed');
      res.json({message:'Question regenerated and returned to pending approval.',questionId:q.id,question:candidate});
    }catch(error){await supabaseAdmin!.rpc('fail_assessment_question_regeneration',{p_job_id:lease.job_id,p_lease:lease.lease_token,p_actor_id:actor.id,p_error:error instanceof AssessmentGenerationError?error.code:'regeneration_failed'});throw error;}
  }catch(error){if(error instanceof AssessmentGenerationError){res.status(error.status).json({error:error.message,code:error.code});return;}res.status(502).json({error:'Question regeneration failed; the existing question remains unchanged.'});}
});

export default router;

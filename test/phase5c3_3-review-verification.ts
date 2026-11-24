import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssessmentQuestionGenerationEngine, validateGenerationRequest } from '../server/src/services/assessmentQuestionGeneration.js';

const migration=readFileSync('supabase/migrations/drafts/phase5c3_3_mentor_question_review.sql','utf8');
const phase5c2=readFileSync('supabase/migrations/drafts/phase5c2_atomic_assessment_attempts.sql','utf8');
const routes=readFileSync('server/src/routes/assessmentRoutes.ts','utf8');
const store=readFileSync('server/src/services/assessmentStore.ts','utf8');
const generationRoutes=readFileSync('server/src/routes/assessmentGenerationRoutes.ts','utf8');
const ui=readFileSync('src/features/mentor/Assessments.tsx','utf8');

// These are source-contract checks, not live PostgreSQL/RLS/concurrency tests.
assert.match(migration,/CREATE OR REPLACE FUNCTION public\.approve_assessment_question[\s\S]*?INSERT INTO public\.assessment_question_revisions/);
assert.match(migration,/CREATE OR REPLACE FUNCTION public\.reject_assessment_question[\s\S]*?UPDATE public\.assessments SET total_marks/);
assert.match(migration,/trg_invalidate_ai_approval_option_change/);
assert.match(migration,/trg_guard_assessment_option_draft/);
assert.match(migration,/status='completed'[\s\S]*?candidate=p_candidate/);
assert.match(migration,/trg_guard_assessment_question_publication/);
assert.match(migration,/OLD\.removed_at IS NOT NULL AND NEW\.removed_at IS NULL/);
assert.match(migration,/mentor_edited_at=now\(\),updated_at=now\(\)/);
assert.match(migration,/UPDATE public\.assessment_questions SET updated_at=now\(\) WHERE id=qid/);
assert.match(migration,/assessment_student_is_eligible\(uuid,uuid\)/i);
assert.match(phase5c2,/CREATE OR REPLACE FUNCTION public\.assessment_student_is_eligible\(p_assessment_id UUID, p_student_id UUID\)/);
assert.match(migration,/public\.assessment_student_is_eligible\(p_assessment_id,p_student_id\)/);
assert.match(migration,/q\.assessment_id=p_assessment_id AND q\.removed_at IS NULL/);
assert.match(store,/async getStudentAssessmentQuestions[\s\S]*?rpc\('student_assessment_content_for_backend'/);
assert.match(routes,/assessmentStore\.getStudentAssessmentQuestions\(id, req\.user!\.id\)/);
assert.match(store,/touchQuestionError/);
assert.match(migration,/assessment_review_actor_allowed\(p_actor_id,a\.mentor_id\)/);
assert.match(migration,/linked draft module owned by the assessment mentor/i);
const regenBegin=migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.begin_assessment_question_regeneration'),migration.indexOf('CREATE OR REPLACE FUNCTION public.fail_assessment_question_regeneration'));
const beginLockOrder=[regenBegin.indexOf('FROM public.assessment_options WHERE question_id=p_question_id ORDER BY id FOR UPDATE'),regenBegin.indexOf('FROM public.assessment_questions WHERE id=p_question_id AND assessment_id=p_assessment_id FOR UPDATE'),regenBegin.indexOf('FROM public.assessments WHERE id=p_assessment_id FOR UPDATE'),regenBegin.indexOf('FOR UPDATE OF lm'),regenBegin.indexOf('FROM public.assessment_question_regenerations WHERE question_id=p_question_id AND idempotency_key=p_key FOR UPDATE')];
assert.ok(beginLockOrder.every((p)=>p>=0)&&beginLockOrder.every((p,i)=>i===0||beginLockOrder[i-1]<p),'regeneration begin follows option → question → assessment → module → job locks');
const regenComplete=migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.complete_assessment_question_regeneration'),migration.indexOf('REVOKE ALL ON FUNCTION public.assessment_question_review_snapshot'));
const completeLockOrder=[regenComplete.indexOf('FROM public.assessment_options WHERE question_id=j.question_id ORDER BY id FOR UPDATE'),regenComplete.indexOf('FROM public.assessment_questions WHERE id=j.question_id AND assessment_id=j.assessment_id FOR UPDATE'),regenComplete.indexOf('FROM public.assessments WHERE id=j.assessment_id FOR UPDATE'),regenComplete.indexOf('FROM public.learning_modules WHERE id=j.module_id FOR UPDATE'),regenComplete.indexOf('FROM public.assessment_question_regenerations WHERE id=p_job_id FOR UPDATE')];
assert.ok(completeLockOrder.every((p)=>p>=0)&&completeLockOrder.every((p,i)=>i===0||completeLockOrder[i-1]<p),'regeneration completion uses the same global lock order');
assert.match(routes,/rpc\('approve_assessment_question'/);
assert.match(routes,/rpc\('reject_assessment_question'/);
assert.match(routes,/verifyDraftModuleWorkflow/);
assert.match(migration,/assessment_question_review_snapshot\(q\.id\)/);
assert.match(migration,/openai\/gpt-oss-120b/);
assert.match(generationRoutes,/regenerate/);
assert.match(generationRoutes,/begin_assessment_question_regeneration/);
assert.match(generationRoutes,/complete_assessment_question_regeneration/);
assert.match(generationRoutes,/leaseState\?\.status==='completed'/);
assert.match(generationRoutes,/groqAssessmentQuestionService\.getValidatedModel\(\)/);
assert.match(ui,/Question review/);
assert.match(ui,/Regenerate/);
assert.match(ui,/Pending approval/);

let persistCalled=false;
const id='11111111-1111-4111-8111-111111111111';
const moduleId='22222222-2222-4222-8222-222222222222';
const doc='33333333-3333-4333-8333-333333333333';
const request=validateGenerationRequest({assessmentId:id,moduleId,idempotencyKey:'44444444-4444-4444-8444-444444444444',documents:[{documentId:doc,ranges:[{start:1,end:1}]}],questionCounts:{mcq:1,multiple_select:0,true_false:0},difficultyDistribution:{easy:1,medium:0,hard:0},cognitiveLevels:['understand'],topicCoverage:['Hashing']},id,moduleId);
const engine=new AssessmentQuestionGenerationEngine({getValidatedModel(){return 'openai/gpt-oss-120b';},isAllowedResponseModel(model:string){return model==='openai/gpt-oss-120b';},async generateAssessmentQuestions(){return {questions:[{questionType:'mcq',questionText:'What does hashing use to support lookup?',options:[{text:'Hash function',isCorrect:true},{text:'Sorting network',isCorrect:false}],explanation:'A hash function supports lookup.',marks:1,difficulty:'easy',cognitiveLevel:'understand',topic:'Hashing',sourceReferences:[{documentId:doc,rangeKind:'line',locationStart:1,locationEnd:1}]}],actualModel:'openai/gpt-oss-120b',latencyMs:1};}} as any,{
  async authorizeAndLoadSources(){return {sources:[{id:doc,original_filename:'lesson.txt',extraction_status:'ready',extraction_range_kind:'line',extraction_units:[{number:1,text:'Hashing stores data using a hash function and supports lookup.'}]}]};},
  async begin(){throw new Error('candidate path must not create a normal generation job');},
  async persist(){persistCalled=true;throw new Error('candidate path must not persist a second question');},
  async fail(){},async getCompletedQuestions(){return[];},
});
const candidates=await engine.generateCandidate('55555555-5555-4555-8555-555555555555',request);
assert.equal(candidates.length,1);
assert.equal(candidates[0].questionType,'mcq');
assert.equal(persistCalled,false,'regeneration candidate validation must not persist before atomic replacement');
console.log('Phase 5C.3.3 local review contracts and regeneration candidate validation passed (no live Supabase/PostgreSQL test)');

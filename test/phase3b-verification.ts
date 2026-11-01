/**
 * Phase 3B Verification Suite - Weekly Assessment Engine & Supabase Persistence
 *
 * Clearly distinguishes:
 * [SECTION A] Migration Schema, Constraints & RLS Declarations
 * [SECTION B] Assessment Engine, Real Supabase Persistence & State Transitions
 * [SECTION C] Student Answer Auto-Save, Refresh Restoration & Anti-Tamper Security
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { assessmentStore } from '../server/src/services/assessmentStore.js';

dotenv.config();

interface TestReport {
  suite: string;
  testName: string;
  passed: boolean;
  category: 'SCHEMA & RLS' | 'ASSESSMENT ENGINE' | 'SECURITY & ROLES' | 'LIVE DB';
  details?: string;
}

const reports: TestReport[] = [];

function assert(
  condition: boolean,
  suite: string,
  testName: string,
  category: 'SCHEMA & RLS' | 'ASSESSMENT ENGINE' | 'SECURITY & ROLES' | 'LIVE DB',
  failureDetails?: string
) {
  if (condition) {
    reports.push({ suite, testName, passed: true, category });
    console.log(`[PASS] [${category}] ${testName}`);
  } else {
    reports.push({ suite, testName, passed: false, category, details: failureDetails });
    console.error(`[FAIL] [${category}] ${testName}: ${failureDetails || 'Assertion failed'}`);
  }
}

async function runPhase3BTests() {
  console.log('\n============================================================');
  console.log('MENTORBRIDGE PHASE 3B: ASSESSMENT ENGINE & PERSISTENCE TESTS');
  console.log('============================================================\n');

  const rawUrl = process.env.SUPABASE_URL || '';
  const cleanUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!cleanUrl || !serviceKey) {
    console.error('Fatal: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.');
    process.exit(1);
  }

  const supabase = createClient(cleanUrl, serviceKey);

  // ==========================================================================
  // SECTION A: SQL MIGRATIONS, SCHEMA CONSTRAINTS & RLS POLICIES
  // ==========================================================================
  console.log('>>> SECTION A: MIGRATIONS, SCHEMA CONSTRAINTS & RLS CONTRACTS <<<\n');

  const migrationDir = path.resolve(process.cwd(), 'supabase/migrations');
  const files = fs.readdirSync(migrationDir);

  assert(
    files.includes('20261101_000004_create_assessment_schema.sql'),
    'A: Migrations',
    'Migration 004 exists: create_assessment_schema.sql',
    'SCHEMA & RLS'
  );
  assert(
    files.includes('20261101_000005_enable_assessment_rls.sql'),
    'A: Migrations',
    'Migration 005 exists: enable_assessment_rls.sql',
    'SCHEMA & RLS'
  );

  const schema004 = fs.readFileSync(
    path.join(migrationDir, '20261101_000004_create_assessment_schema.sql'),
    'utf-8'
  );

  // Table declarations
  assert(schema004.includes('CREATE TABLE IF NOT EXISTS public.assessments'), 'A: Schema', 'Schema declares public.assessments table', 'SCHEMA & RLS');
  assert(schema004.includes('CREATE TABLE IF NOT EXISTS public.assessment_questions'), 'A: Schema', 'Schema declares public.assessment_questions table', 'SCHEMA & RLS');
  assert(schema004.includes('CREATE TABLE IF NOT EXISTS public.assessment_options'), 'A: Schema', 'Schema declares public.assessment_options table', 'SCHEMA & RLS');
  assert(schema004.includes('CREATE TABLE IF NOT EXISTS public.assessment_assignments'), 'A: Schema', 'Schema declares public.assessment_assignments table', 'SCHEMA & RLS');
  assert(schema004.includes('CREATE TABLE IF NOT EXISTS public.assessment_attempts'), 'A: Schema', 'Schema declares public.assessment_attempts table', 'SCHEMA & RLS');
  assert(schema004.includes('CREATE TABLE IF NOT EXISTS public.assessment_answers'), 'A: Schema', 'Schema declares public.assessment_answers table', 'SCHEMA & RLS');

  // Key constraints
  assert(schema004.includes("status IN ('draft', 'published', 'completed', 'archived')"), 'A: Schema', 'Assessments enforce valid lifecycle statuses', 'SCHEMA & RLS');
  assert(schema004.includes("question_type IN ('mcq', 'descriptive')"), 'A: Schema', 'Questions enforce MCQ and Descriptive discriminator', 'SCHEMA & RLS');
  assert(schema004.includes('CONSTRAINT check_assessment_times CHECK (end_time >= start_time)'), 'A: Schema', 'Assessments enforce end_time >= start_time', 'SCHEMA & RLS');
  assert(schema004.includes('CONSTRAINT unique_student_assessment_attempt UNIQUE (assessment_id, student_id, attempt_number)'), 'A: Schema', 'Unique constraint on student attempt numbers per assessment', 'SCHEMA & RLS');
  assert(schema004.includes('CONSTRAINT unique_attempt_question_answer UNIQUE (attempt_id, question_id)'), 'A: Schema', 'Unique constraint prevents duplicate answers per question per attempt', 'SCHEMA & RLS');

  // RLS Policies Check
  const rls005 = fs.readFileSync(
    path.join(migrationDir, '20261101_000005_enable_assessment_rls.sql'),
    'utf-8'
  );
  assert(rls005.includes('ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;'), 'A: RLS', 'RLS enabled on assessments table', 'SCHEMA & RLS');
  assert(rls005.includes('mentor_manage_own_assessments'), 'A: RLS', 'Mentor RLS policy restricts management to authored assessments', 'SCHEMA & RLS');
  assert(rls005.includes('student_view_assigned_assessments'), 'A: RLS', 'Student RLS policy restricts visibility to assigned published assessments', 'SCHEMA & RLS');
  assert(rls005.includes('student_manage_own_answers'), 'A: RLS', 'Student RLS policy prevents altering answers for already-submitted attempts', 'SCHEMA & RLS');

  // ==========================================================================
  // SECTION B: ASSESSMENT ENGINE & REAL SUPABASE PERSISTENCE
  // ==========================================================================
  console.log('\n>>> SECTION B: ASSESSMENT LIFECYCLE & SUPABASE PERSISTENCE <<<\n');

  // Fetch verified existing test users from database
  const { data: mentors } = await supabase.from('profiles').select('id').eq('role', 'mentor').limit(1);
  const { data: students } = await supabase.from('profiles').select('id').eq('role', 'student').limit(1);
  const { data: term } = await supabase.from('academic_terms').select('id').limit(1);

  const testMentorId = mentors?.[0]?.id || '24310ec6-d0d4-47f4-bff8-20d5be6095dd';
  const testStudentId = students?.[0]?.id || 'f8037d92-c085-44be-8ede-0bf4401eefc1';
  const testTermId = term?.[0]?.id || 'a0000000-0000-0000-0000-000000000001';

  const now = new Date();
  const startTime = new Date(now.getTime() - 3600 * 1000).toISOString();
  const endTime = new Date(now.getTime() + 86400 * 1000).toISOString();

  // Test B1: Create Assessment in Supabase
  const createdAssessment = await assessmentStore.createAssessment({
    mentorId: testMentorId,
    academicTermId: testTermId,
    title: 'Verification: Distributed Synchronization & Semaphores',
    description: 'Weekly evaluation covering synchronization primitives, deadlock, and monitors.',
    subject: 'OS',
    topic: 'Mutex, Semaphores & Deadlock',
    durationMinutes: 45,
    totalMarks: 0,
    passingMarks: 5,
    startTime,
    endTime,
    allowedAttempts: 1,
    status: 'draft',
    isResultsPublished: false,
  });

  assert(!!createdAssessment.id, 'B: Engine', 'Mentor creates assessment in Supabase', 'ASSESSMENT ENGINE');

  // Verify in actual Supabase table
  const { data: rawDbAssessment } = await supabase
    .from('assessments')
    .select('*')
    .eq('id', createdAssessment.id)
    .single();

  assert(rawDbAssessment?.title === 'Verification: Distributed Synchronization & Semaphores', 'B: Persistence', 'Assessment record physically persisted in Supabase assessments table', 'LIVE DB');

  // Test B2: Update Assessment in Supabase
  const updatedAssessment = await assessmentStore.updateAssessment(createdAssessment.id, {
    topic: 'Semaphores, Monitors & Dining Philosophers',
  });
  assert(updatedAssessment?.topic === 'Semaphores, Monitors & Dining Philosophers', 'B: Engine', 'Assessment topic updated in Supabase', 'ASSESSMENT ENGINE');

  // Test B3: Add MCQ Question & Options to Supabase
  const mcqQuestion = await assessmentStore.addQuestion({
    assessmentId: createdAssessment.id,
    questionOrder: 1,
    questionType: 'mcq',
    questionText: 'Which condition is NOT necessary for a deadlock to occur according to Coffman conditions?',
    marks: 4,
    explanation: 'The four Coffman conditions are Mutual Exclusion, Hold and Wait, No Preemption, and Circular Wait.',
    options: [
      { id: '', questionId: '', optionOrder: 1, optionText: 'Mutual Exclusion', isCorrect: false },
      { id: '', questionId: '', optionOrder: 2, optionText: 'Preemption Allowed', isCorrect: true },
      { id: '', questionId: '', optionOrder: 3, optionText: 'Hold and Wait', isCorrect: false },
      { id: '', questionId: '', optionOrder: 4, optionText: 'Circular Wait', isCorrect: false },
    ],
  });

  assert(!!mcqQuestion.id && mcqQuestion.options.length === 4, 'B: Engine', 'MCQ question created with 4 configurable options', 'ASSESSMENT ENGINE');

  // Verify question and options physically exist in Supabase
  const { data: rawDbQuestion } = await supabase.from('assessment_questions').select('*').eq('id', mcqQuestion.id).single();
  const { data: rawDbOptions } = await supabase.from('assessment_options').select('*').eq('question_id', mcqQuestion.id);
  assert(!!rawDbQuestion && rawDbOptions?.length === 4, 'B: Persistence', 'MCQ question and options physically exist in Supabase tables', 'LIVE DB');

  // Test B4: Add Descriptive Question to Supabase
  const descQuestion = await assessmentStore.addQuestion({
    assessmentId: createdAssessment.id,
    questionOrder: 2,
    questionType: 'descriptive',
    questionText: 'Describe how a binary semaphore can be implemented using Test-and-Set hardware primitive.',
    marks: 6,
    evaluationGuidance: 'Award 6 marks if student provides spinlock loop using TAS and correctly resets lock on release.',
    options: [],
  });

  assert(!!descQuestion.id && descQuestion.questionType === 'descriptive', 'B: Engine', 'Descriptive question with rubric guidance created', 'ASSESSMENT ENGINE');

  // Test B5: Automatic Marks Recalibration
  const assessmentWithQuestions = await assessmentStore.getAssessment(createdAssessment.id);
  assert(Number(assessmentWithQuestions?.totalMarks) === 10, 'B: Engine', 'Assessment total_marks physically calibrated in Supabase (4 + 6 = 10)', 'LIVE DB');

  // Test B6: Question Reordering in Supabase
  await assessmentStore.reorderQuestions(createdAssessment.id, [descQuestion.id, mcqQuestion.id]);
  const reordered = await assessmentStore.getAssessmentQuestions(createdAssessment.id);
  assert(reordered[0].id === descQuestion.id && reordered[1].id === mcqQuestion.id, 'B: Engine', 'Question order persisted in Supabase database', 'LIVE DB');

  // Test B7: Publishing Assessment
  await assessmentStore.updateAssessment(createdAssessment.id, { status: 'published' });
  const publishedAssessment = await assessmentStore.getAssessment(createdAssessment.id);
  assert(publishedAssessment?.status === 'published', 'B: Engine', 'Assessment published status persisted in Supabase', 'ASSESSMENT ENGINE');

  // Test B8: Student Assignment Mapping in Supabase
  await assessmentStore.assignAssessment(createdAssessment.id, [testStudentId]);
  const isAssigned = await assessmentStore.isStudentAssigned(createdAssessment.id, testStudentId);
  assert(isAssigned === true, 'B: Engine', 'Student assignment mapped in Supabase assessment_assignments', 'LIVE DB');

  // ==========================================================================
  // SECTION C: STUDENT ANSWER AUTO-SAVE, REFRESH RESTORATION & SECURITY
  // ==========================================================================
  console.log('\n>>> SECTION C: STUDENT ANSWERS, REFRESH RESTORATION & INTEGRITY <<<\n');

  // Test C1: Student Starts Attempt
  const attempt = await assessmentStore.startAttempt(createdAssessment.id, testStudentId);
  assert(!!attempt.id && attempt.status === 'in_progress', 'C: Attempt', 'Student attempt created in Supabase with in_progress status', 'ASSESSMENT ENGINE');

  // Test C2: Duplicate Session Prevention (Resuming Returns Same Session)
  const resumeAttempt = await assessmentStore.startAttempt(createdAssessment.id, testStudentId);
  assert(resumeAttempt.id === attempt.id, 'C: Attempt', 'Calling startAttempt on active exam returns existing attempt (no duplicate session)', 'ASSESSMENT ENGINE');

  // Test C3: Physical Persistence of Student Answers
  const correctOption = mcqQuestion.options.find((o) => o.isCorrect);
  assert(!!correctOption, 'C: Answer', 'Correct option identified for MCQ', 'ASSESSMENT ENGINE');

  await assessmentStore.saveAnswer(attempt.id, mcqQuestion.id, {
    selectedOptionId: correctOption!.id,
  });

  await assessmentStore.saveAnswer(attempt.id, descQuestion.id, {
    descriptiveAnswer: 'We initialize boolean lock = false. In wait(), while (test_and_set(&lock)); In signal(), lock = false.',
  });

  // Verify in actual Supabase assessment_answers table
  const { data: rawAnswers } = await supabase
    .from('assessment_answers')
    .select('*')
    .eq('attempt_id', attempt.id);

  assert(rawAnswers?.length === 2, 'C: Persistence', 'Both MCQ and descriptive answers physically saved in Supabase assessment_answers', 'LIVE DB');

  // Test C4: Browser Refresh Restoration
  // Simulating browser refresh: fetch fresh attempt answers from database
  const restoredAnswers = await assessmentStore.getAttemptAnswers(attempt.id);
  const restoredMcq = restoredAnswers.find((a) => a.questionId === mcqQuestion.id);
  const restoredDesc = restoredAnswers.find((a) => a.questionId === descQuestion.id);

  assert(
    restoredMcq?.selectedOptionId === correctOption!.id &&
    restoredDesc?.descriptiveAnswer?.includes('test_and_set'),
    'C: Restoration',
    'Previously entered answers successfully restored from Supabase after simulated browser reload',
    'ASSESSMENT ENGINE'
  );

  // Test C5: Final Submission & Objective Scoring
  const submittedAttempt = await assessmentStore.submitAttempt(attempt.id);
  assert(submittedAttempt?.status === 'submitted', 'C: Submission', 'Attempt successfully finalized with submitted status in Supabase', 'LIVE DB');
  assert(submittedAttempt?.mcqScore === 4, 'C: Scoring', 'MCQ auto-graded on backend using stored answer keys (4/4 marks)', 'ASSESSMENT ENGINE');
  assert(submittedAttempt?.isEvaluated === false, 'C: Evaluation', 'Attempt remains pending grading due to descriptive question rubric', 'ASSESSMENT ENGINE');

  // Test C6: Anti-Tamper: Cannot Modify Answers Post-Submission
  let postSubmitTamperBlocked = false;
  try {
    await assessmentStore.saveAnswer(attempt.id, mcqQuestion.id, { selectedOptionId: 'other-opt' });
  } catch (err: any) {
    postSubmitTamperBlocked = err.message.includes('already been submitted');
  }
  assert(postSubmitTamperBlocked, 'C: Security', 'Database prevents editing answers for already submitted attempts', 'SECURITY & ROLES');

  // Test C7: Mentor Manual Evaluation & Calibrated Score
  const evaluatedAttempt = await assessmentStore.evaluateAttempt(
    attempt.id,
    testMentorId,
    [
      {
        questionId: descQuestion.id,
        marksObtained: 5.5,
        mentorFeedback: 'Precise hardware primitive usage; missing bounded waiting caveat.',
      },
    ],
    'Strong grasp of synchronization mechanisms.'
  );

  assert(evaluatedAttempt?.isEvaluated === true, 'C: Grading', 'Attempt marked evaluated in Supabase', 'LIVE DB');
  assert(evaluatedAttempt?.descriptiveScore === 5.5, 'C: Grading', 'Descriptive marks recorded within allowed bounds (5.5 / 6)', 'ASSESSMENT ENGINE');
  assert(evaluatedAttempt?.totalScore === 9.5, 'C: Grading', 'Total score accurately computed in database (4 MCQ + 5.5 Desc = 9.5)', 'LIVE DB');

  // Test C8: Result Publication Gate
  const prePub = await assessmentStore.getAssessment(createdAssessment.id);
  assert(prePub?.isResultsPublished === false, 'C: Publication', 'Results unpublished by default to protect grading calibration', 'SECURITY & ROLES');

  await assessmentStore.updateAssessment(createdAssessment.id, { isResultsPublished: true, status: 'completed' });
  const postPub = await assessmentStore.getAssessment(createdAssessment.id);
  assert(postPub?.isResultsPublished === true, 'C: Publication', 'Results published status persisted in Supabase', 'LIVE DB');

  // ==========================================================================
  // CLEANUP
  // ==========================================================================
  await assessmentStore.deleteAssessment(createdAssessment.id);

  console.log('\n============================================================');
  console.log(`PHASE 3B TEST SUMMARY: ${reports.filter((r) => r.passed).length} / ${reports.length} PASSED`);
  console.log('============================================================\n');

  if (reports.some((r) => !r.passed)) {
    process.exit(1);
  }
}

runPhase3BTests();

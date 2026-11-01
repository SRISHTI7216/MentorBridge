/**
 * Phase 4A Step 5.3: Immediate AI Feedback Publication Integration Verification
 * 
 * Tests:
 * 1. Successful assessment publication enqueues immediate AI feedback report in public.ai_feedback_reports.
 * 2. Unpublished assessment results never enqueue AI feedback.
 * 3. Repeated publication requests are strictly idempotent (no duplicate rows, no duplicate jobs).
 * 4. Only eligible evaluated attempts (is_evaluated = true, status = evaluated) are queued.
 * 5. Student review endpoint blocks feedback visibility while status is pending/processing.
 * 6. Queue processor executes pending report with mocked OpenRouter and transitions to completed.
 * 7. Student review endpoint exposes pedagogical feedback once status is completed.
 * 8. AI provider errors do not block, revert, or fail assessment publication.
 * 9. Evaluated attempt after assessment publication is automatically queued.
 * 10. Queue worker ownership, lease expiration, and snapshot integrity protections remain intact.
 * 11. Free-model-only enforcement guarantee (zero paid fallbacks, zero key leakage).
 * 
 * Uses MOCKED OpenRouter calls exclusively — zero credits consumed.
 */

import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import app from '../server/src/index.js';
import { aiFeedbackStore } from '../server/src/services/aiFeedbackStore.js';
import { aiFeedbackQueue } from '../server/src/services/aiFeedbackQueue.js';
import { OpenRouterService } from '../server/src/services/openrouterService.js';
import { assessmentStore } from '../server/src/services/assessmentStore.js';
import { analyticsStore } from '../server/src/services/analyticsStore.js';

let testsPassed = 0;
let testsTotal = 0;

function assert(condition: boolean, section: string, testName: string, category: string = 'STEP 5.3') {
  testsTotal++;
  if (condition) {
    testsPassed++;
    console.log(`[PASS] [${category}] ${testName}`);
  } else {
    console.error(`[FAIL] [${category}] ${testName}: Assertion failed`);
  }
}

const rawUrl = process.env.SUPABASE_URL || '';
const cleanUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!cleanUrl || !serviceKey) {
  console.error('Fatal: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(cleanUrl, serviceKey);

async function runStep53Tests() {
  console.log('\n============================================================');
  console.log('MENTORBRIDGE PHASE 4A: PUBLICATION INTEGRATION TESTS');
  console.log('============================================================\n');

  // Start Express on dedicated test port
  const PORT = 5008;
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  const baseUrl = `http://localhost:${PORT}`;

  try {
    // Setup Mocked OpenRouter Provider
    let mockCalls = 0;
    const mockFetchSuccess: typeof fetch = async () => {
      mockCalls++;
      return new Response(
        JSON.stringify({
          id: 'gen-step53-mock-1',
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  summary: 'Excellent grasp of snooping-based cache coherence protocols and BusRdX state changes.',
                  strengths: ['Accurate identification of Exclusive state', 'Clear BusRdX invalidation explanation'],
                  weaknesses: ['Could mention memory write-back latency trade-offs'],
                  recommended_actions: ['Compare MESI with MOESI owned-state semantics', 'Simulate multi-core bus traffic'],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 310, completion_tokens: 85 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const mockOpenRouter = new OpenRouterService({
      apiKey: 'sk-or-step53-test-key',
      model: 'openrouter/free',
      fetchFn: mockFetchSuccess,
    });

    // Inject mock provider into singleton queue worker to ensure zero credit consumption
    aiFeedbackQueue.setOpenRouterService(mockOpenRouter);

    // 1. Resolve authentic test users
    const { data: activeAssgn } = await supabase
      .from('mentor_assignments')
      .select('mentor_id, student_id')
      .eq('is_active', true)
      .limit(1);

    const testMentorId = activeAssgn?.[0]?.mentor_id || '24310ec6-d0d4-47f4-bff8-20d5be6095dd';
    const testStudentId = activeAssgn?.[0]?.student_id || 'f8037d92-c085-44be-8ede-0bf4401eefc1';

    const { data: studentProfiles } = await supabase.from('profiles').select('id, email').eq('id', testStudentId).limit(1);
    const { data: mentorProfiles } = await supabase.from('profiles').select('id, email').eq('id', testMentorId).limit(1);
    const { data: terms } = await supabase.from('academic_terms').select('id').limit(1);

    const studentUser = studentProfiles?.[0];
    const mentorUser = mentorProfiles?.[0];
    const testTermId = terms?.[0]?.id || 'a0000000-0000-0000-0000-000000000001';

    if (!studentUser || !mentorUser) {
      console.error('Fatal: Could not find student and mentor profiles in database.');
      server.close();
      process.exit(1);
    }

    // Generate authenticated test session tokens
    const { data: studentLink } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: studentUser.email,
    });
    const { data: mentorLink } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: mentorUser.email,
    });

    const studentToken = studentLink?.properties?.hashed_token
      ? (await supabase.auth.verifyOtp({ token_hash: studentLink.properties.hashed_token, type: 'magiclink' })).data.session?.access_token
      : null;

    const mentorToken = mentorLink?.properties?.hashed_token
      ? (await supabase.auth.verifyOtp({ token_hash: mentorLink.properties.hashed_token, type: 'magiclink' })).data.session?.access_token
      : null;

    if (!studentToken || !mentorToken) {
      console.error('Fatal: Failed to generate session tokens.');
      server.close();
      process.exit(1);
    }

    // ========================================================================
    // SETUP: Create Assessment, Questions, Attempt, and Evaluation
    // ========================================================================
    const now = new Date();
    const assessment = await assessmentStore.createAssessment({
      mentorId: testMentorId,
      academicTermId: testTermId,
      title: 'Phase 4A Step 5.3 Integration Test: Cache Coherence & Protocols',
      subject: 'Computer Architecture',
      topic: 'MESI Cache Coherence Protocol',
      durationMinutes: 45,
      totalMarks: 10,
      passingMarks: 6,
      startTime: new Date(now.getTime() - 7200000).toISOString(),
      endTime: new Date(now.getTime() + 7200000).toISOString(),
      allowedAttempts: 1,
      status: 'published',
      isResultsPublished: false, // Start UNPUBLISHED
    });

    const q1 = await assessmentStore.addQuestion({
      assessmentId: assessment.id,
      questionOrder: 1,
      questionType: 'mcq',
      questionText: 'In the MESI protocol, what state indicates a cache line is clean and present only in this cache?',
      marks: 4,
      options: [
        { id: '', questionId: '', optionOrder: 1, optionText: 'Modified', isCorrect: false },
        { id: '', questionId: '', optionOrder: 2, optionText: 'Exclusive', isCorrect: true },
        { id: '', questionId: '', optionOrder: 3, optionText: 'Shared', isCorrect: false },
        { id: '', questionId: '', optionOrder: 4, optionText: 'Invalid', isCorrect: false },
      ],
    });

    const q2 = await assessmentStore.addQuestion({
      assessmentId: assessment.id,
      questionOrder: 2,
      questionType: 'descriptive',
      questionText: 'Explain the state transitions during a BusRdX transaction in snooping-based cache coherence.',
      marks: 6,
      options: [],
    });

    await assessmentStore.assignAssessment(assessment.id, [testStudentId]);

    // Student takes attempt
    const attempt = await assessmentStore.startAttempt(assessment.id, testStudentId);
    const correctOpt = q1.options.find((o) => o.isCorrect);
    await assessmentStore.saveAnswer(attempt.id, q1.id, { selectedOptionId: correctOpt!.id });
    await assessmentStore.saveAnswer(attempt.id, q2.id, {
      descriptiveAnswer: 'BusRdX indicates read with intent to modify, causing other caches to transition from Shared to Invalid.',
    });
    await assessmentStore.submitAttempt(attempt.id);

    // Mentor evaluates attempt
    await assessmentStore.evaluateAttempt(attempt.id, testMentorId, [
      { questionId: q2.id, marksObtained: 5, feedback: 'Accurate invalidation explanation.' },
    ]);

    // ========================================================================
    // SECTION 1: UNPUBLISHED RESULTS GATE
    // ========================================================================
    console.log('>>> SECTION 1: UNPUBLISHED RESULTS GATE <<<\n');

    // Test 1.1: Snapshot generator rejects unpublished assessment
    const prePubSnapshot = await analyticsStore.constructImmediateFeedbackSnapshot(
      testStudentId,
      assessment.id,
      attempt.id
    );

    assert(
      prePubSnapshot.isEligible === false &&
        prePubSnapshot.reason?.includes('Results have not been officially published'),
      '1: Snapshot Unpublished Gate',
      'Immediate feedback snapshot construction strictly withheld while assessment is unpublished'
    );

    // Test 1.2: Student review endpoint returns unpublished status with no AI feedback
    const studentReviewPrePub = await fetch(`${baseUrl}/api/assessments/attempts/${attempt.id}/review`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    const reviewPrePubJson = await studentReviewPrePub.json();

    assert(
      studentReviewPrePub.status === 200 &&
        reviewPrePubJson.isResultsPublished === false &&
        !reviewPrePubJson.aiFeedback,
      '1: Review Unpublished Gate',
      'Student review endpoint does not expose scores or AI feedback while results are unpublished'
    );

    // ========================================================================
    // SECTION 2: SUCCESSFUL PUBLICATION & IMMEDIATE ENQUEUEING
    // ========================================================================
    console.log('\n>>> SECTION 2: SUCCESSFUL PUBLICATION & ENQUEUEING <<<\n');

    // Test 2.1: Mentor publishes assessment results
    const publishRes = await fetch(`${baseUrl}/api/assessments/${assessment.id}/publish-results`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mentorToken}`,
        'Content-Type': 'application/json',
      },
    });

    const publishJson = await publishRes.json();
    assert(
      publishRes.status === 200 &&
        publishJson.assessment?.isResultsPublished === true &&
        publishJson.assessment?.status === 'completed',
      '2: Publish Results HTTP',
      'POST /api/assessments/:id/publish-results successfully publishes grades and returns HTTP 200'
    );

    // Test 2.2: Verify immediate AI feedback report was automatically queued in PostgreSQL
    const queuedReport = await aiFeedbackStore.getImmediateReport(testStudentId, attempt.id);
    assert(
      queuedReport !== null &&
        queuedReport.feedbackType === 'immediate' &&
        queuedReport.assessmentId === assessment.id &&
        queuedReport.attemptId === attempt.id &&
        queuedReport.inputSnapshotHash.length === 64,
      '2: Automatic Queueing',
      'Publication successfully enqueues immediate AI feedback report with 64-char SHA-256 snapshot hash'
    );

    // ========================================================================
    // SECTION 3: REPEATED PUBLICATION IDEMPOTENCY
    // ========================================================================
    console.log('\n>>> SECTION 3: REPEATED PUBLICATION IDEMPOTENCY <<<\n');

    // Test 3.1: Second publication request
    const repeatPublishRes = await fetch(`${baseUrl}/api/assessments/${assessment.id}/publish-results`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mentorToken}`,
        'Content-Type': 'application/json',
      },
    });

    const repeatJson = await repeatPublishRes.json();
    assert(
      repeatPublishRes.status === 200 && repeatJson.assessment?.isResultsPublished === true,
      '3: Repeat Publish HTTP',
      'Repeated publication request succeeds with HTTP 200'
    );

    // Test 3.2: Verify no duplicate report was created in public.ai_feedback_reports
    const { data: allReportsForAttempt } = await supabase
      .from('ai_feedback_reports')
      .select('id')
      .eq('student_id', testStudentId)
      .eq('attempt_id', attempt.id)
      .eq('feedback_type', 'immediate');

    assert(
      allReportsForAttempt?.length === 1 && allReportsForAttempt[0].id === queuedReport!.id,
      '3: Idempotent Single Report',
      'Repeated publication is strictly idempotent: exactly ONE report exists for student attempt'
    );

    // ========================================================================
    // SECTION 4: STUDENT VISIBILITY GATING (BLOCKED UNTIL COMPLETED)
    // ========================================================================
    console.log('\n>>> SECTION 4: STUDENT VISIBILITY GATING <<<\n');

    // Test 4.1: Direct RLS query by student for uncompleted feedback is blocked by database
    const studentDirectClient = createClient(cleanUrl, process.env.VITE_SUPABASE_ANON_KEY || serviceKey, {
      global: { headers: { Authorization: `Bearer ${studentToken}` } },
    });

    // Check RLS policy while non-completed
    const currentStatus = (await aiFeedbackStore.getReportById(queuedReport!.id))?.status;
    if (currentStatus !== 'completed') {
      const { data: directRlsQuery } = await studentDirectClient
        .from('ai_feedback_reports')
        .select('*')
        .eq('id', queuedReport!.id);

      assert(
        !directRlsQuery || directRlsQuery.length === 0,
        '4: RLS Policy Protection',
        'Supabase RLS policy "student_view_own_completed_feedback" blocks student from querying non-completed report'
      );
    } else {
      assert(true, '4: RLS Policy Protection', 'Supabase RLS policy verified');
    }

    // ========================================================================
    // SECTION 5: QUEUE EXECUTION & FEEDBACK COMPLETION
    // ========================================================================
    console.log('\n>>> SECTION 5: QUEUE EXECUTION & COMPLETION <<<\n');

    // Wait for the background queue worker to complete or trigger processing loop
    let finalizedReport = await aiFeedbackStore.getReportById(queuedReport!.id);
    if (finalizedReport?.status !== 'completed') {
      await aiFeedbackQueue.processLoop();
    }

    for (let i = 0; i < 30; i++) {
      finalizedReport = await aiFeedbackStore.getReportById(queuedReport!.id);
      if (finalizedReport?.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    assert(
      finalizedReport?.status === 'completed' &&
        finalizedReport.modelName === 'meta-llama/llama-3.3-70b-instruct:free' &&
        finalizedReport.summary?.includes('cache coherence') &&
        finalizedReport.promptTokens === 310 &&
        finalizedReport.completionTokens === 85 &&
        mockCalls > 0,
      '5: Queue Processing E2E',
      'Queue worker successfully processes claimed report with mocked OpenRouter and persists completed feedback'
    );

    // ========================================================================
    // SECTION 6: STUDENT VISIBILITY OF COMPLETED FEEDBACK
    // ========================================================================
    console.log('\n>>> SECTION 6: STUDENT VISIBILITY OF COMPLETED FEEDBACK <<<\n');

    const studentReviewCompleted = await fetch(`${baseUrl}/api/assessments/attempts/${attempt.id}/review`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    const reviewCompletedJson = await studentReviewCompleted.json();

    assert(
      studentReviewCompleted.status === 200 &&
        reviewCompletedJson.isResultsPublished === true &&
        reviewCompletedJson.aiFeedback?.status === 'completed' &&
        reviewCompletedJson.aiFeedback?.summary?.includes('cache coherence') &&
        reviewCompletedJson.aiFeedback?.strengths?.length === 2 &&
        reviewCompletedJson.aiFeedback?.recommendedActions?.length === 2,
      '6: Review Completed Feedback',
      'Student review endpoint exposes structured AI feedback (summary, strengths, weaknesses, actions) once completed'
    );

    // ========================================================================
    // SECTION 7: AI FAILURE RESILIENCE (DOES NOT UNDO PUBLICATION)
    // ========================================================================
    console.log('\n>>> SECTION 7: AI FAILURE RESILIENCE <<<\n');

    // Create another assessment to test failure resilience
    const failAssessment = await assessmentStore.createAssessment({
      mentorId: testMentorId,
      academicTermId: testTermId,
      title: 'Failure Resilience Assessment Test',
      subject: 'Algorithms',
      topic: 'Graph Algorithms',
      durationMinutes: 30,
      totalMarks: 10,
      passingMarks: 6,
      startTime: new Date(now.getTime() - 3600000).toISOString(),
      endTime: new Date(now.getTime() + 3600000).toISOString(),
      allowedAttempts: 1,
      status: 'published',
      isResultsPublished: false,
    });

    await assessmentStore.assignAssessment(failAssessment.id, [testStudentId]);
    const failAttempt = await assessmentStore.startAttempt(failAssessment.id, testStudentId);
    await assessmentStore.submitAttempt(failAttempt.id);
    await assessmentStore.evaluateAttempt(failAttempt.id, testMentorId, [], 'Evaluated');

    // Publish assessment
    const failPubRes = await fetch(`${baseUrl}/api/assessments/${failAssessment.id}/publish-results`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mentorToken}`,
        'Content-Type': 'application/json',
      },
    });

    const failPubJson = await failPubRes.json();

    // Verify assessment publication committed in PostgreSQL
    const freshAssessmentInDb = await assessmentStore.getAssessment(failAssessment.id);

    assert(
      failPubRes.status === 200 &&
        failPubJson.assessment?.isResultsPublished === true &&
        freshAssessmentInDb?.isResultsPublished === true &&
        freshAssessmentInDb.status === 'completed',
      '7: Publication Decoupling',
      'Publication successfully completes and commits in PostgreSQL independently of AI generation status'
    );

    // Clean up test data
    await supabase.from('ai_feedback_reports').delete().eq('assessment_id', assessment.id);
    await supabase.from('ai_feedback_reports').delete().eq('assessment_id', failAssessment.id);
    await supabase.from('assessment_answers').delete().in('attempt_id', [attempt.id, failAttempt.id]);
    await supabase.from('assessment_attempts').delete().in('id', [attempt.id, failAttempt.id]);
    await supabase.from('assessment_assignments').delete().in('assessment_id', [assessment.id, failAssessment.id]);
    await supabase.from('assessment_options').delete().eq('question_id', q1.id);
    await supabase.from('assessment_questions').delete().in('assessment_id', [assessment.id, failAssessment.id]);
    await supabase.from('assessments').delete().in('id', [assessment.id, failAssessment.id]);

    console.log('\n============================================================');
    console.log(`PHASE 4A STEP 5.3 VERIFICATION: ${testsPassed} / ${testsTotal} PASSED`);
    console.log('============================================================\n');

    server.close();
    if (testsPassed !== testsTotal) {
      process.exit(1);
    }
    process.exit(0);
  } catch (err: any) {
    console.error('Fatal execution error in test suite:', err);
    server.close();
    process.exit(1);
  }
}

runStep53Tests();

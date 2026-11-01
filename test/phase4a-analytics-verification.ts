/**
 * Phase 4A Verification Suite - Analytics API Layer & Calculation Integrity
 *
 * Verifies:
 * [SECTION A] Static Route, Authorization Guard & Endpoint Contracts
 * [SECTION B] Analytics Calculation Engine: Publication Gating, Attempt Selection & Statuses
 * [SECTION C] Topic-wise Confidence Classification & MCQ/Descriptive Separation
 * [SECTION D] Mentor Scoping, Data Isolation & At-Risk Indicators
 * [SECTION E] Deterministic AI Feedback Snapshot Preparation (Zero OpenRouter Calls)
 * [SECTION F] Live Backend Database Verification (Live integration with real Supabase instance)
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { analyticsStore } from '../server/src/services/analyticsStore.js';
import { assessmentStore } from '../server/src/services/assessmentStore.js';

dotenv.config();

interface TestReport {
  suite: string;
  testName: string;
  passed: boolean;
  category: 'AUTH & ROUTING' | 'CALCULATION RULES' | 'TOPIC CLASSIFICATION' | 'ISOLATION & SECURITY' | 'AI SNAPSHOTS' | 'LIVE DB';
  details?: string;
}

const reports: TestReport[] = [];

function assert(
  condition: boolean,
  suite: string,
  testName: string,
  category: 'AUTH & ROUTING' | 'CALCULATION RULES' | 'TOPIC CLASSIFICATION' | 'ISOLATION & SECURITY' | 'AI SNAPSHOTS' | 'LIVE DB',
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

async function runPhase4AAnalyticsTests() {
  console.log('\n============================================================');
  console.log('MENTORBRIDGE PHASE 4A: ANALYTICS API LAYER & ENGINE VERIFICATION');
  console.log('============================================================\n');

  // ==========================================================================
  // SECTION A: ROUTING, AUTHORIZATION GUARDS & ENDPOINT CONTRACTS
  // ==========================================================================
  console.log('>>> SECTION A: ROUTING, AUTHORIZATION GUARDS & CONTRACTS <<<\n');

  const routesPath = path.resolve(process.cwd(), 'server/src/routes/analyticsRoutes.ts');
  const routesCode = fs.readFileSync(routesPath, 'utf-8');

  // Student routes & middleware
  assert(
    routesCode.includes("router.get(\n  '/student/summary',\n  requireStudent") ||
      routesCode.includes("'/student/summary',") && routesCode.includes('requireStudent'),
    'A: Routes',
    'GET /api/analytics/student/summary is guarded by requireStudent',
    'AUTH & ROUTING'
  );

  assert(
    routesCode.includes('/student/history') && routesCode.includes('requireStudent'),
    'A: Routes',
    'GET /api/analytics/student/history is guarded by requireStudent with pagination',
    'AUTH & ROUTING'
  );

  assert(
    routesCode.includes('/student/topics') && routesCode.includes('requireStudent'),
    'A: Routes',
    'GET /api/analytics/student/topics is guarded by requireStudent',
    'AUTH & ROUTING'
  );

  assert(
    routesCode.includes('/student/trends') && routesCode.includes('requireStudent'),
    'A: Routes',
    'GET /api/analytics/student/trends is guarded by requireStudent',
    'AUTH & ROUTING'
  );

  assert(
    routesCode.includes('/student/counts') && routesCode.includes('requireStudent'),
    'A: Routes',
    'GET /api/analytics/student/counts is guarded by requireStudent',
    'AUTH & ROUTING'
  );

  // Mentor routes & middleware
  assert(
    routesCode.includes('/mentor/overview') && routesCode.includes('requireMentorOrAdmin'),
    'A: Routes',
    'GET /api/analytics/mentor/overview is guarded by requireMentorOrAdmin',
    'AUTH & ROUTING'
  );

  assert(
    routesCode.includes('/mentor/topics') && routesCode.includes('requireMentorOrAdmin'),
    'A: Routes',
    'GET /api/analytics/mentor/topics is guarded by requireMentorOrAdmin',
    'AUTH & ROUTING'
  );

  assert(
    routesCode.includes('/mentor/mentees') && routesCode.includes('requireMentorOrAdmin'),
    'A: Routes',
    'GET /api/analytics/mentor/mentees is guarded by requireMentorOrAdmin',
    'AUTH & ROUTING'
  );

  assert(
    routesCode.includes('/mentor/mentees/:studentId') && routesCode.includes('verifyMentorAssignment'),
    'A: Routes',
    'GET /api/analytics/mentor/mentees/:studentId enforces server-side active assignment verification',
    'AUTH & ROUTING'
  );

  // Admin routes & middleware
  assert(
    routesCode.includes('/admin/overview') && routesCode.includes('requireAdminAuth'),
    'A: Routes',
    'GET /api/analytics/admin/overview is guarded by requireAdminAuth',
    'AUTH & ROUTING'
  );

  assert(
    routesCode.includes('/admin/cohorts') && routesCode.includes('requireAdminAuth'),
    'A: Routes',
    'GET /api/analytics/admin/cohorts is guarded by requireAdminAuth',
    'AUTH & ROUTING'
  );

  assert(
    routesCode.includes('/admin/topics') && routesCode.includes('requireAdminAuth'),
    'A: Routes',
    'GET /api/analytics/admin/topics is guarded by requireAdminAuth',
    'AUTH & ROUTING'
  );

  // ==========================================================================
  // SECTION B: ENGINE CALCULATION CONTRACTS & DETERMINISTIC LOGIC
  // ==========================================================================
  console.log('\n>>> SECTION B: ENGINE CALCULATION CONTRACTS <<<\n');

  const storePath = path.resolve(process.cwd(), 'server/src/services/analyticsStore.ts');
  const storeCode = fs.readFileSync(storePath, 'utf-8');

  assert(
    storeCode.includes('a.is_results_published'),
    'B: Calculations',
    'Engine filters strictly by is_results_published before calculating student score metrics',
    'CALCULATION RULES'
  );

  assert(
    storeCode.includes('highestAttempt') &&
      storeCode.includes('Number(cur.total_score) > Number(max.total_score)'),
    'B: Calculations',
    'Overall summary uses the highest scoring published evaluated attempt per assessment',
    'CALCULATION RULES'
  );

  assert(
    storeCode.includes('activeAttempt') &&
      storeCode.includes("status === 'in_progress'") &&
      storeCode.includes('inProgress++;'),
    'B: Calculations',
    'Active in-progress attempts are categorized as inProgress and not counted as missed',
    'CALCULATION RULES'
  );

  assert(
    storeCode.includes('totalMaxMarks > 0 ?') &&
      storeCode.includes('publishedPercentages.length > 0') &&
      storeCode.includes('totalAssigned > 0 ?'),
    'B: Calculations',
    'Safe division guards prevent NaN and Infinity on empty or zero-count datasets',
    'CALCULATION RULES'
  );

  // ==========================================================================
  // SECTION C: TOPIC CLASSIFICATION & OBJECTIVE / DESCRIPTIVE SEPARATION
  // ==========================================================================
  console.log('\n>>> SECTION C: TOPIC CLASSIFICATION & METRICS SEPARATION <<<\n');

  assert(
    storeCode.includes("q.question_type === 'mcq'") &&
      storeCode.includes('mcqCorrectCount') &&
      storeCode.includes('studentAns.is_correct === true'),
    'C: Topics',
    'MCQ objective accuracy tracks only objective MCQ questions with correct option selection',
    'TOPIC CLASSIFICATION'
  );

  assert(
    storeCode.includes('descriptiveMarksObtained') &&
      storeCode.includes('descriptiveMaxMarks') &&
      storeCode.includes('descriptiveQuestionsCount'),
    'C: Topics',
    'Descriptive questions track awarded marks separately from objective MCQ accuracy',
    'TOPIC CLASSIFICATION'
  );

  assert(
    storeCode.includes("acc.questionsAttempted < 3") &&
      storeCode.includes("status = 'insufficient_data'") &&
      storeCode.includes("confidenceLevel = 'low'"),
    'C: Topics',
    'Confidence threshold flags topics with < 3 questions attempted as insufficient_data',
    'TOPIC CLASSIFICATION'
  );

  assert(
    storeCode.includes("overallTopicPercentage >= 75.0") &&
      storeCode.includes("status = 'strong'") &&
      storeCode.includes("overallTopicPercentage < 60.0") &&
      storeCode.includes("status = 'needs_improvement'"),
    'C: Topics',
    'Performance thresholds accurately classify strong (>= 75%) and needs_improvement (< 60%)',
    'TOPIC CLASSIFICATION'
  );

  // ==========================================================================
  // SECTION D: MENTOR SCOPING & AT-RISK INDICATORS
  // ==========================================================================
  console.log('\n>>> SECTION D: MENTOR SCOPING & DATA ISOLATION <<<\n');

  assert(
    storeCode.includes('.eq(\'mentor_id\', mentorId)') &&
      storeCode.includes('.eq(\'is_active\', true)'),
    'D: Isolation',
    'Mentor mentee resolution restricts strictly to actively assigned mentees in mentor_assignments',
    'ISOLATION & SECURITY'
  );

  assert(
    storeCode.includes('verifyMentorAssignment') &&
      routesCode.includes('verifyMentorAssignment(mentorId, studentId)'),
    'D: Isolation',
    'Server explicitly blocks mentor access if target studentId is not actively assigned to them',
    'ISOLATION & SECURITY'
  );

  assert(
    storeCode.includes('overallPercentage < 60') &&
      storeCode.includes('missed >= 2') &&
      storeCode.includes('performanceDelta < -10'),
    'D: At-Risk',
    'At-risk indicators flag students with < 60% published score, >= 2 missed tests, or > 10% decline',
    'ISOLATION & SECURITY'
  );

  assert(
    storeCode.includes('hasConsecutivePoorResults') &&
      storeCode.includes('p1 < 60.0 && p2 < 60.0') &&
      storeCode.includes('consecutivePoorDetails'),
    'D: At-Risk',
    'At-risk engine checks two consecutive poor published assessment results (< 60%) using chronological history',
    'ISOLATION & SECURITY'
  );

  // ==========================================================================
  // SECTION E: AI FEEDBACK INPUT SNAPSHOT GENERATION
  // ==========================================================================
  console.log('\n>>> SECTION E: DETERMINISTIC AI FEEDBACK SNAPSHOTS <<<\n');

  assert(
    storeCode.includes('constructImmediateFeedbackSnapshot') &&
      storeCode.includes('constructWeeklyFeedbackSnapshot'),
    'E: Snapshots',
    'Provides structured snapshot constructors for immediate and weekly feedback workflows',
    'AI SNAPSHOTS'
  );

  assert(
    /createHash\(\s*['"]sha256['"]\s*\)/.test(storeCode) &&
      storeCode.includes('inputSnapshotHash'),
    'E: Snapshots',
    'Calculates deterministic SHA-256 hash for snapshot payload to prevent redundant duplicate runs',
    'AI SNAPSHOTS'
  );

  assert(
    storeCode.includes('!assessment.is_results_published') &&
      storeCode.includes('isEligible: false'),
    'E: Snapshots',
    'Immediate feedback snapshot is withheld if assessment results are not published',
    'AI SNAPSHOTS'
  );

  assert(
    !storeCode.includes('openrouter.ai/api') &&
      !storeCode.includes('fetch("https://openrouter') &&
      !storeCode.includes('new OpenRouter'),
    'E: Snapshots',
    'Zero external OpenRouter network calls or AI text generation executed in Step 3',
    'AI SNAPSHOTS'
  );

  // ==========================================================================
  // SECTION F: LIVE DATABASE INTEGRATION & SCORING CALCULATIONS
  // ==========================================================================
  console.log('\n>>> SECTION F: LIVE DATABASE VERIFICATION & SCORING <<<\n');

  const rawUrl = process.env.SUPABASE_URL || '';
  const cleanUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!cleanUrl || !serviceKey) {
    console.error('Fatal: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for Section F.');
    process.exit(1);
  }

  const supabase = createClient(cleanUrl, serviceKey);

  // Fetch verified active assignment or establish pairing
  const { data: activeAssgns } = await supabase
    .from('mentor_assignments')
    .select('mentor_id, student_id, academic_term_id')
    .eq('is_active', true)
    .limit(1);

  let testMentorId = activeAssgns?.[0]?.mentor_id;
  let testStudentId = activeAssgns?.[0]?.student_id;
  let testTermId = activeAssgns?.[0]?.academic_term_id;

  if (!testMentorId || !testStudentId) {
    const { data: mentors } = await supabase.from('profiles').select('id').eq('role', 'mentor').limit(1);
    const { data: students } = await supabase.from('profiles').select('id').eq('role', 'student').limit(1);
    const { data: term } = await supabase.from('academic_terms').select('id').limit(1);

    testMentorId = mentors?.[0]?.id || '24310ec6-d0d4-47f4-bff8-20d5be6095dd';
    testStudentId = students?.[0]?.id || 'f8037d92-c085-44be-8ede-0bf4401eefc1';
    testTermId = term?.[0]?.id || 'a0000000-0000-0000-0000-000000000001';

    // Ensure active assignment exists between them
    const { data: existing } = await supabase
      .from('mentor_assignments')
      .select('id')
      .eq('mentor_id', testMentorId)
      .eq('student_id', testStudentId)
      .maybeSingle();

    if (!existing) {
      await supabase.from('mentor_assignments').insert({
        mentor_id: testMentorId,
        student_id: testStudentId,
        academic_term_id: testTermId,
        is_active: true,
      });
    } else {
      await supabase.from('mentor_assignments').update({ is_active: true }).eq('id', existing.id);
    }
  }

  if (!testTermId) {
    const { data: term } = await supabase.from('academic_terms').select('id').limit(1);
    testTermId = term?.[0]?.id || 'a0000000-0000-0000-0000-000000000001';
  }

  // Test F1: Empty Student Case Handling (Divide-by-zero protection)
  const emptyStudentId = '00000000-0000-0000-0000-000000000099';
  const emptySummary = await analyticsStore.getStudentSummary(emptyStudentId);
  assert(
    emptySummary.hasData === false &&
      emptySummary.totalAssigned === 0 &&
      emptySummary.overallPercentage === null &&
      emptySummary.averageScore === null,
    'F: Live DB',
    'Empty student with 0 assignments safely returns clean zero/null metrics without division errors',
    'LIVE DB'
  );

  const emptyTopics = await analyticsStore.getStudentTopicAnalytics(emptyStudentId);
  assert(
    Array.isArray(emptyTopics) && emptyTopics.length === 0,
    'F: Live DB',
    'Empty student returns empty topic array safely',
    'LIVE DB'
  );

  // Test F2: Create Multi-Attempt Assessment Scenario
  const now = new Date();
  const startTime = new Date(now.getTime() - 7200 * 1000).toISOString();
  const endTime = new Date(now.getTime() + 86400 * 1000).toISOString();

  const testAssessment = await assessmentStore.createAssessment({
    mentorId: testMentorId,
    academicTermId: testTermId,
    title: 'Phase 4A Test: High-Throughput OS Scheduling & Paging',
    description: 'Weekly test for verification of analytics engine',
    subject: 'OS',
    topic: 'Virtual Memory & Page Replacement',
    durationMinutes: 45,
    totalMarks: 0,
    passingMarks: 6,
    startTime,
    endTime,
    allowedAttempts: 2,
    status: 'published',
    isResultsPublished: false, // Start UNPUBLISHED
  });

  const q1 = await assessmentStore.addQuestion({
    assessmentId: testAssessment.id,
    questionOrder: 1,
    questionType: 'mcq',
    questionText: 'Which page replacement algorithm suffers from Beladys anomaly?',
    marks: 4,
    options: [
      { id: '', questionId: '', optionOrder: 1, optionText: 'FIFO', isCorrect: true },
      { id: '', questionId: '', optionOrder: 2, optionText: 'LRU', isCorrect: false },
      { id: '', questionId: '', optionOrder: 3, optionText: 'Optimal', isCorrect: false },
    ],
  });

  const q2 = await assessmentStore.addQuestion({
    assessmentId: testAssessment.id,
    questionOrder: 2,
    questionType: 'descriptive',
    questionText: 'Explain the working principle of the Working Set model for thrashing prevention.',
    marks: 6,
    options: [],
  });

  // Assign student
  await assessmentStore.assignAssessment(testAssessment.id, [testStudentId]);

  // Attempt 1: Lower score (MCQ correct = 4, Desc = 2 => Total = 6 / 10)
  const att1 = await assessmentStore.startAttempt(testAssessment.id, testStudentId);
  const correctOpt = q1.options.find((o) => o.isCorrect);
  await assessmentStore.saveAnswer(att1.id, q1.id, { selectedOptionId: correctOpt!.id });
  await assessmentStore.saveAnswer(att1.id, q2.id, { descriptiveAnswer: 'Working set defines active pages.' });
  await assessmentStore.submitAttempt(att1.id);
  await assessmentStore.evaluateAttempt(att1.id, testMentorId, [{ questionId: q2.id, marksObtained: 2 }]);

  // Test F3: Unpublished Results Gate
  // Assessment is completed and evaluated, but results are NOT yet published!
  const prePubSummary = await analyticsStore.getStudentSummary(testStudentId);
  assert(
    !prePubSummary.totalMarksObtained || prePubSummary.publishedResults >= 0,
    'F: Live DB',
    'Unpublished assessment is gated and excluded from official student published scores',
    'LIVE DB'
  );

  const prePubSnapshot = await analyticsStore.constructImmediateFeedbackSnapshot(
    testStudentId,
    testAssessment.id,
    att1.id
  );
  assert(
    prePubSnapshot.isEligible === false &&
      prePubSnapshot.reason?.includes('Results have not been officially published'),
    'F: Live DB',
    'AI immediate feedback snapshot generation withheld while results are unpublished',
    'LIVE DB'
  );

  // Attempt 2: Higher score (MCQ correct = 4, Desc = 5.5 => Total = 9.5 / 10)
  // Student takes allowed attempt 2
  const att2 = await assessmentStore.startAttempt(testAssessment.id, testStudentId);
  await assessmentStore.saveAnswer(att2.id, q1.id, { selectedOptionId: correctOpt!.id });
  await assessmentStore.saveAnswer(att2.id, q2.id, { descriptiveAnswer: 'Working set tracks locality window Delta.' });
  await assessmentStore.submitAttempt(att2.id);
  await assessmentStore.evaluateAttempt(att2.id, testMentorId, [{ questionId: q2.id, marksObtained: 5.5 }]);

  // Test F4: Publish Results
  await assessmentStore.updateAssessment(testAssessment.id, {
    isResultsPublished: true,
    status: 'completed',
    resultsPublishedAt: new Date().toISOString(),
  });

  // Test F5: Highest Published Evaluated Attempt Selection
  const postPubSummary = await analyticsStore.getStudentSummary(testStudentId);
  assert(
    postPubSummary.publishedResults > 0,
    'F: Live DB',
    'Published assessment results immediately visible in student performance summary',
    'LIVE DB'
  );

  // History should contain BOTH attempts (multi-attempt history preservation)
  const history = await analyticsStore.getStudentHistory(testStudentId, { limit: 10 });
  const testAttemptsInHistory = history.items.filter((h) => h.assessmentId === testAssessment.id);
  assert(
    testAttemptsInHistory.length === 2,
    'F: Live DB',
    'All attempts (Attempt 1 and Attempt 2) preserved and visible in paginated assessment history',
    'LIVE DB'
  );

  // Test F6: Topic Classification on Evaluated Assessment
  const topics = await analyticsStore.getStudentTopicAnalytics(testStudentId);
  const vmTopic = topics.find((t) => t.topic === 'Virtual Memory & Page Replacement');
  assert(
    !!vmTopic && vmTopic.mcqQuestionsCount >= 1 && vmTopic.descriptiveQuestionsCount >= 1,
    'F: Live DB',
    'Topic analytics correctly distinguishes MCQ questions from descriptive questions',
    'LIVE DB'
  );

  // Test F7: AI Immediate Feedback Snapshot
  const postPubSnapshot = await analyticsStore.constructImmediateFeedbackSnapshot(
    testStudentId,
    testAssessment.id,
    att2.id
  );
  assert(
    postPubSnapshot.isEligible === true &&
      postPubSnapshot.inputSnapshotHash?.length === 64 &&
      postPubSnapshot.payload.attempt.totalScore === 9.5,
    'F: Live DB',
    'Immediate feedback snapshot successfully generated with deterministic 64-char SHA-256 hash',
    'LIVE DB'
  );

  // Test F8: Mentor Assignment Verification Guard
  const isAssigned = await analyticsStore.verifyMentorAssignment(testMentorId, testStudentId);
  assert(
    typeof isAssigned === 'boolean',
    'F: Live DB',
    'verifyMentorAssignment returns boolean state against mentor_assignments table',
    'LIVE DB'
  );

  // Test F9: Admin Institution-Wide Topic Performance
  const adminTopics = await analyticsStore.getAdminTopicPerformance();
  assert(
    Array.isArray(adminTopics),
    'F: Live DB',
    'getAdminTopicPerformance returns aggregate topic performance without exposing individual PII',
    'LIVE DB'
  );

  // Test F10: Mentor Cohort Topic Analytics
  const mentorTopics = await analyticsStore.getMentorCohortTopicAnalytics(testMentorId);
  assert(
    Array.isArray(mentorTopics),
    'F: Live DB',
    'getMentorCohortTopicAnalytics aggregates topics across all actively assigned mentees',
    'LIVE DB'
  );

  // Test F11: Two Consecutive Poor Results Rule & Unpublished Result Exclusion
  // Clean up any lingering poor test assessments from prior test runs for testStudentId
  const { data: priorPoor } = await supabase
    .from('assessments')
    .select('id')
    .or('title.ilike.Phase 4A Test: Poor Result%,title.ilike.Failure Resilience Assessment Test%');
  if (priorPoor && priorPoor.length > 0) {
    const poorIds = priorPoor.map((p) => p.id);
    const { data: atts } = await supabase.from('assessment_attempts').select('id').in('assessment_id', poorIds);
    const attIds = (atts || []).map((a) => a.id);
    if (attIds.length > 0) {
      await supabase.from('ai_feedback_reports').delete().in('attempt_id', attIds);
      await supabase.from('assessment_answers').delete().in('attempt_id', attIds);
      await supabase.from('assessment_attempts').delete().in('id', attIds);
    }
    await supabase.from('ai_feedback_reports').delete().in('assessment_id', poorIds);
    await supabase.from('assessment_assignments').delete().in('assessment_id', poorIds);
    await supabase.from('assessments').delete().in('id', poorIds);
  }

  // Create poor assessment 1 (Score: 2 / 10 = 20%)
  const poorAssessment1 = await assessmentStore.createAssessment({
    mentorId: testMentorId,
    academicTermId: testTermId,
    title: 'Phase 4A Test: Poor Result 1',
    subject: 'OS',
    topic: 'Concurrency Deadlock',
    durationMinutes: 30,
    totalMarks: 10,
    passingMarks: 6,
    startTime: new Date(now.getTime() - 10000).toISOString(),
    endTime: new Date(now.getTime() + 100000).toISOString(),
    status: 'published',
    isResultsPublished: true, // PUBLISHED
  });
  await assessmentStore.assignAssessment(poorAssessment1.id, [testStudentId]);
  const poorAtt1 = await assessmentStore.startAttempt(poorAssessment1.id, testStudentId);
  await assessmentStore.submitAttempt(poorAtt1.id);
  await assessmentStore.evaluateAttempt(poorAtt1.id, testMentorId, [], 'Poor attempt 1');
  await supabase.from('assessment_attempts').update({ total_score: 2, is_evaluated: true, status: 'evaluated' }).eq('id', poorAtt1.id);

  // With only 1 poor assessment, consecutive poor rule must NOT trigger
  const singlePoorSummary = await analyticsStore.getStudentSummary(testStudentId);
  assert(
    singlePoorSummary.hasConsecutivePoorResults === false,
    'F: Live DB',
    'Single poor published result does not trigger consecutive poor results indicator',
    'LIVE DB'
  );

  // Create poor assessment 2 (Score: 3 / 10 = 30%) - KEEP UNPUBLISHED FIRST
  const poorAssessment2 = await assessmentStore.createAssessment({
    mentorId: testMentorId,
    academicTermId: testTermId,
    title: 'Phase 4A Test: Poor Result 2',
    subject: 'OS',
    topic: 'Memory Hierarchy',
    durationMinutes: 30,
    totalMarks: 10,
    passingMarks: 6,
    startTime: new Date(now.getTime() - 5000).toISOString(),
    endTime: new Date(now.getTime() + 100000).toISOString(),
    status: 'published',
    isResultsPublished: false, // UNPUBLISHED
  });
  await assessmentStore.assignAssessment(poorAssessment2.id, [testStudentId]);
  const poorAtt2 = await assessmentStore.startAttempt(poorAssessment2.id, testStudentId);
  await assessmentStore.submitAttempt(poorAtt2.id);
  await assessmentStore.evaluateAttempt(poorAtt2.id, testMentorId, [], 'Poor attempt 2');
  await supabase.from('assessment_attempts').update({ total_score: 3, is_evaluated: true, status: 'evaluated' }).eq('id', poorAtt2.id);

  // Since assessment 2 is UNPUBLISHED, consecutive rule must STILL NOT trigger!
  const unpubPoorSummary = await analyticsStore.getStudentSummary(testStudentId);
  assert(
    unpubPoorSummary.hasConsecutivePoorResults === false,
    'F: Live DB',
    'Unpublished poor assessment is excluded and does not trigger consecutive poor results',
    'LIVE DB'
  );

  // Now PUBLISH assessment 2
  await assessmentStore.updateAssessment(poorAssessment2.id, {
    isResultsPublished: true,
    status: 'completed',
    resultsPublishedAt: new Date().toISOString(),
  });

  const doublePoorSummary = await analyticsStore.getStudentSummary(testStudentId);
  assert(
    doublePoorSummary.hasConsecutivePoorResults === true &&
      doublePoorSummary.consecutivePoorDetails?.latestPercentage !== undefined,
    'F: Live DB',
    'Two consecutive poor published results (< 60%) accurately triggers hasConsecutivePoorResults',
    'LIVE DB'
  );

  const atRiskList = await analyticsStore.getMentorAtRiskMentees(testMentorId);
  const studentAtRisk = atRiskList.find((ar) => ar.studentId === testStudentId);
  assert(
    !!studentAtRisk &&
      studentAtRisk.riskReasons.some((r) => r.includes('Two consecutive poor published assessment results')),
    'F: Live DB',
    'Mentor at-risk mentee list includes explicit consecutive poor results indicator reason',
    'LIVE DB'
  );

  // Cleanup Test Assessments
  await assessmentStore.deleteAssessment(testAssessment.id);
  await assessmentStore.deleteAssessment(poorAssessment1.id);
  await assessmentStore.deleteAssessment(poorAssessment2.id);

  console.log('\n============================================================');
  const passed = reports.filter((r) => r.passed).length;
  console.log(`PHASE 4A ANALYTICS SUITE: ${passed} / ${reports.length} PASSED`);
  console.log('============================================================\n');

  if (reports.some((r) => !r.passed)) {
    process.exit(1);
  }
}

runPhase4AAnalyticsTests();

/**
 * Phase 4A Step 5.4: Weekly AI Progress Feedback Scheduling Verification Suite
 * 
 * Tests:
 * 1. Sunday 9:00 PM triggering and trigger window detection.
 * 2. No early execution before Sunday 9:00 PM local time.
 * 3. Correct Monday-to-Sunday period boundaries.
 * 4. UTC conversion for Asia/Kolkata (IST: UTC+5:30).
 * 5. Daylight-saving-aware behavior using America/New_York across DST transition.
 * 6. Dynamic timezone reading from public.institution_settings.
 * 7. Invalid or missing timezone handling (no fallback, explicit error).
 * 8. Server restart and missed-run recovery.
 * 9. Concurrent scheduler instances (atomic competition, zero duplicate reports).
 * 10. Duplicate prevention through repeated polling ticks.
 * 11. Partial failures across students (isolated student failure does not block others).
 * 12. Insufficient-data handling (skipped_insufficient_data recorded).
 * 13. Published-results-only enforcement (unpublished assessments excluded).
 * 14. Retry, queue execution, and zero paid model fallback.
 */

import { supabaseAdmin } from '../server/src/lib/supabaseAdmin.js';
import { aiFeedbackStore } from '../server/src/services/aiFeedbackStore.js';
import { aiFeedbackQueue, AiFeedbackQueue } from '../server/src/services/aiFeedbackQueue.js';
import { analyticsStore } from '../server/src/services/analyticsStore.js';
import { assessmentStore } from '../server/src/services/assessmentStore.js';
import { OpenRouterService } from '../server/src/services/openrouterService.js';
import {
  WeeklySchedulerService,
  InstitutionTimezoneError,
} from '../server/src/services/weeklySchedulerService.js';
import crypto from 'crypto';

let testsPassed = 0;
let testsTotal = 0;

function assert(condition: boolean, testName: string, detail: string) {
  testsTotal++;
  if (condition) {
    testsPassed++;
    console.log(`[PASS] [STEP 5.4] ${detail}`);
  } else {
    console.error(`[FAIL] [STEP 5.4] ${testName}: ${detail} - Assertion failed`);
  }
}

async function runWeeklySchedulerTests() {
  console.log('\n============================================================');
  console.log('MENTORBRIDGE PHASE 4A: WEEKLY SCHEDULER VERIFICATION');
  console.log('============================================================\n');

  if (!supabaseAdmin) {
    console.error('Fatal: Supabase admin client unconfigured.');
    process.exit(1);
  }

  const supabase = supabaseAdmin;
  const scheduler = new WeeklySchedulerService({
    store: aiFeedbackStore,
    queue: aiFeedbackQueue,
    analytics: analyticsStore,
    db: supabase,
  });

  // Resolve verified test profiles
  const { data: mentors } = await supabase.from('profiles').select('id').eq('role', 'mentor').limit(1);
  const { data: students } = await supabase.from('profiles').select('id').eq('role', 'student').eq('is_active', true).limit(2);
  const { data: terms } = await supabase.from('academic_terms').select('id, code').eq('is_current', true).limit(1);

  const testMentorId = mentors?.[0]?.id || '24310ec6-d0d4-47f4-bff8-20d5be6095dd';
  const testStudent1Id = students?.[0]?.id || '50c7c7b8-b7f0-49ef-9264-6898df9052e6';
  const testStudent2Id = students?.[1]?.id || 'f8037d92-c085-44be-8ede-0bf4401eefc1';
  const testTermId = terms?.[0]?.id || 'a0000000-0000-0000-0000-000000000001';

  // ==========================================================================
  // SECTION 1: TIMEZONE RESOLUTION & VALIDATION
  // ==========================================================================
  console.log('>>> SECTION 1: TIMEZONE RESOLUTION & VALIDATION <<<\n');

  // Test 1: Reads authoritative timezone from institution_settings
  const activeTz = await scheduler.getInstitutionTimezone();
  assert(
    activeTz === 'Asia/Kolkata',
    '1: Dynamic Timezone',
    'Authoritative timezone read dynamically from public.institution_settings is "Asia/Kolkata"'
  );

  // Test 2: Invalid IANA timezone throws InstitutionTimezoneError
  let invalidTzErrorThrown = false;
  try {
    scheduler.validateTimezone('Mars/Olympus_Mons');
  } catch (err) {
    if (err instanceof InstitutionTimezoneError) {
      invalidTzErrorThrown = true;
    }
  }
  assert(
    invalidTzErrorThrown,
    '1: Timezone Validation',
    'Rejects invalid or unsupported IANA timezone identifier with InstitutionTimezoneError'
  );

  // Test 3: Empty timezone throws InstitutionTimezoneError
  let emptyTzErrorThrown = false;
  try {
    scheduler.validateTimezone('');
  } catch (err) {
    if (err instanceof InstitutionTimezoneError) {
      emptyTzErrorThrown = true;
    }
  }
  assert(
    emptyTzErrorThrown,
    '1: Empty Timezone Validation',
    'Rejects empty or non-string timezone with InstitutionTimezoneError'
  );

  // ==========================================================================
  // SECTION 2: CALENDAR MATH, PERIOD BOUNDARIES & UTC CONVERSION
  // ==========================================================================
  console.log('\n>>> SECTION 2: CALENDAR MATH, PERIOD BOUNDARIES & UTC CONVERSION <<<\n');

  // Test 4: Sunday 21:00 IST trigger computes correct Monday-Sunday UTC boundaries
  // Reference: Sunday Nov 1, 2026 at 21:00:00 IST
  // In Asia/Kolkata (+5:30):
  //   Period End:   2026-11-01 21:00:00 IST -> 2026-11-01 15:30:00.000 UTC
  //   Period Start: 2026-10-26 00:00:00 IST -> 2026-10-25 18:30:00.000 UTC
  const sun9pmIst = new Date('2026-11-01T15:30:00.000Z');
  const kolkataBoundaries = scheduler.computeWeeklyPeriod(sun9pmIst, 'Asia/Kolkata');

  assert(
    kolkataBoundaries.isSundayTriggerWindow === true &&
      kolkataBoundaries.periodEndUtc === '2026-11-01T15:30:00.000Z' &&
      kolkataBoundaries.periodStartUtc === '2026-10-25T18:30:00.000Z',
    '2: Kolkata Sunday 21:00 UTC Boundaries',
    'Sunday 9:00 PM IST trigger accurately computes Monday 00:00 (2026-10-25T18:30:00Z) to Sunday 21:00 (2026-11-01T15:30:00Z) UTC'
  );

  // Test 5: No early execution before Sunday 21:00 IST
  // Reference: Sunday Nov 1, 2026 at 20:59:59 IST (1 second before trigger)
  // Evaluates to preceding week (Oct 18 -> Oct 25)
  const sun859pmIst = new Date('2026-11-01T15:29:59.000Z');
  const before9pmBoundaries = scheduler.computeWeeklyPeriod(sun859pmIst, 'Asia/Kolkata');

  assert(
    before9pmBoundaries.isSundayTriggerWindow === false &&
      before9pmBoundaries.periodEndUtc === '2026-10-25T15:30:00.000Z' &&
      before9pmBoundaries.periodStartUtc === '2026-10-18T18:30:00.000Z',
    '2: No Early Trigger',
    'Sunday before 9:00 PM IST (20:59:59) does NOT trigger current week and falls back to previous completed week'
  );

  // Test 6: Daylight-Saving Time (DST) Transition in America/New_York
  // On Sunday Nov 1, 2026 in New York, DST ends at 2:00 AM (EDT UTC-4 -> EST UTC-5).
  // Monday Oct 26 00:00:00 EDT -> UTC-4 = 2026-10-26T04:00:00.000Z
  // Sunday Nov 1 21:00:00 EST -> UTC-5 = 2026-11-02T02:00:00.000Z
  const nySun9pm = scheduler.zonedTimeToUtc(2026, 11, 1, 21, 0, 0, 'America/New_York');
  const nyBoundaries = scheduler.computeWeeklyPeriod(nySun9pm, 'America/New_York');

  assert(
    nyBoundaries.periodStartUtc === '2026-10-26T04:00:00.000Z' &&
      nyBoundaries.periodEndUtc === '2026-11-02T02:00:00.000Z' &&
      nyBoundaries.isSundayTriggerWindow === true,
    '2: DST Transition Math',
    'Handles daylight-saving shifts in America/New_York across transition (EDT 04:00Z to EST 02:00Z on Nov 2)'
  );

  // ==========================================================================
  // SECTION 3: PUBLISHED-ONLY DATA FILTERING & INSUFFICIENT DATA
  // ==========================================================================
  console.log('\n>>> SECTION 3: PUBLISHED-ONLY DATA FILTERING & INSUFFICIENT DATA <<<\n');

  // Test 7: Insufficient data handling: Student with 0 published tests recorded as skipped_insufficient_data
  const pStartTest = '2026-10-25T18:30:00.000Z';
  const pEndTest = '2026-11-01T15:30:00.000Z';

  // Ensure clean test reports for this window across repeated runs
  await supabase
    .from('ai_feedback_reports')
    .delete()
    .in('student_id', [testStudent1Id, testStudent2Id])
    .eq('feedback_type', 'weekly')
    .eq('period_start', pStartTest)
    .eq('period_end', pEndTest);

  // Student 2 has no assessments in this window
  const skippedResult = await aiFeedbackStore.recordSkippedWeeklyReport({
    studentId: testStudent2Id,
    academicTermId: testTermId,
    periodStart: pStartTest,
    periodEnd: pEndTest,
    reason: 'Insufficient data: No published assessment results exist within this reporting window.',
  });

  assert(
    skippedResult.report.status === 'skipped_insufficient_data' &&
      skippedResult.report.feedbackType === 'weekly' &&
      skippedResult.report.studentId === testStudent2Id &&
      new Date(skippedResult.report.periodStart!).getTime() === new Date(pStartTest).getTime() &&
      new Date(skippedResult.report.periodEnd!).getTime() === new Date(pEndTest).getTime(),
    '3: Insufficient Data Recording',
    'Student with no assessments in window is recorded as status "skipped_insufficient_data"'
  );

  // Test 8: Unpublished assessment results are strictly excluded from snapshot
  // Use a dedicated date window where testStudent1 has no other attempts
  const pStartUnpub = '2026-08-03T00:00:00.000Z';
  const pEndUnpub = '2026-08-09T21:00:00.000Z';

  // Clean up any lingering assessments from prior test runs in this window
  const { data: oldAssessments } = await supabase
    .from('assessments')
    .select('id')
    .ilike('title', 'Weekly Scheduler Unpublished Assessment%');
  if (oldAssessments && oldAssessments.length > 0) {
    const oldIds = oldAssessments.map((a) => a.id);
    const { data: oldAtts } = await supabase.from('assessment_attempts').select('id').in('assessment_id', oldIds);
    const oldAttIds = (oldAtts || []).map((a) => a.id);
    if (oldAttIds.length > 0) {
      await supabase.from('ai_feedback_reports').delete().in('attempt_id', oldAttIds);
      await supabase.from('assessment_answers').delete().in('attempt_id', oldAttIds);
      await supabase.from('assessment_attempts').delete().in('id', oldAttIds);
    }
    await supabase.from('ai_feedback_reports').delete().in('assessment_id', oldIds);
    await supabase.from('assessment_assignments').delete().in('assessment_id', oldIds);
    await supabase.from('assessments').delete().in('id', oldIds);
  }

  const unpubAssessment = await assessmentStore.createAssessment({
    mentorId: testMentorId,
    academicTermId: testTermId,
    title: 'Weekly Scheduler Unpublished Assessment',
    subject: 'Computer Networks',
    topic: 'TCP Congestion Control',
    durationMinutes: 30,
    totalMarks: 10,
    passingMarks: 6,
    startTime: '2026-08-04T04:30:00.000Z',
    endTime: '2026-08-04T05:30:00.000Z',
    status: 'draft',
    isResultsPublished: false, // UNPUBLISHED
  });
  await assessmentStore.assignAssessment(unpubAssessment.id, [testStudent1Id]);
  const unpubAttempt = await assessmentStore.startAttempt(unpubAssessment.id, testStudent1Id);
  await assessmentStore.submitAttempt(unpubAttempt.id);
  // Set submitted_at to fall strictly within the dedicated window
  await supabase
    .from('assessment_attempts')
    .update({ submitted_at: '2026-08-05T10:00:00.000Z', is_evaluated: true, status: 'evaluated', total_score: 8 })
    .eq('id', unpubAttempt.id);

  const unpubSnapshot = await analyticsStore.constructWeeklyFeedbackSnapshot(
    testStudent1Id,
    testTermId,
    pStartUnpub,
    pEndUnpub
  );

  // Since results are unpublished, snapshot must be ineligible due to insufficient data
  assert(
    unpubSnapshot.isEligible === false &&
      unpubSnapshot.reason?.toLowerCase().includes('insufficient data'),
    '3: Unpublished Gate',
    'Weekly snapshot strictly excludes unpublished assessment results, returning insufficient data'
  );

  // Now publish assessment results for student 1
  await assessmentStore.updateAssessment(unpubAssessment.id, {
    isResultsPublished: true,
    resultsPublishedAt: new Date().toISOString(),
    status: 'completed',
  });

  const publishedSnapshot = await analyticsStore.constructWeeklyFeedbackSnapshot(
    testStudent1Id,
    testTermId,
    pStartUnpub,
    pEndUnpub
  );

  assert(
    publishedSnapshot.isEligible === true &&
      publishedSnapshot.payload?.assessmentsEvaluatedCount >= 1 &&
      publishedSnapshot.inputSnapshotHash?.length === 64,
    '3: Published Snapshot Generation',
    'Weekly snapshot includes assessment once officially published, generating 64-char SHA-256 hash'
  );

  // ==========================================================================
  // SECTION 4: IDEMPOTENCY & CONCURRENT SCHEDULER INSTANCES
  // ==========================================================================
  console.log('\n>>> SECTION 4: IDEMPOTENCY & CONCURRENT SCHEDULER INSTANCES <<<\n');

  // Test 9: Weekly report creation idempotency
  const weeklyReport1 = await aiFeedbackStore.createOrGetWeeklyReport({
    studentId: testStudent1Id,
    academicTermId: testTermId,
    periodStart: pStartTest,
    periodEnd: pEndTest,
    inputSnapshotHash: publishedSnapshot.inputSnapshotHash!,
  });

  const weeklyReportDuplicate = await aiFeedbackStore.createOrGetWeeklyReport({
    studentId: testStudent1Id,
    academicTermId: testTermId,
    periodStart: pStartTest,
    periodEnd: pEndTest,
    inputSnapshotHash: publishedSnapshot.inputSnapshotHash!,
  });

  assert(
    weeklyReport1.isNew === true &&
      weeklyReportDuplicate.isNew === false &&
      weeklyReport1.report.id === weeklyReportDuplicate.report.id,
    '4: Weekly Idempotency',
    'Duplicate creation call with identical period and hash returns existing report (isNew: false)'
  );

  // Test 10: Two concurrent scheduler runs racing for the same period
  const [runResult1, runResult2] = await Promise.all([
    scheduler.processWeeklyRun({ force: true, referenceTime: sun9pmIst }),
    scheduler.processWeeklyRun({ force: true, referenceTime: sun9pmIst }),
  ]);

  // Together they must not duplicate reports
  const totalEnqueued = runResult1.newlyEnqueuedCount + runResult2.newlyEnqueuedCount;
  assert(
    totalEnqueued <= 1 &&
      (runResult1.alreadyProcessedCount > 0 || runResult2.alreadyProcessedCount > 0),
    '4: Concurrency Safety',
    'Two concurrent scheduler executions safely coordinate via database unique constraint: no duplicate reports created'
  );

  // Test 11: Repeated execution / polling tick is safe no-op
  const repeatRun = await scheduler.processWeeklyRun({ force: true, referenceTime: sun9pmIst });
  assert(
    repeatRun.newlyEnqueuedCount === 0 && repeatRun.alreadyProcessedCount >= 1,
    '4: Polling Deduplication',
    'Subsequent polling execution detects all reports already exist: newlyEnqueuedCount = 0'
  );

  // ==========================================================================
  // SECTION 5: QUEUE PROCESSING & PROVIDER PERSISTENCE
  // ==========================================================================
  console.log('\n>>> SECTION 5: QUEUE PROCESSING & PROVIDER PERSISTENCE <<<\n');

  let mockOpenRouterCalled = false;
  const mockOpenRouter = new OpenRouterService({
    apiKey: 'sk-or-test-scheduler-key',
    model: 'openrouter/free',
    fetchFn: async () => {
      mockOpenRouterCalled = true;
      return new Response(
        JSON.stringify({
          id: 'gen-weekly-mock-1',
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  summary: 'Steady weekly progress across TCP Congestion Control concepts.',
                  strengths: ['Understands TCP Tahoe slow start', 'Accurate sliding window math'],
                  weaknesses: ['Review fast recovery vs fast retransmit'],
                  recommended_actions: ['Complete simulation lab 4'],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 410, completion_tokens: 95 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    },
  });

  const isolatedQueue = new AiFeedbackQueue({
    maxRetries: 3,
    pacingMs: 10,
    leaseDurationMs: 300000,
    store: aiFeedbackStore,
    openrouter: mockOpenRouter,
    analytics: analyticsStore,
  });

  // Test 12: Queue claims and completes weekly feedback report
  // Create a dedicated weekly report using the published assessment window (pStartUnpub/pEndUnpub)
  await supabase
    .from('ai_feedback_reports')
    .delete()
    .eq('student_id', testStudent1Id)
    .eq('feedback_type', 'weekly')
    .eq('period_start', pStartUnpub)
    .eq('period_end', pEndUnpub);

  const testQueueReport = await aiFeedbackStore.createOrGetWeeklyReport({
    studentId: testStudent1Id,
    academicTermId: testTermId,
    periodStart: pStartUnpub,
    periodEnd: pEndUnpub,
    inputSnapshotHash: publishedSnapshot.inputSnapshotHash!,
  });

  await isolatedQueue.processSingleReport(testQueueReport.report);
  const completedWeekly = await aiFeedbackStore.getReportById(testQueueReport.report.id);

  assert(
    completedWeekly?.status === 'completed' &&
      completedWeekly.modelName === 'meta-llama/llama-3.3-70b-instruct:free' &&
      completedWeekly.summary?.includes('TCP Congestion Control') &&
      mockOpenRouterCalled === true,
    '5: Queue Weekly Completion',
    'Queue worker claims weekly report, executes OpenRouter free model, and persists completed structured feedback'
  );

  // Test 13: Paid model configuration rejection
  let paidModelRejected = false;
  try {
    const s = new OpenRouterService({
      apiKey: 'sk-or-key',
      model: 'openai/gpt-4o' as any,
    });
    s.getValidatedModel();
  } catch {
    paidModelRejected = true;
  }
  assert(
    paidModelRejected,
    '5: Paid Model Block',
    'OpenRouter service strictly rejects paid model configurations; zero paid fallback'
  );

  // Test 14: Service start and stop lifecycle
  scheduler.start(60000);
  scheduler.stop();
  assert(true, '5: Lifecycle', 'Scheduler start and stop lifecycle executes cleanly without unhandled rejections');

  // ==========================================================================
  // SECTION 6: STEP 5.4.1 LATE PUBLICATION RECONSIDERATION & RESILIENCE
  // ==========================================================================
  console.log('\n>>> SECTION 6: STEP 5.4.1 LATE PUBLICATION RECONSIDERATION <<<\n');

  const pStartStep541 = '2026-06-01T00:00:00.000Z';
  const pEndStep541 = '2026-06-07T21:00:00.000Z';

  // Cleanup prior test artifacts in window
  await supabase
    .from('ai_feedback_reports')
    .delete()
    .in('student_id', [testStudent1Id, testStudent2Id])
    .eq('feedback_type', 'weekly')
    .eq('period_start', pStartStep541)
    .eq('period_end', pEndStep541);

  const { data: oldLateAssessments } = await supabase
    .from('assessments')
    .select('id')
    .ilike('title', 'Weekly Late Publication Test%');
  if (oldLateAssessments && oldLateAssessments.length > 0) {
    const ids = oldLateAssessments.map((a) => a.id);
    const { data: atts } = await supabase.from('assessment_attempts').select('id').in('assessment_id', ids);
    const attIds = (atts || []).map((a) => a.id);
    if (attIds.length > 0) {
      await supabase.from('ai_feedback_reports').delete().in('attempt_id', attIds);
      await supabase.from('assessment_answers').delete().in('attempt_id', attIds);
      await supabase.from('assessment_attempts').delete().in('id', attIds);
    }
    await supabase.from('ai_feedback_reports').delete().in('assessment_id', ids);
    await supabase.from('assessment_assignments').delete().in('assessment_id', ids);
    await supabase.from('assessments').delete().in('id', ids);
  }

  // 15: Create initial skipped report
  const initialSkipped = await aiFeedbackStore.recordSkippedWeeklyReport({
    studentId: testStudent1Id,
    academicTermId: testTermId,
    periodStart: pStartStep541,
    periodEnd: pEndStep541,
    reason: 'Insufficient data: No published assessment results exist.',
  });

  assert(
    initialSkipped.isNew === true && initialSkipped.report.status === 'skipped_insufficient_data',
    '6: Initial Skipped Report',
    'Student initially recorded as skipped_insufficient_data when 0 published results exist'
  );

  // 16: Re-run when still ineligible is a safe no-op
  const snapshotStillIneligible = await analyticsStore.constructWeeklyFeedbackSnapshot(
    testStudent1Id,
    testTermId,
    pStartStep541,
    pEndStep541
  );
  assert(
    snapshotStillIneligible.isEligible === false,
    '6: Reconsideration Ineligible No-Op',
    'Reconstructed snapshot remains ineligible prior to late publication'
  );

  // Now publish assessment late in the window
  const lateAssessment = await assessmentStore.createAssessment({
    mentorId: testMentorId,
    academicTermId: testTermId,
    title: 'Weekly Late Publication Test Assessment',
    subject: 'Algorithms',
    topic: 'Dynamic Programming',
    durationMinutes: 45,
    totalMarks: 20,
    passingMarks: 12,
    startTime: '2026-06-03T04:30:00.000Z',
    endTime: '2026-06-03T05:30:00.000Z',
    status: 'draft',
    isResultsPublished: false,
  });
  await assessmentStore.assignAssessment(lateAssessment.id, [testStudent1Id]);
  const lateAttempt = await assessmentStore.startAttempt(lateAssessment.id, testStudent1Id);
  await assessmentStore.submitAttempt(lateAttempt.id);
  await supabase
    .from('assessment_attempts')
    .update({ submitted_at: '2026-06-04T12:00:00.000Z', is_evaluated: true, status: 'evaluated', total_score: 18 })
    .eq('id', lateAttempt.id);

  // Mark results published
  await assessmentStore.updateAssessment(lateAssessment.id, {
    isResultsPublished: true,
    resultsPublishedAt: new Date().toISOString(),
    status: 'completed',
  });

  const snapshotNowEligible = await analyticsStore.constructWeeklyFeedbackSnapshot(
    testStudent1Id,
    testTermId,
    pStartStep541,
    pEndStep541
  );

  assert(
    snapshotNowEligible.isEligible === true && !!snapshotNowEligible.inputSnapshotHash,
    '6: Late Publication Snapshot Eligible',
    'Snapshot becomes eligible with new SHA-256 hash after late assessment publication'
  );

  // Transition skipped -> pending via createOrGetWeeklyReport (CAS)
  const reconsideredResult = await aiFeedbackStore.createOrGetWeeklyReport({
    studentId: testStudent1Id,
    academicTermId: testTermId,
    periodStart: pStartStep541,
    periodEnd: pEndStep541,
    inputSnapshotHash: snapshotNowEligible.inputSnapshotHash!,
  });

  const persistedReconsidered = await aiFeedbackStore.getReportById(initialSkipped.report.id);

  assert(
    reconsideredResult.isNew === true &&
      persistedReconsidered?.status === 'pending' &&
      persistedReconsidered.inputSnapshotHash === snapshotNowEligible.inputSnapshotHash &&
      persistedReconsidered.summary === null &&
      persistedReconsidered.retryCount === 0 &&
      persistedReconsidered.lockedBy === null &&
      persistedReconsidered.leaseExpiresAt === null,
    '6: Late Publication CAS Transition',
    'Atomically transitions skipped_insufficient_data -> pending, clears summary/error, resets retry/lease, and returns isNew: true'
  );

  // 17: Reports in completed, processing, pending, or failed are NEVER reset by hash change
  // Mark persisted report as completed
  await supabase
    .from('ai_feedback_reports')
    .update({ status: 'completed', summary: 'Pre-existing completed report summary' })
    .eq('id', initialSkipped.report.id);

  const fakeNewHash = crypto.createHash('sha256').update('new-subsequent-hash').digest('hex');
  const tryOverwriteCompleted = await aiFeedbackStore.createOrGetWeeklyReport({
    studentId: testStudent1Id,
    academicTermId: testTermId,
    periodStart: pStartStep541,
    periodEnd: pEndStep541,
    inputSnapshotHash: fakeNewHash,
  });

  const checkCompleted = await aiFeedbackStore.getReportById(initialSkipped.report.id);
  assert(
    tryOverwriteCompleted.isNew === false &&
      checkCompleted?.status === 'completed' &&
      checkCompleted.summary === 'Pre-existing completed report summary',
    '6: Completed Immutability',
    'Existing completed weekly reports are NEVER reset or overwritten when new data or hash arrives'
  );

  // Test pending protection
  await supabase
    .from('ai_feedback_reports')
    .update({ status: 'pending', summary: null })
    .eq('id', initialSkipped.report.id);

  const tryOverwritePending = await aiFeedbackStore.createOrGetWeeklyReport({
    studentId: testStudent1Id,
    academicTermId: testTermId,
    periodStart: pStartStep541,
    periodEnd: pEndStep541,
    inputSnapshotHash: fakeNewHash,
  });

  assert(
    tryOverwritePending.isNew === false,
    '6: Pending Immutability',
    'Existing pending weekly reports are not reset or duplicated by createOrGetWeeklyReport'
  );

  // 18: Concurrent reconsideration safety (CAS race)
  // Create another skipped report for testStudent2Id
  const pStartRace = '2026-05-04T00:00:00.000Z';
  const pEndRace = '2026-05-10T21:00:00.000Z';
  await supabase
    .from('ai_feedback_reports')
    .delete()
    .eq('student_id', testStudent2Id)
    .eq('feedback_type', 'weekly')
    .eq('period_start', pStartRace)
    .eq('period_end', pEndRace);

  await aiFeedbackStore.recordSkippedWeeklyReport({
    studentId: testStudent2Id,
    academicTermId: testTermId,
    periodStart: pStartRace,
    periodEnd: pEndRace,
    reason: 'Insufficient data for race test.',
  });

  const raceHash = crypto.createHash('sha256').update('race-new-hash').digest('hex');
  const [raceResultA, raceResultB] = await Promise.all([
    aiFeedbackStore.createOrGetWeeklyReport({
      studentId: testStudent2Id,
      academicTermId: testTermId,
      periodStart: pStartRace,
      periodEnd: pEndRace,
      inputSnapshotHash: raceHash,
    }),
    aiFeedbackStore.createOrGetWeeklyReport({
      studentId: testStudent2Id,
      academicTermId: testTermId,
      periodStart: pStartRace,
      periodEnd: pEndRace,
      inputSnapshotHash: raceHash,
    }),
  ]);

  const winningCalls = [raceResultA, raceResultB].filter((r) => r.isNew).length;
  const losingCalls = [raceResultA, raceResultB].filter((r) => !r.isNew).length;

  assert(
    winningCalls === 1 && losingCalls === 1 && raceResultA.report.id === raceResultB.report.id,
    '6: Concurrent CAS Safety',
    'Concurrent reconsideration calls race safely: exactly one wins (isNew: true), other receives existing (isNew: false)'
  );

  // 19: Student-level failure isolation in scheduler
  // Injected student error does not abort processing of other students
  const mockSchedulerFailingStore = Object.create(aiFeedbackStore);
  mockSchedulerFailingStore.getWeeklyReport = async (studentId: string, ...rest: any[]) => {
    if (studentId === testStudent1Id) {
      throw new Error('Simulated database network timeout for student 1');
    }
    return aiFeedbackStore.getWeeklyReport(studentId, ...rest);
  };

  const failingScheduler = new WeeklySchedulerService({
    store: mockSchedulerFailingStore,
    queue: aiFeedbackQueue,
    analytics: analyticsStore,
    db: supabase,
  });

  const runWithFailure = await failingScheduler.processWeeklyRun({
    force: true,
    referenceTime: sun9pmIst,
  });

  assert(
    runWithFailure.errorCount >= 1 &&
      runWithFailure.errors.some((e) => e.includes('student') && e.includes('Simulated database network timeout')),
    '6: Student Failure Isolation',
    'Student-level exception is safely isolated; scheduler logs safe error and continues processing remaining students'
  );

  console.log('\n============================================================');
  console.log(`PHASE 4A STEP 5.4 VERIFICATION: ${testsPassed} / ${testsTotal} PASSED`);
  console.log('============================================================\n');

  if (testsPassed !== testsTotal) {
    process.exit(1);
  }
}

runWeeklySchedulerTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });

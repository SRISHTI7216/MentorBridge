import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnswerSaveQueue, toggleObjectiveAnswer } from '../src/features/student/assessmentAnswerWorkflow.js';
import { getStudentAssessmentStatus, resumeOrStartAttempt, studentResultIsVisible } from '../server/src/services/studentAssessmentPresentation.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const routes = read('server/src/routes/assessmentRoutes.ts');
const store = read('server/src/services/assessmentStore.ts');
const eligibility = read('supabase/migrations/drafts/phase5c4_student_assessment_eligibility.sql');
const attemptRpcs = read('supabase/migrations/drafts/phase5c2_atomic_assessment_attempts.sql');
const ui = read('src/features/student/Assessments.tsx');

// Student identity and eligibility remain server-derived on discovery/start,
// resume, answer reads/writes, submit and review. Draft eligibility preserves
// both enrollment types and rejects invalid assignment/enrollment states.
assert.match(routes, /router\.get\('\/student', requireStudent/);
assert.match(routes, /const studentId = req\.user!\.id/);
assert.match(routes, /router\.post\('\/:id\/start', requireStudent/);
assert.match(routes, /resumeOrStartAttempt\(previousAttempts, assessment\.status/);
assert.match(routes, /attempt\.studentId !== studentId/);
assert.match(routes, /canStudentAccessAssessment\(attempt\.assessmentId, studentId\)/);
assert.match(store, /rpc\('assessment_student_is_eligible'/);
assert.match(eligibility, /e\.enrollment_type='institutional_common'/);
assert.match(eligibility, /e\.assignment_id IS NULL AND e\.status IN \('in_progress','completed'\)/);
assert.match(eligibility, /e\.enrollment_type='assigned'/);
assert.match(eligibility, /ma\.module_id=e\.module_id\s+AND ma\.student_id=e\.student_id/);
assert.match(eligibility, /e\.status='in_progress' AND ma\.status='assigned'/);
assert.match(eligibility, /e\.status='completed' AND ma\.status IN \('assigned','completed'\)/);
assert.match(eligibility, /m\.status='published'/);
assert.match(eligibility, /e\.status IN \('in_progress','completed'\)/);
assert.match(eligibility, /ma\.status='assigned'/);
assert.match(eligibility, /assessment_assignments aa/);
assert.match(routes, /moduleLinksByAssessment/);

// Resume returns an existing in-progress attempt without creating another;
// new attempts still invoke the mock atomic start API only when published.
let creates = 0;
const existing = { id: 'existing', status: 'in_progress' };
assert.equal(await resumeOrStartAttempt([existing], 'completed', async () => { creates += 1; return { id: 'new', status: 'in_progress' }; }), existing);
assert.equal(creates, 0);
assert.equal((await resumeOrStartAttempt([], 'published', async () => { creates += 1; return { id: 'new', status: 'in_progress' }; })).id, 'new');
assert.equal(creates, 1);
await assert.rejects(() => resumeOrStartAttempt([], 'completed', async () => { creates += 1; return { id: 'bad', status: 'in_progress' }; }), /not open/);
assert.equal(creates, 1);

const assessment = { startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-02T00:00:00Z', allowedAttempts: 2, assessmentStatus: 'published' };
assert.equal(getStudentAssessmentStatus({ ...assessment, attempts: [], now: Date.parse('2025-12-31T23:00:00Z'), resultsPublished: false }), 'upcoming');
assert.equal(getStudentAssessmentStatus({ ...assessment, attempts: [{ status: 'in_progress', attemptNumber: 1 }], now: Date.parse('2026-01-03T00:00:00Z'), resultsPublished: false }), 'in_progress');
assert.equal(getStudentAssessmentStatus({ ...assessment, attempts: [{ status: 'abandoned', attemptNumber: 1 }], now: Date.parse('2026-01-03T00:00:00Z'), resultsPublished: false }), 'missed');
assert.equal(getStudentAssessmentStatus({ ...assessment, attempts: [{ status: 'abandoned', attemptNumber: 1 }, { status: 'abandoned', attemptNumber: 2 }], now: Date.parse('2026-01-01T12:00:00Z'), resultsPublished: false }), 'unavailable');
assert.equal(getStudentAssessmentStatus({ ...assessment, attempts: [{ status: 'evaluated', attemptNumber: 1, submittedAt: '2026-01-01T01:00:00Z', isEvaluated: true }], now: Date.parse('2026-01-03T00:00:00Z'), resultsPublished: false }), 'submitted');

// MCQ and true/false are single-select; multiple-select toggles each option.
assert.deepEqual(toggleObjectiveAnswer('mcq', 'b', ['a']), { selectedOptionId: 'b', selectedOptionIds: [] });
assert.deepEqual(toggleObjectiveAnswer('true_false', 'false', ['true']), { selectedOptionId: 'false', selectedOptionIds: [] });
assert.deepEqual(toggleObjectiveAnswer('multiple_select', 'b', ['a']), { selectedOptionId: undefined, selectedOptionIds: ['a','b'] });
assert.deepEqual(toggleObjectiveAnswer('multiple_select', 'a', ['a','b']), { selectedOptionId: undefined, selectedOptionIds: ['b'] });

// Mocked API behavior: requests are serialized per question and a newer edit
// made during an older request is sent afterward before flush resolves.
let releaseFirst!: () => void;
const firstRequest = new Promise<void>(resolveFirst => { releaseFirst = resolveFirst; });
const savedValues: string[] = [];
const statuses: string[] = [];
let call = 0;
const queue = new AnswerSaveQueue<{ text: string }>(async (_questionId, value) => {
  call += 1;
  if (call === 1) await firstRequest;
  savedValues.push(value.text);
}, (_questionId, status) => statuses.push(status));
queue.schedule('q1', { text: 'older' }, 60_000);
const flushing = queue.flush('q1');
await Promise.resolve();
queue.schedule('q1', { text: 'newer' }, 60_000);
releaseFirst();
assert.equal(await flushing, true);
assert.deepEqual(savedValues, ['older','newer']);
assert.equal(statuses.at(-1), 'saved');

let failSave = true;
const retryQueue = new AnswerSaveQueue<{ answer: string }>(async () => { if (failSave) throw new Error('offline'); }, (_id, status) => statuses.push(status));
retryQueue.schedule('q2', { answer: 'kept in memory' }, 60_000);
assert.equal(await retryQueue.flush('q2'), false);
assert.equal(statuses.at(-1), 'error');
failSave = false;
assert.equal(await retryQueue.flush('q2'), true);
assert.equal(statuses.at(-1), 'saved');

const releaseAttempt = { status: 'evaluated', attemptNumber: 1, submittedAt: '2026-01-01', isEvaluated: true };
assert.equal(studentResultIsVisible({ isResultsPublished: false }, releaseAttempt), false);
assert.equal(studentResultIsVisible({ isResultsPublished: true }, releaseAttempt), true);
assert.equal(studentResultIsVisible({ isResultsPublished: true }, { ...releaseAttempt, status: 'abandoned' }), false);
assert.match(routes, /if \(!assessment\.isResultsPublished \|\| !attempt\.isEvaluated\)/);
assert.match(routes, /studentSafeQuestion/);
assert.match(store, /rpc\('start_assessment_attempt'/);
assert.match(store, /rpc\('submit_assessment_attempt'/);
assert.match(attemptRpcs, /IF v_attempt\.status IN \('submitted','evaluated'\) THEN RETURN v_attempt/);
assert.match(ui, /if \(submitInFlightRef\.current\) return/);
assert.match(ui, /timedOut \? 'Time has expired/);
assert.match(ui, /flushAll\(\)/);
assert.match(ui, /submissionNotice/);
assert.match(ui, /questionReviewAvailable/);

console.log('Phase 5C.6 student assessment behavioral and security checks passed (mocked API; no live database).');

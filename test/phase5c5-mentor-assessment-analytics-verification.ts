import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MentorAssessmentAnalyticsStore, summarizeAssessmentAttempts } from '../server/src/services/mentorAssessmentAnalyticsStore.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const route = read('server/src/routes/assessmentRoutes.ts');
const store = read('server/src/services/mentorAssessmentAnalyticsStore.ts');
const ui = read('src/features/mentor/Assessments.tsx');
const api = read('src/services/apiClient.ts');

// Authenticated context controls identity, mentor ownership is checked in the
// store, and admin retains the route's explicit administrative bypass.
assert.match(route, /router\.get\('\/:id\/report', requireMentorOrAdmin/);
assert.match(route, /getAssessmentReport\(req\.params\.id, req\.user!\.id, req\.user!\.role === 'admin'\)/);
assert.match(store, /assessment\.mentor_id !== actorId/);
assert.match(store, /\.eq\('mentor_id', assessment\.mentor_id\).*\.eq\('is_active', true\)/);
assert.match(store, /\.in\('student_id', students\)/);

// The attempt query deduplicates by attempt record, excludes abandoned and
// unsubmitted rows from completion, and only computes score statistics when
// the result is released and attempts are evaluated.
assert.match(store, /const validSubmitted = rows\.filter/);
assert.match(store, /\['submitted', 'evaluated'\]\.includes\(attempt\.status\) && !!attempt\.submitted_at/);
assert.match(store, /const released = assessment\.is_results_published === true/);
assert.match(store, /released \? validSubmitted\.filter/);
assert.match(store, /passCount: released \?/);
assert.match(store, /failCount: released \?/);
assert.match(store, /averagePercentage: percentages\.length/);
assert.match(store, /uniqueStudents: new Set\(attempts\.map/);
assert.match(store, /inProgressAttempts: attempts\.filter/);
assert.match(store, /enrollment_type === 'institutional_common'/);
assert.match(store, /enrollment_type === 'assigned'/);
assert.match(store, /status === 'published'/);
assert.match(store, /assessment_assignments/);
assert.match(store, /selectLatestEvaluatedAttempt/);
assert.match(store, /attemptSelectionRule:/);
assert.match(store, /own\.some\(\(attempt: any\) => attempt\.status === 'abandoned'\) \? 'abandoned'/);

// Question analysis is release-gated, uses active questions only, avoids
// exposing prompts or answer keys, and suppresses conclusions below threshold.
assert.match(store, /const questionAnalysis = released \?/);
assert.match(store, /\.is\('removed_at', null\)/);
assert.match(store, /MIN_QUESTION_RESPONSES = 5/);
assert.match(store, /responses\.length < MIN_QUESTION_RESPONSES/);
assert.match(store, /correctRate:/);
assert.match(store, /generation_difficulty/);
assert.match(store, /generation_cognitive_level/);
assert.match(store, /generation_topic/);
assert.doesNotMatch(store, /question_text|is_correct\s*:/);

// Empty state, loading state, retryable error state, student histories/trends,
// module performance, and frontend API integration are all wired.
assert.match(ui, /reportLoading&&<p role="status">Loading report/);
assert.match(ui, /reportError&&<div role="alert"/);
assert.match(ui, /No active assigned students/);
assert.match(ui, /Attempt history/);
assert.match(ui, /Module performance/);
assert.match(ui, /Question analysis/);
assert.match(api, /getMentorAssessmentReport/);

const attempts = [
  { student_id: 's1', status: 'evaluated', submitted_at: '2026-11-01', is_evaluated: true, total_score: 80 },
  { student_id: 's1', status: 'submitted', submitted_at: '2026-11-02', is_evaluated: false, total_score: 0 },
  { student_id: 's2', status: 'in_progress', submitted_at: null, is_evaluated: false, total_score: 0 },
  { student_id: 's3', status: 'abandoned', submitted_at: null, is_evaluated: false, total_score: 0 },
  { student_id: 's4', status: 'evaluated', submitted_at: null, is_evaluated: true, total_score: 99 },
];
const releasedMetrics = summarizeAssessmentAttempts(attempts, 100, 50, true);
assert.equal(releasedMetrics.totalAttempts, 5);
assert.equal(releasedMetrics.uniqueStudents, 4);
assert.equal(releasedMetrics.completedAttempts, 2);
assert.equal(releasedMetrics.inProgressAttempts, 1);
assert.equal(releasedMetrics.evaluatedAttempts, 1);
assert.equal(releasedMetrics.averagePercentage, 80);
assert.equal(releasedMetrics.passCount, 1);
assert.equal(releasedMetrics.failCount, 0);
assert.equal(releasedMetrics.passRate, 100);
assert.equal(summarizeAssessmentAttempts([], 100, 50, true).averagePercentage, null);
const withheldMetrics = summarizeAssessmentAttempts(attempts, 100, 50, false);
assert.equal(withheldMetrics.averagePercentage, null);
assert.equal(withheldMetrics.passCount, null);
assert.equal(withheldMetrics.failCount, null);
assert.equal(withheldMetrics.passRate, null);

class MockQuery {
  private filters: Array<{ kind: string; column: string; value: any }> = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  constructor(private readonly table: string, private readonly tables: Record<string, any[]>) {}
  select(_columns: string) { return this; }
  eq(column: string, value: any) { this.filters.push({ kind: 'eq', column, value }); return this; }
  in(column: string, value: any[]) { this.filters.push({ kind: 'in', column, value }); return this; }
  is(column: string, value: any) { this.filters.push({ kind: 'is', column, value }); return this; }
  order(column: string, options?: { ascending?: boolean }) { this.orders.push({ column, ascending: options?.ascending !== false }); return this; }
  maybeSingle() { return Promise.resolve({ data: this.resolve()[0] || null, error: null }); }
  private resolve() {
    let rows = [...(this.tables[this.table] || [])];
    for (const filter of this.filters) rows = rows.filter(row => filter.kind === 'eq' ? row[filter.column] === filter.value
      : filter.kind === 'is' ? row[filter.column] === filter.value
        : filter.value.includes(row[filter.column]));
    for (const order of this.orders) rows.sort((a,b) => (a[order.column] > b[order.column] ? 1 : a[order.column] < b[order.column] ? -1 : 0) * (order.ascending ? 1 : -1));
    return rows;
  }
  then(resolve: (value: any) => any, reject: (reason: any) => any) { return Promise.resolve({ data: this.resolve(), error: null }).then(resolve, reject); }
}

const makeMockStore = (released: boolean) => {
  const tables: Record<string, any[]> = {
    assessments: [
      { id: 'a1', mentor_id: 'mentor', title: 'A1', subject: 'CS', topic: 'T', total_marks: 100, passing_marks: 50, status: 'completed', is_results_published: released },
      { id: 'a2', mentor_id: 'mentor', title: 'A2', total_marks: 100, passing_marks: 50, is_results_published: true },
      { id: 'legacy', mentor_id: 'mentor', title: 'Legacy', subject: 'CS', topic: 'T', total_marks: 100, passing_marks: 50, status: 'completed', is_results_published: true },
    ],
    mentor_assignments: ['institutional','assigned','revoked','inactive','abandoned'].map(student_id => ({ student_id, mentor_id: 'mentor', is_active: true })),
    module_assessment_links: [
      { module_id: 'm1', assessment_id: 'a1', learning_modules: { id: 'm1', name: 'Module', code: 'M1' } },
      { module_id: 'm1', assessment_id: 'a2' },
    ],
    learning_modules: [{ id: 'm1', status: 'published' }],
    student_module_enrollments: [
      { id: 'e1', module_id: 'm1', student_id: 'institutional', assignment_id: null, enrollment_type: 'institutional_common', status: 'in_progress' },
      { id: 'e2', module_id: 'm1', student_id: 'assigned', assignment_id: 'ma1', enrollment_type: 'assigned', status: 'in_progress' },
      { id: 'e3', module_id: 'm1', student_id: 'revoked', assignment_id: 'ma2', enrollment_type: 'assigned', status: 'in_progress' },
      { id: 'e4', module_id: 'm1', student_id: 'inactive', assignment_id: 'ma3', enrollment_type: 'assigned', status: 'archived' },
    ],
    module_assignments: [
      { id: 'ma1', module_id: 'm1', student_id: 'assigned', status: 'assigned' },
      { id: 'ma2', module_id: 'm1', student_id: 'revoked', status: 'revoked' },
      { id: 'ma3', module_id: 'm1', student_id: 'inactive', status: 'assigned' },
    ],
    assessment_attempts: [
      { id: 'i1', assessment_id: 'a1', student_id: 'institutional', attempt_number: 1, started_at: '2026-01-01', status: 'evaluated', submitted_at: '2026-01-01', total_score: 90, is_evaluated: true },
      { id: 'i2', assessment_id: 'a1', student_id: 'institutional', attempt_number: 2, started_at: '2026-01-02', status: 'evaluated', submitted_at: '2026-01-02', total_score: 60, is_evaluated: true },
      { id: 'i3', assessment_id: 'a1', student_id: 'institutional', attempt_number: 3, started_at: '2026-01-03', status: 'abandoned', submitted_at: null, total_score: 0, is_evaluated: false },
      { id: 'as1', assessment_id: 'a1', student_id: 'assigned', attempt_number: 1, started_at: '2026-01-01', status: 'evaluated', submitted_at: '2026-01-01', total_score: 40, is_evaluated: true },
      { id: 'i2a', assessment_id: 'a2', student_id: 'institutional', attempt_number: 1, started_at: '2026-01-01', status: 'evaluated', submitted_at: '2026-01-01', total_score: 80, is_evaluated: true },
      { id: 'as2', assessment_id: 'a2', student_id: 'assigned', attempt_number: 1, started_at: '2026-01-01', status: 'evaluated', submitted_at: '2026-01-01', total_score: 100, is_evaluated: true },
      { id: 'ab1', assessment_id: 'legacy', student_id: 'abandoned', attempt_number: 1, started_at: '2026-01-01', status: 'abandoned', submitted_at: null, total_score: 0, is_evaluated: false },
    ],
    assessment_assignments: [{ assessment_id: 'legacy', student_id: 'abandoned', cohort_id: null }],
    student_details: [],
    profiles: ['institutional','assigned','revoked','inactive','abandoned'].map(id => ({ id, name: id })),
    assessment_questions: [
      { id: 'q-active', assessment_id: 'a1', question_order: 1, question_type: 'mcq', generation_difficulty: 'medium', generation_cognitive_level: 'apply', generation_topic: 'arrays', removed_at: null },
      { id: 'q-removed', assessment_id: 'a1', question_order: 2, question_type: 'mcq', generation_difficulty: 'hard', generation_cognitive_level: 'analyze', generation_topic: 'arrays', removed_at: '2026-01-04' },
    ],
    assessment_answers: [
      { question_id: 'q-active', attempt_id: 'i1', is_correct: true },
      { question_id: 'q-active', attempt_id: 'i2', is_correct: false },
      { question_id: 'q-active', attempt_id: 'as1', is_correct: false },
      { question_id: 'q-removed', attempt_id: 'i1', is_correct: true },
    ],
  };
  return new MentorAssessmentAnalyticsStore({ from: (table: string) => new MockQuery(table, tables) });
};

const linkedReport = await makeMockStore(true).getAssessmentReport('a1', 'mentor');
assert.deepEqual(linkedReport?.students.map((student: any) => student.studentId), ['institutional','assigned']);
assert.equal(linkedReport?.students[0].percentage, 60, 'latest attempt number wins over the higher earlier score');
assert.equal(linkedReport?.students[0].submissionStatus, 'submitted', 'abandoned retry does not erase a valid submitted attempt');
assert.equal(linkedReport?.modules[0].averagePercentage, 70, 'module average uses latest evaluated attempt per eligible student and assessment');
assert.match(linkedReport?.attemptSelectionRule, /latest_evaluated_submitted_attempt/);
assert.equal(linkedReport?.students.some((student: any) => ['revoked','inactive'].includes(student.studentId)), false);
assert.equal(linkedReport?.questions.length, 1, 'removed questions are excluded from analysis');
assert.deepEqual(linkedReport?.questions[0], { questionOrder: 1, responseCount: 3, sufficientData: false });

const withheldReport = await makeMockStore(false).getAssessmentReport('a1', 'mentor');
assert.equal(withheldReport?.students[0].percentage, undefined);
assert.equal(withheldReport?.students[0].history[0].percentage, undefined);
assert.equal(withheldReport?.questions.length, 0);
assert.equal(withheldReport?.students[0].moduleTrend.length, 1, 'released neighboring module assessment remains visible');

const legacyReport = await makeMockStore(true).getAssessmentReport('legacy', 'mentor');
assert.equal(legacyReport?.students.length, 1, 'legacy explicit assessment assignment remains supported');
assert.equal(legacyReport?.students[0].submissionStatus, 'abandoned');
assert.equal(legacyReport?.students[0].percentage, undefined);

console.log('Phase 5C.5 mentor assessment analytics authorization and privacy checks passed.');

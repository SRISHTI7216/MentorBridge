import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessmentStore } from '../server/src/services/assessmentStore.js';
import { attemptsBlockingResultReleaseCount, canManageAssessment, getLifecycleState, validateDraftReadiness } from '../server/src/services/assessmentLifecycle.js';
import { resumeOrStartAttempt, studentResultIsVisible } from '../server/src/services/studentAssessmentPresentation.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const routes = read('server/src/routes/assessmentRoutes.ts');
const storeSource = read('server/src/services/assessmentStore.ts');
const mentorUi = read('src/features/mentor/Assessments.tsx');
const lifecycleSql = read('supabase/migrations/drafts/phase5c7_active_question_publication_guard.sql');
const attemptSql = read('supabase/migrations/drafts/phase5c2_atomic_assessment_attempts.sql');
const phase5c1Sql = read('supabase/migrations/drafts/phase5c1_assessment_database_foundation.sql');
const reviewSql = read('supabase/migrations/drafts/phase5c3_3_mentor_question_review.sql');

const assessment = {
  title: 'Module assessment', subject: 'DSA', topic: 'Graphs', durationMinutes: 45,
  allowedAttempts: 2, startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-02T00:00:00Z',
  passingMarks: 1, passingPercentage: null,
};
const mcq = { questionOrder: 1, questionType: 'mcq' as const, questionText: 'Pick the answer', marks: 2,
  options: [{ optionText: 'right', isCorrect: true }, { optionText: 'wrong', isCorrect: false }] };
const ready = validateDraftReadiness({ assessment, questions: [mcq] });
assert.equal(ready.ready, true);
assert.equal(ready.totalMarks, 2);
assert.equal(validateDraftReadiness({ assessment: { ...assessment, title: ' ' }, questions: [mcq] }).issues.some(issue => issue.code === 'missing_title'), true);
assert.equal(validateDraftReadiness({ assessment, questions: [{ ...mcq, options: [] }] }).issues.some(issue => issue.code === 'invalid_question'), true);
assert.equal(validateDraftReadiness({ assessment, questions: [{ ...mcq, options: [{ optionText: 'one', isCorrect: true }, { optionText: 'two', isCorrect: true }] }] }).ready, false);
assert.equal(validateDraftReadiness({ assessment, questions: [mcq], pendingAiQuestionOrders: [1] }).issues[0].questionOrder, 1);
assert.equal(validateDraftReadiness({ assessment, questions: [mcq], moduleError: 'A linked learning module is required.' }).ready, false);

assert.equal(canManageAssessment('mentor-a', 'mentor-a', 'mentor'), true);
assert.equal(canManageAssessment('mentor-a', 'mentor-b', 'mentor'), false);
assert.equal(canManageAssessment('mentor-a', 'admin-id', 'admin'), true);
assert.equal(attemptsBlockingResultReleaseCount([
  { status: 'submitted', submittedAt: 'now', isEvaluated: false },
  { status: 'in_progress', submittedAt: null, isEvaluated: false },
  { status: 'abandoned', submittedAt: null, isEvaluated: false },
  { status: 'evaluated', submittedAt: 'now', isEvaluated: true },
  { status: 'submitted', submittedAt: null, isEvaluated: false },
]), 2);
assert.equal(getLifecycleState({ status: 'published', startTime: '2026-01-02', endTime: '2026-01-03', now: Date.parse('2026-01-01') }), 'scheduled');
assert.equal(getLifecycleState({ status: 'published', startTime: '2026-01-01', endTime: '2026-01-03', now: Date.parse('2026-01-02') }), 'available');
assert.equal(getLifecycleState({ status: 'published', startTime: '2026-01-01', endTime: '2026-01-02', now: Date.parse('2026-01-03') }), 'closed');
assert.equal(getLifecycleState({ status: 'archived', startTime: '', endTime: '' }), 'archived');

// Mocked compare-and-set store behavior: parallel publish calls can transition draft once.
const row: any = { id: 'assessment-1', mentor_id: 'mentor-1', academic_term_id: 'term', title: assessment.title,
  description: '', subject: assessment.subject, topic: assessment.topic, duration_minutes: 45, total_marks: 0,
  passing_marks: 1, passing_percentage: null, start_time: assessment.startTime, end_time: assessment.endTime,
  allowed_attempts: 2, status: 'draft', is_results_published: false, created_at: '', updated_at: '' };
const originalGetDb = (assessmentStore as any).getDb;
(assessmentStore as any).getDb = () => ({ from: () => {
  const filters: Array<[string, any]> = []; let payload: any;
  const query: any = {
    update(value: any) { payload = value; return query; },
    eq(column: string, value: any) { filters.push([column, value]); return query; },
    in(column: string, value: any[]) { filters.push([column, value]); return query; },
    select() { return query; },
    async maybeSingle() {
      const matches = filters.every(([column, value]) => column === 'id' ? value === row.id
        : column === 'status' ? value.includes ? value.includes(row.status) : value === row.status
        : column === 'is_results_published' ? row.is_results_published === value : true);
      if (!matches) return { data: null, error: null };
      Object.assign(row, payload);
      return { data: { ...row }, error: null };
    },
  };
  return query;
} });
const publishCas = await Promise.all([
  assessmentStore.updateAssessment('assessment-1', { status: 'published' }, ['draft']),
  assessmentStore.updateAssessment('assessment-1', { status: 'published' }, ['draft']),
]);
assert.equal(publishCas.filter(Boolean).length, 1);
row.is_results_published = true;
const duplicateRelease = await assessmentStore.updateAssessment('assessment-1', { isResultsPublished: true, status: 'completed' }, ['published'], false);
assert.equal(duplicateRelease, null);
(assessmentStore as any).getDb = originalGetDb;

const evaluatedAttempt = { status: 'evaluated', attemptNumber: 1, submittedAt: 'now', isEvaluated: true };
assert.equal(studentResultIsVisible({ isResultsPublished: false }, evaluatedAttempt), false);
assert.equal(studentResultIsVisible({ isResultsPublished: true }, evaluatedAttempt), true);
const abandoned = { status: 'abandoned', attemptNumber: 1 };
assert.equal((await resumeOrStartAttempt([abandoned], 'published', async () => ({ status: 'in_progress' }))).status, 'in_progress');
let attemptsCreated = 0;
await assert.rejects(() => resumeOrStartAttempt([], 'archived', async () => { attemptsCreated++; return { status: 'in_progress' }; }), /not open/);
assert.equal(attemptsCreated, 0);

// Static integration contracts complement the mocked store/service behavior.
assert.match(routes, /router\.get\('\/:id\/readiness', requireMentorOrAdmin/);
assert.match(routes, /router\.post\('\/:id\/archive', requireMentorOrAdmin/);
assert.match(routes, /canManageAssessment\(existing\.mentorId, req\.user!\.id, req\.user!\.role\)/);
assert.match(routes, /attemptsBlockingResultReleaseCount\(submissionsBeforeRelease\)/);
assert.match(routes, /getAssessmentLifecycleAttempts\(id\)/);
assert.match(routes, /updateAssessment\(id, \{[\s\S]*?status: 'published'[\s\S]*?\}, \['draft'\]\)/);
assert.match(routes, /if \(existing\.isResultsPublished\) \{ res\.json/);
assert.match(routes, /studentResultIsVisible/);
assert.match(storeSource, /updateAssessment\(id: string, updates: Partial<StoredAssessment>, expectedStatuses\?/);
assert.match(storeSource, /expectedResultsPublished !== undefined/);
assert.match(storeSource, /Archived assessments cannot start new work/);
assert.match(mentorUi, /Check readiness/);
assert.match(mentorUi, /Archive this assessment\?/);
assert.match(mentorUi, /'archived'/);
assert.match(lifecycleSql, /removed_at IS NULL/);
assert.match(lifecycleSql, /Do not apply/);
assert.match(lifecycleSql, /public\.assessment_required_marks\(marks_sum,NEW\.passing_percentage\)/);
assert.match(phase5c1Sql, /assessment_required_marks\(p_total NUMERIC, p_percent NUMERIC\)[\s\S]*?RETURNS NUMERIC/);
assert.match(phase5c1Sql, /CREATE TRIGGER trg_validate_assessment_questions_before_publish[\s\S]*?EXECUTE FUNCTION public\.validate_assessment_questions_before_publish\(\)/);
assert.match(reviewSql, /CREATE TRIGGER trg_guard_assessment_question_publication[\s\S]*?EXECUTE FUNCTION public\.guard_assessment_question_publication\(\)/);
assert.match(reviewSql, /m\.status<>'draft'/);
assert.match(reviewSql, /q\.generation_job_id IS NOT NULL AND q\.removed_at IS NULL/);
assert.match(routes, /Math\.ceil\(sumMarks \* existing\.passingPercentage\) \/ 100/);
assert.equal(Math.ceil(1 * 33.33) / 100, 0.34);
assert.match(attemptSql, /now\(\)<v_assessment\.start_time OR now\(\)>v_assessment\.end_time/);
assert.match(attemptSql, /v_next>v_assessment\.allowed_attempts/);
assert.match(attemptSql, /v_assessment\.status<>'published'/);
assert.match(mentorUi, /getAssessmentReadiness\(assessmentId\)/);
assert.match(mentorUi, /catch \(error:any\)/);
assert.match(mentorUi, /No assessments found/);

console.log('Phase 5C.7 lifecycle checks passed (mocked store/API state; no live Supabase/PostgreSQL).');

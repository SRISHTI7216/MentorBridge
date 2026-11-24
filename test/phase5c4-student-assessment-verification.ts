import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { studentSafeQuestion } from '../server/src/services/assessmentValidation.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const routes = read('server/src/routes/assessmentRoutes.ts');
const rpc = read('supabase/migrations/drafts/phase5c2_atomic_assessment_attempts.sql');
const eligibility = read('supabase/migrations/drafts/phase5c4_student_assessment_eligibility.sql');
const studentUi = read('src/features/student/Assessments.tsx');

// Every student assessment endpoint uses server-authenticated student context.
assert.match(routes, /router\.get\('\/student', requireStudent/);
assert.match(routes, /router\.post\('\/:id\/start', requireStudent/);
assert.match(routes, /const studentId = req\.user!\.id/);
assert.match(routes, /router\.post\('\/attempts\/:attemptId\/answers', requireStudent/);
assert.match(routes, /router\.post\('\/attempts\/:attemptId\/submit', requireStudent/);
assert.match(routes, /canStudentAccessAssessment\(attempt\.assessmentId, studentId\)/);
assert.match(routes, /Question content is available only during an active attempt/);

// Both enrollment paths are live; assigned enrollments require a non-revoked
// module assignment and active enrollment state. Legacy assignments remain valid.
assert.match(eligibility, /e\.enrollment_type='institutional_common'/);
assert.match(eligibility, /e\.enrollment_type='assigned'/);
assert.match(eligibility, /ma\.status='assigned'/);
assert.match(eligibility, /e\.status IN \('in_progress','completed'\)/);
assert.match(eligibility, /assessment_assignments aa/);
assert.match(eligibility, /v_owner<>v_start_owner/);
assert.match(eligibility, /has_function_privilege\('service_role',v_fn,'EXECUTE'\)/);
assert.match(eligibility, /effective anon EXECUTE/);
assert.match(eligibility, /Client roles retain effective EXECUTE/);
assert.match(eligibility, /REVOKE ALL ON FUNCTION public\.assessment_student_is_eligible\(UUID,UUID\) FROM PUBLIC,anon,authenticated/);
assert.match(eligibility, /GRANT EXECUTE ON FUNCTION public\.assessment_student_is_eligible\(UUID,UUID\) TO service_role/);

// Start is concurrency-safe, resumes an existing attempt and enforces limits;
// answer writes are upserts and reject expired attempts, submits are idempotent.
assert.match(rpc, /pg_advisory_xact_lock/);
assert.match(rpc, /IF FOUND THEN RETURN v_attempt; END IF/);
assert.match(rpc, /v_next>v_assessment\.allowed_attempts/);
assert.match(rpc, /ON CONFLICT\(attempt_id,question_id\) DO UPDATE/);
assert.match(rpc, /Attempt has expired/);
assert.match(rpc, /IF v_attempt\.status IN \('submitted','evaluated'\) THEN RETURN v_attempt/);

// Student-safe questions never include answer keys; frontend restores and saves
// multiple selections and exposes the attempt history/result-release state.
const safe = studentSafeQuestion({ id: 'q1', questionOrder: 1, questionType: 'mcq', questionText: 'Q', marks: 1,
  options: [{ id: 'o1', questionId: 'q1', optionOrder: 1, optionText: 'A', isCorrect: true }] });
assert.equal(JSON.stringify(safe).includes('isCorrect'), false);
assert.match(routes, /studentResultIsVisible\(assessment, attempt\)/);
assert.match(routes, /!assessment\.isResultsPublished \|\| !attempt\.isEvaluated/);
assert.match(routes, /attemptHistory: attempts\.map/);
assert.match(routes, /questionReviewAvailable: false/);
assert.match(studentUi, /selectedOptionIds/);
assert.match(studentUi, /Select all that apply/);
assert.match(studentUi, /Attempt history/);
assert.match(studentUi, /Time has expired\. Submission is waiting for a connection/);

console.log('Phase 5C.4 student assessment security and flow checks passed.');

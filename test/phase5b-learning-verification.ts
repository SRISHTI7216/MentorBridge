import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  deriveLearningProgress,
  institutionalEnrollmentRpcCall,
  LearningStore,
  LearningStoreError,
  validateDraftLearningModule,
  validateLessonInput,
  validateResourceInput,
} from '../server/src/services/learningStore.js';
import { isMentorOrAdminRole } from '../server/src/middleware/auth.js';
import { createDraftAndRefresh, publishModuleAndRefresh } from '../src/features/mentor/learningWorkflow.js';

const route = readFileSync('server/src/routes/learningRoutes.ts', 'utf8');
const store = readFileSync('server/src/services/learningStore.ts', 'utf8');
const sql = readFileSync('supabase/migrations/drafts/phase5b_atomic_lesson_completion.sql', 'utf8');
const assignedEnrollmentSql = readFileSync('supabase/migrations/drafts/phase5b_assigned_module_enrollment.sql', 'utf8');
const phase5aSql = readFileSync('supabase/migrations/20261118_000009_create_learning_module_schema.sql', 'utf8');
const frontend = readFileSync('src/features/student/Learning.tsx', 'utf8');
const mentorRoute = readFileSync('server/src/routes/learningRoutes.ts', 'utf8');
const authMiddleware = readFileSync('server/src/middleware/auth.ts', 'utf8');
const mentorStoreSource = readFileSync('server/src/services/learningStore.ts', 'utf8');
const mentorUi = readFileSync('src/features/mentor/Learning.tsx', 'utf8');
const moduleEditor = readFileSync('src/features/mentor/ModuleEditor.tsx', 'utf8');
const apiClient = readFileSync('src/services/apiClient.ts', 'utf8');

const routePaths = [
  "'/student/modules'",
  "'/student/modules/:moduleId'",
  "'/student/modules/:moduleId/enroll'",
  "'/student/modules/:moduleId/assigned-enroll'",
  "'/student/modules/:moduleId/progress'",
  "'/student/modules/:moduleId/lessons/:lessonId/complete'",
];
for (const path of routePaths) assert(route.includes(path), `learning route exists: ${path}`);
assert.equal((route.match(/, requireStudent, async/g) || []).length, 6, 'all student routes require student role');
assert(route.includes('req.user!.id'), 'route derives student identity from authenticated request');
assert(!route.includes('req.body.studentId'), 'route does not trust client-supplied student ID');
assert(
  route.includes('learningStore.enroll(req.params.moduleId, req.user!.id)'),
  'enrollment route passes authenticated request identity to the store'
);
assert(store.includes(".eq('student_id', studentId)"), 'enrollment queries are scoped to authenticated student');
assert(store.includes(".eq('status', 'assigned')"), 'eligibility checks only active assignments');
assert(
  store.includes('this.db().rpc(rpcCall.name, rpcCall.args)') && store.includes('institutionalEnrollmentRpcCall(moduleId, studentId)'),
  'institutional enrollment RPC receives arguments built from the store student ID'
);
const rpcCalls: Array<{ name: string; args: Record<string, string> }> = [];
const mockedRpcClient = {
  async rpc(name: string, args: Record<string, string>) {
    rpcCalls.push({ name, args });
    return { data: 'enrollment-123', error: null };
  },
};
const enrollmentRpc = institutionalEnrollmentRpcCall('module-456', 'authenticated-student-789');
await mockedRpcClient.rpc(enrollmentRpc.name, enrollmentRpc.args);
assert.deepEqual(rpcCalls, [{
  name: 'enroll_in_institutional_module',
  args: {
    p_module_id: 'module-456',
    p_target_student_id: 'authenticated-student-789',
  },
}], 'mocked institutional enrollment RPC receives exact function name and argument values');
assert(store.includes("rpc('complete_module_lesson'"), 'completion uses atomic database function');
assert(sql.includes('ON CONFLICT (enrollment_id, lesson_id) DO NOTHING'), 'completion insert is idempotent');
assert(sql.includes('FOR UPDATE'), 'completion locks enrollment while recalculating progress');
assert(sql.includes('is_mandatory = true'), 'completion progress uses mandatory lesson rule');
assert(frontend.includes('Loading learning modules'), 'frontend has loading state');
assert(frontend.includes('No learning modules available'), 'frontend has empty state');
assert(frontend.includes('Resume learning'), 'frontend supports resuming enrollment');
assert(frontend.includes('Mark complete'), 'frontend supports lesson completion');
assert(!frontend.includes('MOCK_LEARNING_MODULES'), 'student learning screen does not use mock modules');

const requiredAndOptional = deriveLearningProgress(
  [
    { id: 'required-1', is_mandatory: true },
    { id: 'required-2', is_mandatory: true },
    { id: 'optional', is_mandatory: false },
  ],
  [{ lesson_id: 'required-1' }, { lesson_id: 'required-1' }, { lesson_id: 'optional' }]
);
assert.equal(requiredAndOptional.completedLessonsCount, 2, 'duplicate ledger IDs count once');
assert.equal(requiredAndOptional.totalLessonsCount, 3);
assert.equal(requiredAndOptional.progressPercentage, 50, 'optional lessons do not distort required progress');
assert.equal(requiredAndOptional.status, 'in_progress');

const allRequiredDone = deriveLearningProgress(
  [{ id: 'required-1', is_mandatory: true }, { id: 'optional', is_mandatory: false }],
  [{ lesson_id: 'required-1' }]
);
assert.equal(allRequiredDone.progressPercentage, 100);
assert.equal(allRequiredDone.status, 'completed');

const fallbackToAll = deriveLearningProgress(
  [{ id: 'one', is_mandatory: false }, { id: 'two', is_mandatory: false }],
  [{ lesson_id: 'one' }]
);
assert.equal(fallbackToAll.progressPercentage, 50, 'modules with no mandatory lessons use all lessons');

const categoryId = '11111111-1111-4111-8111-111111111111';
const termId = '22222222-2222-4222-8222-222222222222';
const mentorId = '33333333-3333-4333-8333-333333333333';
const otherMentorId = '44444444-4444-4444-8444-444444444444';

function mockLearningDb(seed: Record<string, any[]>, failure?: { table: string; code: string; message?: string; operation?: 'insert' | 'update' }, rpcResult: { data?: any; error?: any; onCall?: () => void } = {}) {
  const tables = structuredClone(seed);
  const inserted: Array<{ table: string; row: Record<string, any> }> = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) { rpcCalls.push({ name, args }); rpcResult.onCall?.(); return { data: rpcResult.data || 'enrollment-id', error: rpcResult.error || null }; },
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const orders: Array<{ column: string; ascending: boolean }> = [];
      let insertedRow: Record<string, any> | null = null;
      let updatedValues: Record<string, any> | null = null;
      let deleteRequested = false;
      let countRequested = false;
      const query: any = {
        select(_columns?: string, options?: { count?: string }) { countRequested = options?.count === 'exact'; return query; },
        eq(column: string, value: unknown) { filters.push([column, value]); return query; },
        in(column: string, values: unknown[]) { filters.push([column, values]); return query; },
        order(column: string, options: { ascending?: boolean } = {}) { orders.push({ column, ascending: options.ascending !== false }); return query; },
        insert(row: Record<string, any>) { insertedRow = row; return query; },
        update(row: Record<string, any>) { updatedValues = row; return query; },
        delete() { deleteRequested = true; return query; },
        result() {
          if (insertedRow) {
            if (failure?.table === table && failure.operation !== 'update') return { data: null, error: { code: failure.code, message: failure.message || 'mock insert constraint failure' } };
            const row = {
              id: '55555555-5555-4555-8555-555555555555',
              version: 1,
              estimated_hours: 10,
              week_number: null,
              skills: [],
              is_institutional: false,
              target_cohort_id: null,
              created_at: '2026-11-18T00:00:00.000Z',
              updated_at: '2026-11-18T00:00:00.000Z',
              ...insertedRow,
            };
            inserted.push({ table, row });
            tables[table].push(row);
            return { data: row, error: null };
          }
          const rows = (tables[table] || []).filter((row) => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
          if (updatedValues && failure?.table === table && failure.operation === 'update') return { data: null, error: { code: failure.code, message: failure.message || 'mock update constraint failure' } };
          rows.sort((left, right) => {
            for (const order of orders) {
              if (left[order.column] === right[order.column]) continue;
              const comparison = left[order.column] < right[order.column] ? -1 : 1;
              return order.ascending ? comparison : -comparison;
            }
            return 0;
          });
          if (updatedValues) {
            for (const row of rows) {
              if (table === 'module_lessons' && updatedValues.lesson_order !== undefined &&
                (tables[table] || []).some((other) => other.id !== row.id && other.module_id === row.module_id && other.lesson_order === updatedValues!.lesson_order)) {
                return { data: null, error: { code: '23505', message: 'unique lesson order' } };
              }
              if (table === 'learning_resources' && updatedValues.lesson_id &&
                !(tables.module_lessons || []).some((lesson) => lesson.id === updatedValues!.lesson_id && lesson.module_id === row.module_id)) {
                return { data: null, error: { code: '23503', message: 'resource lesson foreign key' } };
              }
              Object.assign(row, updatedValues);
            }
            return { data: rows, error: null };
          }
          if (deleteRequested) {
            tables[table] = (tables[table] || []).filter((row) => !rows.includes(row));
            return { data: rows, error: null };
          }
          return { data: rows, error: null };
        },
        maybeSingle() {
          const result = query.result();
          return Promise.resolve({ data: Array.isArray(result.data) ? result.data[0] || null : result.data, error: result.error });
        },
        single() {
          const result = query.result();
          return Promise.resolve({ data: Array.isArray(result.data) ? result.data[0] || null : result.data, error: result.error });
        },
        then(resolve: (value: any) => unknown, reject: (reason: unknown) => unknown) {
          const result = query.result();
          return Promise.resolve(countRequested ? { ...result, count: result.data?.length || 0, data: null } : result).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return { client: client as never, tables, inserted, rpcCalls };
}

const moduleRow = (id: string, creator: string) => ({
  id, created_by: creator, category_id: categoryId, academic_term_id: termId,
  code: `CSE-${creator.slice(0, 4)}`, version: 1, title: 'Algorithms', description: null,
  semester: 3, level: 'Fundamental', estimated_hours: 10, week_number: null, skills: [],
  status: 'draft', is_institutional: false, target_cohort_id: null,
  created_at: '2026-11-18T00:00:00.000Z', updated_at: '2026-11-18T00:00:00.000Z',
});
const baseSeed = {
  learning_categories: [{ id: categoryId, code: 'DSA', name: 'Data Structures', display_order: 1 }],
  academic_terms: [{ id: termId, code: 'AY26-S5', name: 'Academic Year 2026 Semester 5', start_date: '2026-07-01', end_date: '2026-12-31', is_current: true }],
  learning_modules: [moduleRow('mentor-module', mentorId), moduleRow('other-module', otherMentorId)],
};

const mentorDb = mockLearningDb(baseSeed);
const mentorLearningStore = new LearningStore(mentorDb.client);
const mentorModules = await mentorLearningStore.listMentorModules({ id: mentorId, role: 'mentor' });
assert.deepEqual(mentorModules.map((module: any) => module.id), ['mentor-module'], 'mentor module listing is scoped to modules they own');
const adminModules = await mentorLearningStore.listMentorModules({ id: '55555555-5555-4555-8555-555555555555', role: 'admin' });
assert.equal(adminModules.length, 2, 'administrator listing follows full-access convention');

const createdInput = validateDraftLearningModule({
  category_id: categoryId,
  academic_term_id: termId,
  code: 'CSE-NEW-101',
  title: 'New Module',
  semester: 4,
  level: 'Intermediate',
  created_by: otherMentorId,
  status: 'draft',
});
const createdModule = await mentorLearningStore.createDraftModule(createdInput, { id: mentorId, role: 'mentor' });
assert.equal(createdModule.created_by, mentorId, 'creator identity comes from authenticated actor, not request body');
assert.equal(createdModule.status, 'draft', 'new module is always persisted as draft');
assert.equal(mentorDb.inserted[0].row.created_by, mentorId);
assert.equal(mentorDb.inserted[0].row.status, 'draft');

const moduleOptions = await mentorLearningStore.getMentorModuleOptions({ id: mentorId, role: 'mentor' });
assert.equal(moduleOptions.categories[0].id, categoryId, 'module categories load from the database');
assert.equal(moduleOptions.academicTerms[0].id, termId, 'academic terms load from the database');

await assert.rejects(
  () => mentorLearningStore.listMentorModules({ id: mentorId, role: 'student' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 403,
  'students are rejected from mentor store operations'
);
assert.throws(
  () => validateDraftLearningModule({ category_id: categoryId, academic_term_id: termId, code: 'X', title: 'Valid title', semester: 1, level: 'Fundamental', status: 'published' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 400,
  'published status cannot be requested during creation'
);
await assert.rejects(
  () => mentorLearningStore.createDraftModule({ ...createdInput, category_id: '66666666-6666-4666-8666-666666666666' }, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.message.includes('category does not exist'),
  'invalid category references are rejected'
);
await assert.rejects(
  () => mentorLearningStore.createDraftModule({ ...createdInput, academic_term_id: '77777777-7777-4777-8777-777777777777' }, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.message.includes('academic term does not exist'),
  'invalid academic term references are rejected'
);

const draftModuleId = '88888888-8888-4888-8888-888888888888';
const foreignModuleId = '99999999-9999-4999-8999-999999999999';
const publishedModuleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const archivedModuleId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const firstLessonId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const secondLessonId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const foreignLessonId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const existingResourceId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const assignmentModuleId = '12121212-1212-4121-8121-121212121212';
const assignmentStudentId = '13131313-1313-4131-8131-131313131313';
const assignmentId = '14141414-1414-4141-8141-141414141414';
const editorDb = mockLearningDb({
  learning_modules: [
    { ...moduleRow(draftModuleId, mentorId), status: 'draft' },
    { ...moduleRow(foreignModuleId, otherMentorId), status: 'draft' },
    { ...moduleRow(publishedModuleId, mentorId), status: 'published' },
    { ...moduleRow(archivedModuleId, mentorId), status: 'archived' },
  ],
  module_lessons: [
    { id: firstLessonId, module_id: draftModuleId, lesson_order: 1, title: 'First Lesson', slug: 'first-lesson', content_markdown: 'First body', lesson_type: 'theory', estimated_minutes: 30, is_mandatory: true },
    { id: secondLessonId, module_id: draftModuleId, lesson_order: 2, title: 'Second Lesson', slug: 'second-lesson', content_markdown: 'Second body', lesson_type: 'code_lab', estimated_minutes: 45, is_mandatory: false },
    { id: foreignLessonId, module_id: foreignModuleId, lesson_order: 1, title: 'Foreign Lesson', slug: 'foreign-lesson', content_markdown: 'Foreign body', lesson_type: 'theory', estimated_minutes: 30, is_mandatory: true },
  ],
  learning_resources: [
    { id: existingResourceId, module_id: draftModuleId, lesson_id: firstLessonId, title: 'Existing Resource', resource_type: 'article_url', url: 'https://example.org', description: null, is_mandatory: false },
  ],
});
const editorStore = new LearningStore(editorDb.client);

const publisherDb = mockLearningDb({ learning_modules: [
  { ...moduleRow(draftModuleId, mentorId), status: 'draft' },
  { ...moduleRow(foreignModuleId, otherMentorId), status: 'draft' },
  { ...moduleRow(publishedModuleId, mentorId), status: 'published' },
  { ...moduleRow(archivedModuleId, mentorId), status: 'archived' },
], module_lessons: [{ id: firstLessonId, module_id: draftModuleId }] });
const publisherStore = new LearningStore(publisherDb.client);
const publishedResult = await publisherStore.publishMentorModule(draftModuleId, { id: mentorId, role: 'mentor' });
assert.equal(publishedResult.module.status, 'published', 'authorized mentor publishes their own valid draft');
assert.equal(publishedResult.publication.publishedAt, null, 'schema has no publication timestamp column');
await assert.rejects(
  () => publisherStore.publishMentorModule(foreignModuleId, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 403,
  'mentor cannot publish another mentor module'
);
await assert.rejects(
  () => publisherStore.publishMentorModule(draftModuleId, { id: mentorId, role: 'student' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 403,
  'student cannot publish'
);
await assert.rejects(
  () => publisherStore.publishMentorModule(publishedModuleId, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 409,
  'already published module is handled as a conflict'
);
await assert.rejects(
  () => publisherStore.publishMentorModule(archivedModuleId, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 409,
  'archived module cannot be published'
);
const adminPublisher = mockLearningDb({ learning_modules: [{ ...moduleRow(draftModuleId, otherMentorId) }], module_lessons: [{ id: firstLessonId, module_id: draftModuleId }] });
const adminPublished = await new LearningStore(adminPublisher.client).publishMentorModule(draftModuleId, { id: '55555555-5555-4555-8555-555555555555', role: 'admin' });
assert.equal(adminPublished.module.status, 'published', 'administrator retains full-access publishing behavior');
const emptyPublisher = mockLearningDb({ learning_modules: [{ ...moduleRow(draftModuleId, mentorId) }], module_lessons: [] });
await assert.rejects(
  () => new LearningStore(emptyPublisher.client).publishMentorModule(draftModuleId, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 400 && error.message.includes('at least one lesson'),
  'empty module is rejected'
);
const triggerFailure = mockLearningDb({ learning_modules: [{ ...moduleRow(draftModuleId, mentorId) }], module_lessons: [{ id: firstLessonId, module_id: draftModuleId }] }, { table: 'learning_modules', operation: 'update', code: 'P0001', message: 'Publication rejected: test prerequisite' });
await assert.rejects(
  () => new LearningStore(triggerFailure.client).publishMentorModule(draftModuleId, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 400 && error.message.includes('test prerequisite'),
  'database publication trigger errors are returned as useful validation errors'
);

const assignmentSeed = {
  learning_modules: [{ ...moduleRow(assignmentModuleId, mentorId), status: 'published', is_institutional: false, target_cohort_id: null }],
  profiles: [{ id: assignmentStudentId, name: 'Test Student', email: 'student@example.org', role: 'student', is_active: true }],
  student_details: [{ profile_id: assignmentStudentId, roll_number: 'R-100', semester: 3, cohort_id: null }],
  academic_terms: [{ id: termId, is_current: true }],
  mentor_assignments: [{ id: '15151515-1515-4151-8151-151515151515', mentor_id: mentorId, student_id: assignmentStudentId, academic_term_id: termId, is_active: true }],
  module_assignments: [],
  student_module_enrollments: [],
  module_lessons: [{ id: firstLessonId, module_id: assignmentModuleId, lesson_order: 1, title: 'Lesson', is_mandatory: true }],
  lesson_completions: [],
};
const assignmentDb = mockLearningDb(assignmentSeed);
const assignmentStore = new LearningStore(assignmentDb.client);
const createdAssignment = await assignmentStore.createModuleAssignment(assignmentModuleId, assignmentStudentId, { id: mentorId, role: 'mentor' });
assert.equal(createdAssignment.mentor_id, mentorId, 'assignment creator identity comes from the authenticated mentor');
assert.equal(createdAssignment.student_id, assignmentStudentId, 'authorized mentor can assign their published module to an eligible mentee');
assert.equal(createdAssignment.status, 'assigned');
await assert.rejects(
  () => assignmentStore.createModuleAssignment(assignmentModuleId, assignmentStudentId, { id: otherMentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 403,
  'unauthorized mentor cannot assign another mentor module'
);
await assert.rejects(
  () => assignmentStore.createModuleAssignment(assignmentModuleId, assignmentStudentId, { id: mentorId, role: 'student' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 403,
  'student is rejected from mentor assignment operations'
);
const unpublishedDb = mockLearningDb({ ...assignmentSeed, learning_modules: [{ ...assignmentSeed.learning_modules[0], status: 'draft' }] });
await assert.rejects(
  () => new LearningStore(unpublishedDb.client).createModuleAssignment(assignmentModuleId, assignmentStudentId, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 409,
  'unpublished modules cannot be assigned'
);
const inactiveDb = mockLearningDb({ ...assignmentSeed, profiles: [{ ...assignmentSeed.profiles[0], is_active: false }] });
await assert.rejects(
  () => new LearningStore(inactiveDb.client).createModuleAssignment(assignmentModuleId, assignmentStudentId, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.message.includes('not active'),
  'inactive target students are rejected'
);
const ineligibleDb = mockLearningDb({ ...assignmentSeed, mentor_assignments: [] });
await assert.rejects(
  () => new LearningStore(ineligibleDb.client).createModuleAssignment(assignmentModuleId, assignmentStudentId, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 403,
  'students outside the active mentee allocation are rejected'
);
const duplicateAssignmentDb = mockLearningDb(assignmentSeed, { table: 'module_assignments', code: '23505' });
await assert.rejects(
  () => new LearningStore(duplicateAssignmentDb.client).createModuleAssignment(assignmentModuleId, assignmentStudentId, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 409,
  'duplicate assignments are reported safely'
);

const enrollmentSeed = structuredClone(assignmentSeed);
enrollmentSeed.module_assignments.push({ id: assignmentId, module_id: assignmentModuleId, student_id: assignmentStudentId, academic_term_id: termId, status: 'assigned' });
const assignedEnrollmentDb = mockLearningDb(enrollmentSeed, undefined, {
  data: 'assigned-enrollment-id',
  onCall: () => assignedEnrollmentDb.tables.student_module_enrollments.push({ id: 'assigned-enrollment-id', module_id: assignmentModuleId, student_id: assignmentStudentId, assignment_id: assignmentId, enrollment_type: 'assigned', status: 'in_progress' }),
});
const assignedEnrollmentStore = new LearningStore(assignedEnrollmentDb.client);
const startedAssignedEnrollment = await assignedEnrollmentStore.enrollAssignedModule(assignmentModuleId, assignmentStudentId);
assert.equal(startedAssignedEnrollment.enrollment.assignment_id, assignmentId, 'assigned enrollment binds the exact module assignment');
assert.equal(startedAssignedEnrollment.enrollment.enrollment_type, 'assigned', 'assigned enrollment preserves the assigned source');
const repeatedAssignedEnrollment = await assignedEnrollmentStore.enrollAssignedModule(assignmentModuleId, assignmentStudentId);
assert.equal(repeatedAssignedEnrollment.enrollment.id, startedAssignedEnrollment.enrollment.id, 'assigned enrollment retry returns the existing assignment-bound enrollment');
assert.deepEqual(assignedEnrollmentDb.rpcCalls[0], {
  name: 'enroll_in_assigned_module',
  args: { p_module_id: assignmentModuleId, p_assignment_id: assignmentId, p_target_student_id: assignmentStudentId },
}, 'assigned enrollment RPC receives server-verified student and assignment identities');
assert(assignedEnrollmentSql.includes("ON CONFLICT (module_id, student_id) DO NOTHING"), 'assigned enrollment proposal handles concurrent retries without converting existing rows');
assert(assignedEnrollmentSql.includes("v_enrollment.enrollment_type = 'assigned'"), 'assigned enrollment retry returns only the same assignment-bound source');
assert(assignedEnrollmentSql.includes("FROM PUBLIC, anon, authenticated") && assignedEnrollmentSql.includes('TO service_role'), 'assigned enrollment function is backend-only');
assert(assignedEnrollmentSql.includes('FROM public.mentor_assignments') && assignedEnrollmentSql.includes('mentor_id = v_assignment.mentor_id') && assignedEnrollmentSql.includes('student_id = p_target_student_id') && assignedEnrollmentSql.includes('academic_term_id = v_module.academic_term_id') && assignedEnrollmentSql.includes('is_active = true'), 'draft RPC rejects enrollment if the assignment mentor no longer has the exact active student-term allocation');
assert(assignedEnrollmentSql.includes('FOR SHARE') && assignedEnrollmentSql.includes('FOR UPDATE'), 'draft RPC locks eligibility rows and assignment/enrollment rows against conflicting changes');
assert(assignedEnrollmentSql.includes("v_student_detail.semester <> v_module.semester") && assignedEnrollmentSql.includes('v_module.target_cohort_id') && assignedEnrollmentSql.includes('is_current = true'), 'draft RPC uses the existing semester, cohort, and current-term eligibility rules');
assert(!assignedEnrollmentSql.includes('start_date') && !assignedEnrollmentSql.includes('end_date'), 'draft RPC does not invent term date eligibility rules');
assert(phase5aSql.includes('CONSTRAINT unique_module_student_assignment UNIQUE (module_id, student_id)'), 'Phase 5A prevents reassignment duplicates for a module/student pair');
assert(phase5aSql.includes('CONSTRAINT unique_module_student_enrollment UNIQUE (module_id, student_id)'), 'Phase 5A allows one enrollment per module/student');
assert(phase5aSql.includes('FOREIGN KEY (assignment_id, module_id, student_id)'), 'Phase 5A binds enrollment assignment, module, and student together');
assert(phase5aSql.includes("enrollment_type IN ('assigned', 'institutional_common')"), 'Phase 5A stores assigned and institutional enrollment sources separately');
await assert.rejects(
  () => assignedEnrollmentStore.enrollAssignedModule(assignmentModuleId, mentorId),
  (error: unknown) => error instanceof LearningStoreError && error.status === 403,
  'cross-student enrollment without a matching assignment is rejected'
);
const noAssignmentStore = new LearningStore(mockLearningDb({ ...enrollmentSeed, module_assignments: [] }).client);
await assert.rejects(
  () => noAssignmentStore.enrollAssignedModule(assignmentModuleId, assignmentStudentId),
  (error: unknown) => error instanceof LearningStoreError && error.status === 403,
  'missing assignment is rejected'
);
const revokedStore = new LearningStore(mockLearningDb({ ...enrollmentSeed, module_assignments: [{ ...enrollmentSeed.module_assignments[0], status: 'revoked' }] }).client);
await assert.rejects(
  () => revokedStore.enrollAssignedModule(assignmentModuleId, assignmentStudentId),
  (error: unknown) => error instanceof LearningStoreError && error.status === 403,
  'revoked assignments cannot be used to enroll'
);
const inactiveAllocationStore = new LearningStore(mockLearningDb(enrollmentSeed, undefined, {
  error: { code: 'P0001', message: 'The assignment mentor no longer has an active allocation for this student and academic term.' },
}).client);
await assert.rejects(
  () => inactiveAllocationStore.enrollAssignedModule(assignmentModuleId, assignmentStudentId),
  (error: unknown) => error instanceof LearningStoreError && error.status === 400 && error.message.includes('no longer has an active allocation'),
  'inactive mentor allocation rejection from the assigned-enrollment RPC is surfaced to the student'
);

const newLesson = await editorStore.createMentorLesson(draftModuleId, {
  title: 'Appended Lesson', content_markdown: '## Markdown lesson', is_mandatory: false,
  module_id: foreignModuleId, lesson_order: 200, created_by: otherMentorId,
}, { id: mentorId, role: 'mentor' });
assert.equal(newLesson.module_id, draftModuleId, 'lesson module ownership is taken from the route, not body');
assert.equal(newLesson.lesson_order, 3, 'new lesson is appended using the next available lesson order');
assert.equal(newLesson.slug, 'appended-lesson');
assert.equal(newLesson.is_mandatory, false);
assert.equal(editorDb.inserted.find((row) => row.table === 'module_lessons')?.row.module_id, draftModuleId);

const duplicateOrderDb = mockLearningDb({
  learning_modules: [{ ...moduleRow(draftModuleId, mentorId), status: 'draft' }],
  module_lessons: [{ id: firstLessonId, module_id: draftModuleId, lesson_order: 1 }],
  learning_resources: [],
}, { table: 'module_lessons', code: '23505' });
await assert.rejects(
  () => new LearningStore(duplicateOrderDb.client).createMentorLesson(draftModuleId, { title: 'Concurrent Lesson', content_markdown: 'Body' }, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 409,
  'database lesson-order uniqueness conflicts are reported safely'
);

await assert.rejects(
  () => editorStore.updateMentorLesson(foreignModuleId, foreignLessonId, { title: 'Tampered title' }, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 403,
  'mentor cannot modify another mentor module'
);
await assert.rejects(
  () => editorStore.createMentorLesson(draftModuleId, { title: 'Bad', content_markdown: '  ' }, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 400,
  'invalid lesson title and empty Markdown body are rejected'
);
assert.throws(
  () => validateLessonInput({ title: 'Valid title', content_markdown: 'Body', lesson_type: 'video' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 400,
  'lesson types are restricted to schema values'
);
await assert.rejects(
  () => editorStore.reorderMentorLessons(draftModuleId, [firstLessonId, firstLessonId, secondLessonId, newLesson.id], { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 400,
  'duplicate lesson IDs are rejected during reorder'
);
const reorderedLessons = await editorStore.reorderMentorLessons(draftModuleId, [secondLessonId, firstLessonId, newLesson.id], { id: mentorId, role: 'mentor' });
assert.deepEqual(reorderedLessons.map((lesson: any) => lesson.id), [secondLessonId, firstLessonId, newLesson.id], 'lesson reorder persists the requested order');
assert.deepEqual(reorderedLessons.map((lesson: any) => lesson.lesson_order), [1, 2, 3]);
const lessonDeleteResult = await editorStore.deleteMentorLesson(draftModuleId, newLesson.id, { id: mentorId, role: 'mentor' });
assert.equal(lessonDeleteResult.deleted, true);
assert.equal(editorDb.tables.module_lessons.some((lesson) => lesson.id === newLesson.id), false, 'lesson removal is persisted');

const newResource = await editorStore.createMentorResource(draftModuleId, {
  title: 'Lesson reference', resource_type: 'article_url', url: 'https://example.org/lesson', lesson_id: firstLessonId,
  description: 'Reference page', is_mandatory: true, module_id: foreignModuleId,
}, { id: mentorId, role: 'mentor' });
assert.equal(newResource.module_id, draftModuleId, 'resource module is taken from the route, not body');
assert.equal(newResource.lesson_id, firstLessonId);
assert.equal(newResource.is_mandatory, true);
const editedResource = await editorStore.updateMentorResource(draftModuleId, existingResourceId, { title: 'Updated resource title' }, { id: mentorId, role: 'mentor' });
assert.equal(editedResource.title, 'Updated resource title', 'resource edit is persisted');
await editorStore.deleteMentorResource(draftModuleId, newResource.id, { id: mentorId, role: 'mentor' });
assert.equal(editorDb.tables.learning_resources.some((resource) => resource.id === newResource.id), false, 'resource removal is persisted');
await assert.rejects(
  () => editorStore.createMentorResource(draftModuleId, { title: 'Cross module', resource_type: 'doc', url: 'https://example.org', lesson_id: foreignLessonId }, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 404,
  'resource cannot reference a lesson in another module'
);
await assert.rejects(
  () => editorStore.updateMentorResource(draftModuleId, existingResourceId, { lesson_id: foreignLessonId }, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 404,
  'resource edit cannot attach a lesson from another module'
);
assert.throws(
  () => validateResourceInput({ title: 'Resource title', resource_type: 'webpage', url: 'https://example.org' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 400,
  'resource types are restricted to schema values'
);
await assert.rejects(
  () => editorStore.updateMentorLesson(publishedModuleId, firstLessonId, { title: 'Changed lesson' }, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 409,
  'published module lessons are immutable through the API'
);
await assert.rejects(
  () => editorStore.createMentorResource(archivedModuleId, { title: 'Archived ref', resource_type: 'doc', url: 'https://example.org' }, { id: mentorId, role: 'mentor' }),
  (error: unknown) => error instanceof LearningStoreError && error.status === 409,
  'archived module resources are immutable through the API'
);

for (const path of [
  "router.get('/mentor/modules/:moduleId/lessons', requireMentorOrAdmin",
  "router.post('/mentor/modules/:moduleId/lessons', requireMentorOrAdmin",
  "router.put('/mentor/modules/:moduleId/lessons/reorder', requireMentorOrAdmin",
  "router.patch('/mentor/modules/:moduleId/lessons/:lessonId', requireMentorOrAdmin",
  "router.delete('/mentor/modules/:moduleId/lessons/:lessonId', requireMentorOrAdmin",
  "router.get('/mentor/modules/:moduleId/resources', requireMentorOrAdmin",
  "router.post('/mentor/modules/:moduleId/resources', requireMentorOrAdmin",
  "router.patch('/mentor/modules/:moduleId/resources/:resourceId', requireMentorOrAdmin",
  "router.delete('/mentor/modules/:moduleId/resources/:resourceId', requireMentorOrAdmin",
]) assert(mentorRoute.includes(path), `mentor content endpoint is protected: ${path}`);
assert(moduleEditor.includes('result.error') && moduleEditor.includes('role="alert"'), 'editor surfaces API failures');
assert(moduleEditor.includes('await Promise.all([loadLessons(), loadResources()])'), 'successful lesson mutation refreshes lesson and resource views');
assert(moduleEditor.includes('await loadResources();'), 'successful resource mutation refreshes resource view');
assert(moduleEditor.includes('!isDraft &&') && moduleEditor.includes('isDraft &&'), 'published and archived modules render read-only controls');
assert(moduleEditor.includes('permanently freezes this curriculum'), 'editor explains publication freeze before confirmation');
assert(moduleEditor.includes('getEligibleLearningMentees') && moduleEditor.includes('getMentorModuleAssignments'), 'published module editor loads real mentees and assignments');
assert(moduleEditor.includes('createMentorModuleAssignment') && moduleEditor.includes('Existing assignments'), 'mentor editor can assign and review assignment status');
assert(moduleEditor.includes('Every eligible mentee already has an assignment record') && moduleEditor.includes('Retry'), 'mentor assignment UI shows duplicate and retry states');
assert(frontend.includes('Assigned to you') && frontend.includes('Institutionally available'), 'student page distinguishes assigned and institutional modules');
assert(frontend.includes('enrollStudentAssignedLearningModule') && frontend.includes('Start assigned module'), 'student can start assigned enrollment separately');
assert(frontend.includes('await Promise.all([loadModules(), loadDetail(moduleId)])'), 'student start refreshes list and persisted module progress');
assert(moduleEditor.includes('reorderMentorModuleLessons(module.id, ordered.map((lesson) => lesson.id))'), 'editor submits explicit lesson ordering');
assert(!mentorUi.includes('MOCK_LEARNING_MODULES'), 'mentor module page does not silently fall back to mock data');

assert(mentorRoute.includes("router.get('/mentor/modules', requireMentorOrAdmin"), 'mentor list endpoint requires mentor/admin middleware');
assert(mentorRoute.includes("router.get('/mentor/module-options', requireMentorOrAdmin"), 'module options endpoint requires mentor/admin middleware');
assert(mentorRoute.includes("router.post('/mentor/modules', requireMentorOrAdmin"), 'module creation endpoint requires mentor/admin middleware');
assert(mentorRoute.includes("router.post('/mentor/modules/:moduleId/publish', requireMentorOrAdmin"), 'module publishing endpoint requires mentor/admin middleware');
assert(mentorRoute.includes("router.get('/mentor/modules/:moduleId/mentees', requireMentorOrAdmin"), 'eligible mentee lookup requires mentor/admin middleware');
assert(mentorRoute.includes("router.get('/mentor/modules/:moduleId/assignments', requireMentorOrAdmin"), 'assignment listing requires mentor/admin middleware');
assert(mentorRoute.includes("router.post('/mentor/modules/:moduleId/assignments', requireMentorOrAdmin"), 'assignment creation requires mentor/admin middleware');
assert(mentorRoute.includes("router.post('/student/modules/:moduleId/assigned-enroll', requireStudent") && mentorRoute.includes('enrollAssignedModule(req.params.moduleId, req.user!.id)'), 'assigned enrollment derives identity from authenticated student');
assert(mentorRoute.includes('req.user!.id') && mentorRoute.includes('req.user!.role'), 'mentor endpoints derive actor from authenticated request');
assert(mentorRoute.includes('createDraftModule(input, { id: req.user!.id, role: req.user!.role })'), 'create endpoint passes authenticated actor and never body creator identity');
assert(authMiddleware.includes('isMentorOrAdminRole(req.user.role)'), 'mentor middleware rejects unauthorized roles with 403');
assert.equal(isMentorOrAdminRole('student'), false, 'student role is rejected by mentor/admin authorization helper');
assert.equal(isMentorOrAdminRole('mentor'), true, 'mentor role is allowed by mentor/admin authorization helper');
assert.equal(isMentorOrAdminRole('admin'), true, 'admin role is allowed by mentor/admin authorization helper');
assert(mentorStoreSource.includes("status: 'draft'"), 'backend enforces draft status');
assert(apiClient.includes("'/api/learning/mentor/modules'") && apiClient.includes("'/api/learning/mentor/module-options'"), 'frontend API client exposes mentor module endpoints and options');
assert(mentorUi.includes('if (result.error || !result.module)') && mentorUi.includes('setFormError(result.error'), 'module creation API errors are displayed in the form');
assert(mentorUi.includes('Retry</Button>'), 'module list has retry control');
let refreshCount = 0;
const failedCreateFlow = await createDraftAndRefresh(
  async () => ({ data: null, error: 'Creation failed', status: 500 }),
  async () => { refreshCount++; }
);
assert.equal(failedCreateFlow.error, 'Creation failed', 'mocked API errors are returned for UI display');
assert.equal(refreshCount, 0, 'failed creation does not trigger an unnecessary list refresh');
const successfulCreateFlow = await createDraftAndRefresh(
  async () => ({ data: { module: { id: 'new-module', title: 'Created Module' } as any }, error: null, status: 201 }),
  async () => { refreshCount++; }
);
assert.equal(successfulCreateFlow.module?.title, 'Created Module');
assert.equal(refreshCount, 1, 'successful creation refreshes the module list');
let publishRefreshCount = 0;
const publishedModule = { id: 'published-module', status: 'published' } as any;
const successfulPublishFlow = await publishModuleAndRefresh(
  async () => ({ data: { module: publishedModule }, error: null, status: 200 }),
  async (updated) => { assert.equal(updated.status, 'published'); publishRefreshCount++; },
);
assert.equal(successfulPublishFlow.module?.id, 'published-module');
assert.equal(publishRefreshCount, 1, 'successful publication refreshes module/editor state');
const failedPublishFlow = await publishModuleAndRefresh(
  async () => ({ data: null, error: 'Publication validation failed', status: 400 }),
  async () => { publishRefreshCount++; },
);
assert.equal(failedPublishFlow.error, 'Publication validation failed');
assert.equal(publishRefreshCount, 1, 'failed publication does not refresh state');

console.log('Phase 5B learning verification passed.');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiClient } from '../src/services/apiClient.js';
import { validateDraftAssessmentModuleLink } from '../server/src/services/assessmentModuleLinking.js';
import { acquireActionLock, buildAssessmentGenerationPayload, parseSourceRanges, stableIdempotencyKey, validateSourceFile } from '../src/features/mentor/assessmentGenerationWorkflow.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const editor = read('src/features/mentor/Assessments.tsx');
const panel = read('src/features/mentor/AssessmentQuestionGenerationPanel.tsx');
const api = read('src/services/apiClient.ts');
const routes = read('server/src/routes/assessmentRoutes.ts');
const documentsRoute = read('server/src/routes/sourceDocumentRoutes.ts');
const documentPersistence = read('server/src/services/sourceDocumentPersistence.ts');
const generationRoute = read('server/src/routes/assessmentGenerationRoutes.ts');
const generationStore = read('server/src/services/assessmentQuestionGenerationStore.ts');
const reviewRoute = read('server/src/routes/assessmentRoutes.ts');

const assessment = { id: 'assessment-1', ownerId: 'mentor-1', status: 'draft', code: '', originModuleId: null };
const module = { id: 'module-1', ownerId: 'mentor-1', status: 'draft', code: 'CS101' };
assert.deepEqual(validateDraftAssessmentModuleLink({ assessment, module, actorId: 'mentor-1', role: 'mentor', existingLinks: [] }), { ok: true, alreadyLinked: false });
assert.equal(validateDraftAssessmentModuleLink({ assessment, module: { ...module, ownerId: 'mentor-2' }, actorId: 'mentor-1', role: 'mentor', existingLinks: [] }).ok, false);
assert.equal(validateDraftAssessmentModuleLink({ assessment: { ...assessment, ownerId: 'mentor-2' }, module, actorId: 'mentor-1', role: 'mentor', existingLinks: [] }).ok, false);
assert.deepEqual(validateDraftAssessmentModuleLink({ assessment, module, actorId: 'admin-1', role: 'admin', existingLinks: [{ moduleId: module.id }] }), { ok: true, alreadyLinked: true });
assert.equal(validateDraftAssessmentModuleLink({ assessment, module: { ...module, status: 'published' }, actorId: 'mentor-1', role: 'mentor', existingLinks: [] }).ok, false);
assert.equal(validateDraftAssessmentModuleLink({ assessment: { ...assessment, originModuleId: 'origin-1' }, module: { ...module, code: 'OTHER' }, actorId: 'mentor-1', role: 'mentor', originModule: { ...module, id: 'origin-1', code: 'CS101' }, existingLinks: [] }).ok, false);
assert.equal(validateDraftAssessmentModuleLink({ assessment, module, actorId: 'mentor-1', role: 'mentor', existingLinks: [{ moduleId: 'other-module' }] }).ok, false);

assert.deepEqual(parseSourceRanges('1-3, 5', [1, 2, 3, 4, 5]).ranges, [{ start: 1, end: 3 }, { start: 5, end: 5 }]);
assert.match(parseSourceRanges('2-4', [1, 2, 3]).error || '', /not available/);
assert.match(parseSourceRanges('1-3, 3-4', [1, 2, 3, 4]).error || '', /non-overlapping/);
assert.equal(validateSourceFile({ name: 'lesson.txt', size: 50, type: 'text/plain' }).mimeType, 'text/plain');
assert.match((validateSourceFile({ name: 'lesson.exe', size: 50, type: '' }) as any).error, /PDF, PPTX, DOCX, or TXT/);
assert.match((validateSourceFile({ name: 'lesson.pdf', size: 25 * 1024 * 1024 + 1, type: 'application/pdf' }) as any).error, /25 MiB/);

const actionLock = { current: false };
assert.equal(acquireActionLock(actionLock), true);
assert.equal(acquireActionLock(actionLock), false, 'duplicate clicks are blocked before React state updates');
actionLock.current = false;
let generatedKeyCount = 0;
const makeKey = () => `key-${++generatedKeyCount}`;
const firstKey = stableIdempotencyKey('same-request', null, makeKey);
assert.equal(stableIdempotencyKey('same-request', firstKey, makeKey).key, firstKey.key, 'retries of an identical request reuse the idempotency key');
assert.equal(stableIdempotencyKey('changed-request', firstKey, makeKey).key, 'key-2', 'changed requests get a new idempotency key');

const document = { id: 'doc-1', assessmentId: 'assessment-1', moduleId: 'module-1', filename: 'lesson.pdf', mimeType: 'application/pdf', sizeBytes: 200,
  extractionStatus: 'ready' as const, unitCount: 4, rangeKind: 'page' as const, availableRanges: [1, 2, 3, 4], uploadedAt: 'now' };
const built = buildAssessmentGenerationPayload({ assessmentId: assessment.id, moduleId: module.id, documents: [document], selectedDocumentIds: [document.id], rangesByDocument: { [document.id]: '1-2,4' },
  questionCounts: { mcq: 1, multiple_select: 1, true_false: 0 }, difficultyDistribution: { easy: 1, medium: 1, hard: 0 }, cognitiveLevels: ['understand', 'apply'],
  topicCoverageText: 'Graphs\nTraversal', additionalInstructions: 'Use the provided material only.', idempotencyKey: 'c50bd832-a5fa-4abe-a2fc-20b45ac18d58' });
assert.ok('payload' in built);
if ('payload' in built) assert.deepEqual(built.payload, { assessmentId: assessment.id, moduleId: module.id, idempotencyKey: 'c50bd832-a5fa-4abe-a2fc-20b45ac18d58',
  documents: [{ documentId: document.id, ranges: [{ start: 1, end: 2 }, { start: 4, end: 4 }] }], questionCounts: { mcq: 1, multiple_select: 1, true_false: 0 },
  difficultyDistribution: { easy: 1, medium: 1, hard: 0 }, cognitiveLevels: ['understand', 'apply'], topicCoverage: ['Graphs', 'Traversal'], additionalInstructions: 'Use the provided material only.' });

// Mock fetch to verify the concrete binary upload and generation API contracts.
const originalFetch = globalThis.fetch;
const calls: Array<{ url: string; init?: RequestInit }> = [];
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  calls.push({ url: String(input), init });
  const payload = String(input).includes('generate-questions') ? { generation: { jobId: 'job-1', status: 'completed' }, questions: [{ questionText: 'Q' }] } : { document: document };
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
};
try {
  const file = new File(['source bytes'], 'lesson.txt', { type: 'text/plain' });
  await apiClient.uploadAssessmentSourceDocument(assessment.id, module.id, file, 'text/plain');
  assert.equal(calls[0].url, `/api/assessments/${assessment.id}/modules/${module.id}/source-documents`);
  assert.equal(calls[0].init?.headers && (calls[0].init!.headers as Record<string, string>)['Content-Type'], 'application/octet-stream');
  assert.equal(calls[0].init?.body, file);
  if ('payload' in built) {
    await apiClient.generateAssessmentQuestions(assessment.id, module.id, built.payload);
    assert.equal(calls[1].url, `/api/assessments/${assessment.id}/modules/${module.id}/generate-questions`);
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), built.payload);
  }
} finally { globalThis.fetch = originalFetch; }

assert.match(editor, /getMentorLearningModules\(\)/);
assert.match(editor, /originModuleId: formModuleId/);
assert.match(editor, /Generate Questions with AI/);
assert.match(editor, /\+ Add Question/);
assert.match(editor, /linkAssessmentToModule\(assessmentId, module\.id\)/);
assert.match(panel, /Retry extraction/);
assert.match(panel, /extractionStatus.*ready/);
assert.match(panel, /Open Question Review/);
assert.match(panel, /setGenerating\(true\)/);
assert.match(panel, /acquireActionLock\(generationLock\)/);
assert.match(panel, /setGenerationError/);
assert.match(panel, /setUploadMessage/);
assert.match(api, /source-documents/);
assert.match(api, /retry-extraction/);
assert.match(api, /generate-questions/);
assert.match(routes, /validateDraftAssessmentModuleLink/);
assert.match(routes, /canManageAssessment\(assessment\.mentorId, req\.user!\.id, req\.user!\.role\)/);
assert.match(routes, /Assessment is not linked to a learning module\./);
assert.match(documentsRoute, /assessment-source-materials/);
assert.match(documentsRoute, /MAX_DOCUMENT_BYTES/);
assert.match(documentPersistence, /storage\.from\(bucket\)\.upload/);
assert.match(generationRoute, /validateGenerationRequest/);
assert.match(generationRoute, /engine\.generate\(req\.user\.id/);
assert.match(generationStore, /assessment\.status !== 'draft'/);
assert.match(generationStore, /module\.status !== 'draft'/);
assert.match(reviewRoute, /assessment_question_revisions/);
assert.match(reviewRoute, /assessment_question_regenerations/);

console.log('Phase 5C.8 focused generation frontend and mocked API checks passed (no live database).');

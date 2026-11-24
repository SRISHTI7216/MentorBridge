import type { AssessmentGenerationPayload, AssessmentSourceDocument } from '../../services/apiClient';

export const MAX_SOURCE_FILE_BYTES = 25 * 1024 * 1024;
export const ALLOWED_SOURCE_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

export function acquireActionLock(lock: { current: boolean }): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function stableIdempotencyKey(signature: string, current: { signature: string; key: string } | null, createKey: () => string): { signature: string; key: string } {
  return current?.signature === signature ? current : { signature, key: createKey() };
}

export function sourceFileMime(filename: string): string | null {
  const extension = filename.toLowerCase().split('.').pop() || '';
  return ALLOWED_SOURCE_MIME[extension] || null;
}

export function validateSourceFile(file: Pick<File, 'name' | 'size' | 'type'>): { mimeType: string } | { error: string } {
  const mimeType = sourceFileMime(file.name);
  if (!mimeType) return { error: 'Choose a PDF, PPTX, DOCX, or TXT file.' };
  if (file.size < 1 || file.size > MAX_SOURCE_FILE_BYTES) return { error: 'File must be non-empty and no larger than 25 MiB.' };
  if (file.type && file.type.toLowerCase() !== mimeType) return { error: 'The selected file type does not match its extension.' };
  return { mimeType };
}

export function parseSourceRanges(value: string, availableUnits: number[]): { ranges: Array<{ start: number; end: number }>; error?: string } {
  const parts = value.split(',').map(part => part.trim()).filter(Boolean);
  if (!parts.length) return { ranges: [], error: 'Choose at least one page, slide, or extracted unit range.' };
  if (parts.length > 5) return { ranges: [], error: 'Select no more than five ranges for a document.' };
  const ranges: Array<{ start: number; end: number }> = [];
  let previousEnd = 0;
  for (const part of parts) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!match) return { ranges: [], error: 'Use ranges such as 1-3, 5.' };
    const start = Number(match[1]); const end = Number(match[2] || match[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start + 1 > 20) return { ranges: [], error: 'Each range must contain 1 to 20 units with valid positive bounds.' };
    if (start <= previousEnd) return { ranges: [], error: 'Ranges must be ordered and non-overlapping.' };
    for (let unit = start; unit <= end; unit++) if (!availableUnits.includes(unit)) return { ranges: [], error: `Unit ${unit} is not available in the extracted document.` };
    ranges.push({ start, end }); previousEnd = end;
  }
  return { ranges };
}

export type GenerationSettings = {
  assessmentId: string; moduleId: string; documents: AssessmentSourceDocument[];
  selectedDocumentIds: string[]; rangesByDocument: Record<string, string>;
  questionCounts: AssessmentGenerationPayload['questionCounts'];
  difficultyDistribution: AssessmentGenerationPayload['difficultyDistribution'];
  cognitiveLevels: AssessmentGenerationPayload['cognitiveLevels'];
  topicCoverageText: string; additionalInstructions: string; idempotencyKey: string;
};

export function buildAssessmentGenerationPayload(settings: GenerationSettings): { payload: AssessmentGenerationPayload } | { error: string } {
  if (!settings.assessmentId || !settings.moduleId) return { error: 'Save and link this assessment to a draft module first.' };
  if (!settings.selectedDocumentIds.length || settings.selectedDocumentIds.length > 5) return { error: 'Select between one and five extracted source documents.' };
  const totalQuestions = Object.values(settings.questionCounts).reduce((sum, count) => sum + Number(count), 0);
  if (Object.values(settings.questionCounts).some(count => !Number.isSafeInteger(count) || count < 0) || totalQuestions < 1 || totalQuestions > 20) return { error: 'Request between one and twenty questions using non-negative whole-number counts.' };
  if (Object.values(settings.difficultyDistribution).some(count => !Number.isSafeInteger(count) || count < 0)
    || Object.values(settings.difficultyDistribution).reduce((sum, count) => sum + count, 0) !== totalQuestions) return { error: 'Difficulty counts must be non-negative whole numbers and sum to the requested question count.' };
  if (!settings.cognitiveLevels.length) return { error: 'Select at least one cognitive level.' };
  const topics = settings.topicCoverageText.split(/[\n,]/).map(topic => topic.trim()).filter(Boolean);
  if (topics.length > 12 || topics.some(topic => topic.length > 120)) return { error: 'Use no more than 12 topics, each at most 120 characters.' };
  if (settings.additionalInstructions.length > 1500) return { error: 'Additional instructions must be at most 1,500 characters.' };
  const documents = [] as AssessmentGenerationPayload['documents'];
  for (const id of settings.selectedDocumentIds) {
    const document = settings.documents.find(item => item.id === id);
    if (!document || document.extractionStatus !== 'ready') return { error: 'Only documents with successful extraction can be selected.' };
    const parsed = parseSourceRanges(settings.rangesByDocument[id] || '', document.availableRanges || []);
    if (parsed.error) return { error: `${document.filename}: ${parsed.error}` };
    documents.push({ documentId: id, ranges: parsed.ranges });
  }
  if (documents.reduce((sum, document) => sum + document.ranges.length, 0) > 12) return { error: 'Select no more than twelve ranges across all documents.' };
  if (documents.reduce((sum, document) => sum + document.ranges.reduce((inner, range) => inner + range.end - range.start + 1, 0), 0) > 80) return { error: 'Select no more than eighty extracted units.' };
  return { payload: {
    assessmentId: settings.assessmentId, moduleId: settings.moduleId, idempotencyKey: settings.idempotencyKey,
    documents, questionCounts: settings.questionCounts, difficultyDistribution: settings.difficultyDistribution,
    cognitiveLevels: [...new Set(settings.cognitiveLevels)], topicCoverage: topics, additionalInstructions: settings.additionalInstructions.trim(),
  } };
}

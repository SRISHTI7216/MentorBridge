import crypto from 'node:crypto';
import { AssessmentProviderError } from './assessmentProviderError.js';
import type { AssessmentQuestionGenerationResult } from './openrouterService.js';
import { Extraction } from './sourceDocumentExtraction.js';

export const MAX_GENERATED_QUESTIONS = 20;
export const MAX_SOURCE_DOCUMENTS = 5;
export const MAX_RANGES_PER_DOCUMENT = 5;
export const MAX_TOTAL_RANGES = 12;
export const MAX_UNITS_PER_RANGE = 20;
export const MAX_SELECTED_UNITS = 80;
export const MAX_SELECTED_SOURCE_CHARS = 80_000;
export const MAX_TOPIC_COUNT = 12;
export const MAX_INSTRUCTION_CHARS = 1_500;

export type GeneratedQuestionType = 'mcq' | 'multiple_select' | 'true_false';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type CognitiveLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
export type SelectedRange = { start: number; end: number };
export type GenerationRequest = {
  assessmentId: string;
  moduleId: string;
  idempotencyKey: string;
  documents: Array<{ documentId: string; ranges: SelectedRange[] }>;
  questionCounts: Record<GeneratedQuestionType, number>;
  difficultyDistribution: Record<Difficulty, number>;
  cognitiveLevels: CognitiveLevel[];
  topicCoverage: string[];
  additionalInstructions?: string;
};
export type PreparedSource = {
  documentId: string;
  filename: string;
  rangeKind: Extraction['rangeKind'];
  ranges: SelectedRange[];
  units: Array<{ number: number; text: string }>;
};
export type GeneratedOption = { text: string; isCorrect: boolean };
export type GeneratedSourceReference = {
  documentId: string;
  rangeKind: Extraction['rangeKind'];
  locationStart: number;
  locationEnd: number;
};
export type GeneratedQuestion = {
  questionType: GeneratedQuestionType;
  questionText: string;
  options: GeneratedOption[];
  explanation: string;
  marks: number;
  difficulty: Difficulty;
  cognitiveLevel: CognitiveLevel;
  topic: string;
  sourceReferences: GeneratedSourceReference[];
};

export class AssessmentGenerationError extends Error {
  failureStateRecordingFailed = false;
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = 'AssessmentGenerationError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const questionTypes: GeneratedQuestionType[] = ['mcq', 'multiple_select', 'true_false'];
const difficulties: Difficulty[] = ['easy', 'medium', 'hard'];
const cognitiveLevels: CognitiveLevel[] = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

export interface AssessmentQuestionGenerationProvider {
  generateAssessmentQuestions(payload: { requirements: unknown; sourceDocuments: unknown[] }): Promise<AssessmentQuestionGenerationResult>;
  getValidatedModel(): string;
  isAllowedResponseModel(actualModel: string): boolean;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
function invalid(message: string): never {
  throw new AssessmentGenerationError('invalid_request', 400, message);
}

export function validateGenerationRequest(value: unknown, routeAssessmentId: string, routeModuleId: string): GenerationRequest {
  if (!isPlainObject(value)) invalid('Generation request must be an object.');
  const allowed = ['assessmentId', 'moduleId', 'idempotencyKey', 'documents', 'questionCounts', 'difficultyDistribution', 'cognitiveLevels', 'topicCoverage', 'additionalInstructions'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid('Generation request contains unsupported fields.');
  if (value.assessmentId !== routeAssessmentId || value.moduleId !== routeModuleId || !UUID.test(value.assessmentId) || !UUID.test(value.moduleId)) invalid('Assessment and module identifiers must match the route.');
  if (typeof value.idempotencyKey !== 'string' || !UUID.test(value.idempotencyKey)) invalid('A UUID idempotencyKey is required.');

  if (!Array.isArray(value.documents) || value.documents.length < 1 || value.documents.length > MAX_SOURCE_DOCUMENTS) invalid(`Select between 1 and ${MAX_SOURCE_DOCUMENTS} source documents.`);
  const seenDocuments = new Set<string>();
  let totalRanges = 0;
  const documents = value.documents.map((document: unknown) => {
    if (!isPlainObject(document) || !exactKeys(document, ['documentId', 'ranges']) || typeof document.documentId !== 'string' || !UUID.test(document.documentId)) invalid('Each source must contain a valid documentId and ranges.');
    if (seenDocuments.has(document.documentId)) invalid('A source document may be selected only once.');
    seenDocuments.add(document.documentId);
    if (!Array.isArray(document.ranges) || document.ranges.length < 1 || document.ranges.length > MAX_RANGES_PER_DOCUMENT) invalid(`Each document must select 1 to ${MAX_RANGES_PER_DOCUMENT} ranges.`);
    totalRanges += document.ranges.length;
    let previousEnd = 0;
    const ranges = document.ranges.map((range: unknown) => {
      if (!isPlainObject(range) || !exactKeys(range, ['start', 'end']) || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 1 || range.end < range.start) invalid('Selected range bounds must be positive integers with start <= end.');
      if (range.end - range.start + 1 > MAX_UNITS_PER_RANGE || range.start <= previousEnd) invalid('Selected ranges must be ordered, non-overlapping, and within the per-range unit limit.');
      previousEnd = range.end;
      return { start: range.start as number, end: range.end as number };
    });
    return { documentId: document.documentId, ranges };
  });
  if (totalRanges > MAX_TOTAL_RANGES) invalid(`At most ${MAX_TOTAL_RANGES} total source ranges may be selected.`);

  if (!isPlainObject(value.questionCounts) || !exactKeys(value.questionCounts, questionTypes)) invalid('questionCounts must define mcq, multiple_select, and true_false counts.');
  const questionCounts = Object.fromEntries(questionTypes.map((type) => {
    const count = value.questionCounts[type];
    if (!Number.isSafeInteger(count) || count < 0) invalid('Question counts must be non-negative integers.');
    return [type, count];
  })) as Record<GeneratedQuestionType, number>;
  const requestedTotal = questionTypes.reduce((sum, type) => sum + questionCounts[type], 0);
  if (requestedTotal < 1 || requestedTotal > MAX_GENERATED_QUESTIONS) invalid(`Request between 1 and ${MAX_GENERATED_QUESTIONS} questions.`);

  if (!isPlainObject(value.difficultyDistribution) || !exactKeys(value.difficultyDistribution, difficulties)) invalid('difficultyDistribution must define easy, medium, and hard counts.');
  const difficultyDistribution = Object.fromEntries(difficulties.map((level) => {
    const count = value.difficultyDistribution[level];
    if (!Number.isSafeInteger(count) || count < 0) invalid('Difficulty counts must be non-negative integers.');
    return [level, count];
  })) as Record<Difficulty, number>;
  if (difficulties.reduce((sum, level) => sum + difficultyDistribution[level], 0) !== requestedTotal) invalid('Difficulty distribution must sum to the requested question count.');

  if (!Array.isArray(value.cognitiveLevels) || value.cognitiveLevels.length < 1 || value.cognitiveLevels.length > cognitiveLevels.length
    || value.cognitiveLevels.some((level: unknown) => !cognitiveLevels.includes(level as CognitiveLevel))
    || new Set(value.cognitiveLevels).size !== value.cognitiveLevels.length) invalid('Select one or more unique supported cognitive levels.');
  const topicCoverage = value.topicCoverage === undefined ? [] : value.topicCoverage;
  if (!Array.isArray(topicCoverage) || topicCoverage.length > MAX_TOPIC_COUNT || topicCoverage.some((topic: unknown) => typeof topic !== 'string' || !topic.trim() || topic.trim().length > 120)
    || new Set(topicCoverage.map((topic: string) => topic.trim().toLocaleLowerCase())).size !== topicCoverage.length) invalid(`topicCoverage must contain at most ${MAX_TOPIC_COUNT} unique topics of up to 120 characters.`);
  const additionalInstructions = value.additionalInstructions === undefined ? '' : value.additionalInstructions;
  if (typeof additionalInstructions !== 'string' || additionalInstructions.length > MAX_INSTRUCTION_CHARS) invalid(`additionalInstructions must be text of at most ${MAX_INSTRUCTION_CHARS} characters.`);

  return { assessmentId: value.assessmentId, moduleId: value.moduleId, idempotencyKey: value.idempotencyKey, documents, questionCounts, difficultyDistribution, cognitiveLevels: value.cognitiveLevels, topicCoverage: topicCoverage.map((topic: string) => topic.trim()), additionalInstructions: additionalInstructions.trim() };
}

export function prepareSelectedSources(request: GenerationRequest, sourceRecords: Array<{ id: string; original_filename: string; extraction_status: string; extraction_units: unknown; extraction_range_kind: string }>): PreparedSource[] {
  if (sourceRecords.length !== request.documents.length) invalid('One or more selected source documents are unavailable.');
  const records = new Map(sourceRecords.map((record) => [record.id, record]));
  const prepared: PreparedSource[] = [];
  let unitCount = 0;
  let characterCount = 0;
  for (const selected of request.documents) {
    const record = records.get(selected.documentId);
    if (!record || record.extraction_status !== 'ready' || !Array.isArray(record.extraction_units)
      || !['page', 'slide', 'paragraph', 'line'].includes(record.extraction_range_kind)) invalid('Selected source extraction is unavailable.');
    const extraction = record.extraction_units as Extraction['units'];
    const unitsByNumber = new Map(extraction.map((unit) => [unit.number, unit]));
    const units: PreparedSource['units'] = [];
    for (const range of selected.ranges) {
      const rangeUnits: PreparedSource['units'] = [];
      for (let number = range.start; number <= range.end; number++) {
        const unit = unitsByNumber.get(number);
        if (!unit || typeof unit.text !== 'string') invalid('A selected range is outside the extracted source.');
        rangeUnits.push({ number, text: unit.text });
      }
      units.push(...rangeUnits);
    }
    unitCount += units.length;
    characterCount += units.reduce((sum, unit) => sum + Array.from(unit.text).length, 0);
    if (unitCount > MAX_SELECTED_UNITS || characterCount > MAX_SELECTED_SOURCE_CHARS) invalid('Selected source material exceeds the generation context limit.');
    prepared.push({ documentId: record.id, filename: record.original_filename, rangeKind: record.extraction_range_kind as PreparedSource['rangeKind'], ranges: selected.ranges, units });
  }
  return prepared;
}

const STOP_WORDS = new Set('about above after again against all also am an and any are as at be because been before being between both but by can did do does each few for from further had has have he her here hers him his how i if in into is it its itself just more most no nor not of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to under until up us very was we were what when where which while who why will with would you your'.split(' '));
function meaningfulTokens(text: string): string[] {
  return (text.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []).filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
}
function hasGrounding(question: GeneratedQuestion, sources: PreparedSource[]): boolean {
  const referencedText = question.sourceReferences.map((reference) => {
    const source = sources.find((candidate) => candidate.documentId === reference.documentId);
    return source?.units.filter((unit) => unit.number >= reference.locationStart && unit.number <= reference.locationEnd).map((unit) => unit.text).join(' ') || '';
  }).join(' ');
  const claim = [question.questionText, question.explanation, question.topic, ...question.options.filter((option) => option.isCorrect).map((option) => option.text)].join(' ');
  const terms = meaningfulTokens(claim);
  const evidence = new Set(meaningfulTokens(referencedText));
  const matching = new Set(terms.filter((term) => evidence.has(term)));
  const needed = Math.min(3, Math.max(1, Math.ceil(terms.length * 0.2)));
  return matching.size >= needed;
}

export function validateGeneratedQuestions(value: unknown, request: GenerationRequest, sources: PreparedSource[]): GeneratedQuestion[] {
  if (!isPlainObject(value) || !exactKeys(value, ['questions']) || !Array.isArray(value.questions)) invalid('Model returned an invalid question collection.');
  const expectedCount = questionTypes.reduce((sum, type) => sum + request.questionCounts[type], 0);
  if (value.questions.length !== expectedCount) invalid('Model returned a different number of questions than requested.');
  const documents = new Map(sources.map((source) => [source.documentId, source]));
  const typeCounts: Record<GeneratedQuestionType, number> = { mcq: 0, multiple_select: 0, true_false: 0 };
  const difficultyCounts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
  const questionFingerprints = new Set<string>();
  const questions = value.questions.map((raw: unknown) => {
    const fields = ['questionType', 'questionText', 'options', 'explanation', 'marks', 'difficulty', 'cognitiveLevel', 'topic', 'sourceReferences'];
    if (!isPlainObject(raw) || !exactKeys(raw, fields)) invalid('Model returned an unexpected question structure.');
    if (!questionTypes.includes(raw.questionType)) invalid('Model returned an unsupported question type.');
    if (typeof raw.questionText !== 'string' || raw.questionText.trim().length < 10 || raw.questionText.length > 600) invalid('Generated question text is missing or too long.');
    if (typeof raw.explanation !== 'string' || raw.explanation.trim().length < 10 || raw.explanation.length > 1_200) invalid('Every generated question needs a concise explanation.');
    if (typeof raw.marks !== 'number' || !Number.isFinite(raw.marks) || raw.marks <= 0 || raw.marks > 100 || Math.round(raw.marks * 100) !== raw.marks * 100) invalid('Question marks must be positive and fit the assessment mark precision.');
    if (!difficulties.includes(raw.difficulty)) invalid('Generated question difficulty is invalid.');
    if (!request.cognitiveLevels.includes(raw.cognitiveLevel)) invalid('Generated cognitive level was not requested.');
    if (typeof raw.topic !== 'string' || !raw.topic.trim() || raw.topic.length > 120) invalid('Generated topic is missing or too long.');
    if (request.topicCoverage.length && !request.topicCoverage.some((topic) => topic.toLocaleLowerCase() === raw.topic.trim().toLocaleLowerCase())) invalid('Generated topic is outside requested topic coverage.');
    if (!Array.isArray(raw.options)) invalid('Question options must be an array.');
    const options = raw.options.map((option: unknown) => {
      if (!isPlainObject(option) || !exactKeys(option, ['text', 'isCorrect']) || typeof option.text !== 'string' || !option.text.trim() || option.text.length > 400 || typeof option.isCorrect !== 'boolean') invalid('Generated option structure is invalid.');
      return { text: option.text.trim(), isCorrect: option.isCorrect };
    });
    const optionTexts = options.map((option: GeneratedOption) => option.text.toLocaleLowerCase());
    if (new Set(optionTexts).size !== optionTexts.length) invalid('Generated options must be distinct.');
    const correctCount = options.filter((option: GeneratedOption) => option.isCorrect).length;
    if (raw.questionType === 'mcq' && (options.length < 2 || options.length > 6 || correctCount !== 1)) invalid('MCQ requires 2–6 options and exactly one correct answer.');
    if (raw.questionType === 'multiple_select' && (options.length < 2 || options.length > 6 || correctCount < 1)) invalid('Multiple select requires 2–6 options and at least one correct answer.');
    if (raw.questionType === 'true_false' && (options.length !== 2 || correctCount !== 1 || new Set(options.map((option: GeneratedOption) => option.text)).size !== 2 || !['true', 'false'].every((fixed) => optionTexts.includes(fixed)))) invalid('True/False requires the fixed True and False options and exactly one correct answer.');

    if (!Array.isArray(raw.sourceReferences) || raw.sourceReferences.length < 1 || raw.sourceReferences.length > 4) invalid('Every generated question needs 1–4 source references.');
    const sourceReferences = raw.sourceReferences.map((reference: unknown) => {
      if (!isPlainObject(reference) || !exactKeys(reference, ['documentId', 'rangeKind', 'locationStart', 'locationEnd']) || typeof reference.documentId !== 'string' || !Number.isSafeInteger(reference.locationStart) || !Number.isSafeInteger(reference.locationEnd) || reference.locationStart < 1 || reference.locationEnd < reference.locationStart) invalid('Generated source reference structure is invalid.');
      const source = documents.get(reference.documentId);
      const selected = request.documents.find((document) => document.documentId === reference.documentId);
      if (!source || !selected || source.rangeKind !== reference.rangeKind || !selected.ranges.some((range) => reference.locationStart >= range.start && reference.locationEnd <= range.end)) invalid('Generated source reference is not within a selected source range.');
      if (!source.units.some((unit) => unit.number === reference.locationStart) || !source.units.some((unit) => unit.number === reference.locationEnd)) invalid('Generated source reference points outside extracted content.');
      return { documentId: reference.documentId, rangeKind: reference.rangeKind, locationStart: reference.locationStart, locationEnd: reference.locationEnd };
    });
    if (new Set(sourceReferences.map((reference) => `${reference.documentId}:${reference.rangeKind}:${reference.locationStart}:${reference.locationEnd}`)).size !== sourceReferences.length) {
      invalid('Generated source references must be distinct.');
    }
    const question: GeneratedQuestion = { questionType: raw.questionType, questionText: raw.questionText.trim(), options, explanation: raw.explanation.trim(), marks: raw.marks, difficulty: raw.difficulty, cognitiveLevel: raw.cognitiveLevel, topic: raw.topic.trim(), sourceReferences };
    if (!hasGrounding(question, sources)) invalid('Generated content did not contain enough verifiable lexical support in its cited source ranges.');
    const fingerprint = question.questionText.toLocaleLowerCase().replace(/\W+/g, ' ').trim();
    if (questionFingerprints.has(fingerprint)) invalid('Generated questions contain duplicates.');
    questionFingerprints.add(fingerprint);
    typeCounts[question.questionType]++;
    difficultyCounts[question.difficulty]++;
    return question;
  });
  if (questionTypes.some((type) => typeCounts[type] !== request.questionCounts[type])) invalid('Generated question type counts do not match the request.');
  if (difficulties.some((level) => difficultyCounts[level] !== request.difficultyDistribution[level])) invalid('Generated difficulty distribution does not match the request.');
  return questions;
}

export function generationMetadataPayload(request: GenerationRequest) {
  return {
    questionCounts: request.questionCounts,
    difficultyDistribution: request.difficultyDistribution,
    cognitiveLevels: request.cognitiveLevels,
    topicCoverage: request.topicCoverage,
    instructionsSha256: crypto.createHash('sha256').update(request.additionalInstructions || '').digest('hex'),
  };
}

export class AssessmentQuestionGenerationEngine {
  constructor(private readonly provider: AssessmentQuestionGenerationProvider, private readonly repository: AssessmentGenerationRepository) {}

  /** Generate and fully validate a candidate without persisting it; review workflows own the atomic replacement. */
  async generateCandidate(mentorId:string,request:GenerationRequest):Promise<GeneratedQuestion[]> {
    const access=await this.repository.authorizeAndLoadSources(mentorId,request.assessmentId,request.moduleId,request.documents.map(d=>d.documentId));
    const sources=prepareSelectedSources(request,access.sources);
    const output=await this.provider.generateAssessmentQuestions({requirements:{questionCounts:request.questionCounts,difficultyDistribution:request.difficultyDistribution,cognitiveLevels:request.cognitiveLevels,topicCoverage:request.topicCoverage,additionalInstructions:request.additionalInstructions},sourceDocuments:sources.map(({documentId,filename,rangeKind,units})=>({documentId,filename,rangeKind,units}))});
    if(!this.provider.isAllowedResponseModel(output.actualModel))throw new AssessmentGenerationError('model_mismatch',502,'The configured assessment provider returned an unexpected model identifier.');
    return validateGeneratedQuestions({questions:output.questions},request,sources);
  }

  async generate(mentorId: string, request: GenerationRequest) {
    const access = await this.repository.authorizeAndLoadSources(mentorId, request.assessmentId, request.moduleId, request.documents.map((document) => document.documentId));
    const sources = prepareSelectedSources(request, access.sources);
    const selectedSources = sources.map(({ documentId, rangeKind, ranges }) => ({ documentId, rangeKind, ranges }));
    const begun = await this.repository.begin({ mentorId, request, selectedSources, metadata: generationMetadataPayload(request) });
    if (begun.status === 'completed') return { ...begun, questions: await this.repository.getCompletedQuestions(begun.jobId, request.assessmentId) };
    if (!begun.acquired || !begun.leaseToken) throw new AssessmentGenerationError('generation_in_progress', 409, 'A generation with this idempotency key is already in progress.');
    try {
      const output = await this.provider.generateAssessmentQuestions({
        requirements: {
          questionCounts: request.questionCounts,
          difficultyDistribution: request.difficultyDistribution,
          cognitiveLevels: request.cognitiveLevels,
          topicCoverage: request.topicCoverage,
          additionalInstructions: request.additionalInstructions,
        },
        sourceDocuments: sources.map(({ documentId, filename, rangeKind, units }) => ({ documentId, filename, rangeKind, units })),
      });
      if (!this.provider.isAllowedResponseModel(output.actualModel)) {
        throw new AssessmentGenerationError('model_mismatch', 502, 'The configured assessment provider returned an unexpected model identifier.');
      }
      const questions = validateGeneratedQuestions({ questions: output.questions }, request, sources);
      const saved = await this.repository.persist({ jobId: begun.jobId, leaseToken: begun.leaseToken, assessmentId: request.assessmentId, questions, actualModel: output.actualModel, promptTokens: output.promptTokens, completionTokens: output.completionTokens, latencyMs: output.latencyMs });
      return { ...saved, questions };
    } catch (error) {
      const persistenceFailed = error instanceof Error && error.message === 'generation_persistence_failed';
      const code = persistenceFailed ? 'generation_persistence_failed'
        : error instanceof AssessmentGenerationError ? 'output_validation_failed'
          : error instanceof AssessmentProviderError ? error.code.toLocaleLowerCase() : 'generation_failed';
      let failureStateRecordingFailed = false;
      try {
        await this.repository.fail(begun.jobId, begun.leaseToken, code);
      } catch {
        // Preserve the original safe generation error. The processing lease can
        // expire and be recovered; never replace the provider/validation error.
        failureStateRecordingFailed = true;
      }
      const generationError = error instanceof AssessmentGenerationError ? error
        : persistenceFailed ? new AssessmentGenerationError('generation_persistence_failed', 500, 'Generated questions were received but could not be saved. Check the backend log for the database error.')
          : error instanceof AssessmentProviderError ? new AssessmentGenerationError(error.code.toLocaleLowerCase(), error.statusCode === 429 ? 429 : error.statusCode === 408 ? 504 : error.statusCode === 503 ? 503 : 502, error.code === 'MISSING_API_KEY' ? 'Groq question generation is not configured on the backend.' : 'AI question generation could not be completed safely.')
            : new AssessmentGenerationError('generation_failed', 502, 'AI question generation could not be completed safely.');
      generationError.failureStateRecordingFailed = failureStateRecordingFailed;
      throw generationError;
    }
  }
}

export interface AssessmentGenerationRepository {
  authorizeAndLoadSources(mentorId: string, assessmentId: string, moduleId: string, documentIds: string[]): Promise<{ sources: Array<{ id: string; original_filename: string; extraction_status: string; extraction_units: unknown; extraction_range_kind: string }> }>;
  begin(args: { mentorId: string; request: GenerationRequest; selectedSources: Array<{ documentId: string; rangeKind: string; ranges: SelectedRange[] }>; metadata: ReturnType<typeof generationMetadataPayload> }): Promise<{ jobId: string; leaseToken?: string; acquired: boolean; status: string }>;
  persist(args: { jobId: string; leaseToken: string; assessmentId: string; questions: GeneratedQuestion[]; actualModel: string; promptTokens?: number; completionTokens?: number; latencyMs: number }): Promise<{ jobId: string; status: string; questions: GeneratedQuestion[] }>;
  fail(jobId: string, leaseToken: string, errorCode: string): Promise<void>;
  getCompletedQuestions(jobId: string, assessmentId: string): Promise<GeneratedQuestion[]>;
}

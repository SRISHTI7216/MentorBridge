import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { AssessmentGenerationRepository, GeneratedQuestion, GenerationRequest } from './assessmentQuestionGeneration.js';

/** Service-role repository. Calls remain server-side; RPCs own the atomic write boundary. */
export class SupabaseAssessmentQuestionGenerationRepository implements AssessmentGenerationRepository {
  private get db() {
    if (!supabaseAdmin) throw new Error('database_unavailable');
    return supabaseAdmin;
  }

  async authorizeAndLoadSources(mentorId: string, assessmentId: string, moduleId: string, documentIds: string[]) {
    const [profileResult, assessmentResult, moduleResult, linkResult, docsResult, extractionResult] = await Promise.all([
      this.db.from('profiles').select('id,role,is_active').eq('id', mentorId).maybeSingle(),
      this.db.from('assessments').select('id,mentor_id,status,origin_module_id').eq('id', assessmentId).maybeSingle(),
      this.db.from('learning_modules').select('id,created_by,status').eq('id', moduleId).maybeSingle(),
      this.db.from('module_assessment_links').select('module_id,assessment_id').eq('assessment_id', assessmentId).eq('module_id', moduleId).maybeSingle(),
      this.db.from('assessment_source_documents').select('id,module_id,assessment_id,uploaded_by,original_filename,extraction_status').eq('assessment_id', assessmentId).eq('module_id', moduleId).in('id', documentIds),
      this.db.from('assessment_source_document_extractions').select('source_document_id,extraction_units,extraction_range_kind').in('source_document_id', documentIds),
    ]);
    if (profileResult.error || assessmentResult.error || moduleResult.error || linkResult.error || docsResult.error || extractionResult.error) throw new Error('generation_authorization_failed');
    const profile = profileResult.data; const assessment = assessmentResult.data; const module = moduleResult.data;
    if (!profile || profile.role !== 'mentor' || !profile.is_active || !assessment || assessment.mentor_id !== mentorId || assessment.status !== 'draft'
      || !module || module.created_by !== mentorId || module.status !== 'draft' || !linkResult.data
      || (assessment.origin_module_id && assessment.origin_module_id !== moduleId)) throw new Error('generation_not_authorized');
    if ((docsResult.data || []).length !== documentIds.length || (docsResult.data || []).some((d: any) => d.uploaded_by !== mentorId)) throw new Error('generation_source_unavailable');
    const caches = new Map((extractionResult.data || []).map((row: any) => [row.source_document_id, row]));
    return { sources: (docsResult.data || []).map((doc: any) => {
      const cache: any = caches.get(doc.id);
      return { id: doc.id, original_filename: doc.original_filename, extraction_status: doc.extraction_status,
        extraction_units: cache?.extraction_units, extraction_range_kind: cache?.extraction_range_kind };
    }) };
  }

  async begin(args: { mentorId: string; request: GenerationRequest; selectedSources: Array<{ documentId: string; rangeKind: string; ranges: Array<{start:number;end:number}> }>; metadata: Record<string, unknown> }) {
    const { data, error } = await this.db.rpc('begin_assessment_question_generation', {
      p_assessment_id: args.request.assessmentId, p_module_id: args.request.moduleId, p_mentor_id: args.mentorId,
      p_idempotency_key: args.request.idempotencyKey, p_request_metadata: args.metadata, p_selected_sources: args.selectedSources,
    });
    if (error || !data) throw new Error('generation_job_unavailable');
    const row = Array.isArray(data) ? data[0] : data;
    return { jobId: row.job_id, leaseToken: row.lease_token ?? undefined, acquired: row.acquired === true, status: row.status };
  }

  async persist(args: { jobId: string; leaseToken: string; assessmentId: string; questions: GeneratedQuestion[]; actualModel: string; promptTokens?: number; completionTokens?: number; latencyMs: number }) {
    const { data, error } = await this.db.rpc('persist_assessment_question_generation', {
      p_job_id: args.jobId, p_lease_token: args.leaseToken, p_assessment_id: args.assessmentId,
      p_questions: args.questions, p_actual_model: args.actualModel, p_prompt_tokens: args.promptTokens ?? null,
      p_completion_tokens: args.completionTokens ?? null, p_latency_ms: args.latencyMs,
    });
    if (error || !data) {
      // Keep prompts, source content, and credentials out of logs. Supabase's
      // database code/message are enough to diagnose schema/RPC rejections.
      console.error('[AssessmentQuestionGeneration] persistence RPC failed', {
        code: error?.code || null,
        message: error?.message || (!data ? 'RPC returned no data.' : 'Unknown database error.'),
        hint: error?.hint || null,
        where: (error as any)?.where || null,
        routine: (error as any)?.routine || null,
        // PostgreSQL may put a content excerpt in JSON parse details; omit it.
      });
      throw new Error('generation_persistence_failed');
    }
    const row = Array.isArray(data) ? data[0] : data;
    return { jobId: args.jobId, status: row.status ?? 'completed', questions: args.questions };
  }

  async fail(jobId: string, leaseToken: string, errorCode: string) {
    const { error } = await this.db.rpc('fail_assessment_question_generation', { p_job_id: jobId, p_lease_token: leaseToken, p_error_code: errorCode });
    if (error) throw new Error('generation_failure_state_unavailable');
  }

  async getCompletedQuestions(jobId: string, assessmentId: string): Promise<GeneratedQuestion[]> {
    const { data, error } = await this.db.from('assessment_questions').select('id,question_type,question_text,marks,explanation,generation_difficulty,generation_cognitive_level,generation_topic,assessment_options(option_text,is_correct),assessment_question_source_references(source_document_id,location_kind,location_start,location_end)')
      .eq('generation_job_id', jobId).eq('assessment_id', assessmentId).order('question_order');
    if (error || !data) throw new Error('generation_result_unavailable');
    return data.map((row: any) => ({ questionType: row.question_type, questionText: row.question_text, marks: Number(row.marks), explanation: row.explanation,
      difficulty: row.generation_difficulty, cognitiveLevel: row.generation_cognitive_level, topic: row.generation_topic,
      options: (row.assessment_options || []).map((o: any) => ({ text: o.option_text, isCorrect: o.is_correct })),
      sourceReferences: (row.assessment_question_source_references || []).map((r: any) => ({ documentId: r.source_document_id, rangeKind: r.location_kind, locationStart: r.location_start, locationEnd: r.location_end })) }));
  }
}

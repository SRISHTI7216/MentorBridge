import { supabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin.js';
import crypto from 'crypto';

export interface StoredOption {
  id: string;
  questionId: string;
  optionOrder: number;
  optionText: string;
  isCorrect: boolean;
}

export interface StoredQuestion {
  id: string;
  assessmentId: string;
  questionOrder: number;
  questionType: 'mcq' | 'multiple_select' | 'true_false' | 'descriptive';
  questionText: string;
  marks: number;
  evaluationGuidance?: string;
  explanation?: string;
  options: StoredOption[];
}

export interface StoredAssignment {
  id: string;
  assessmentId: string;
  studentId: string;
  cohortId?: string | null;
  assignedAt: string;
}

export interface StoredAssessment {
  id: string;
  mentorId: string;
  originModuleId?: string | null;
  academicTermId: string;
  title: string;
  description: string;
  subject: string;
  topic: string;
  durationMinutes: number;
  totalMarks: number;
  passingMarks: number;
  passingPercentage?: number | null;
  startTime: string;
  endTime: string;
  allowedAttempts: number;
  status: 'draft' | 'published' | 'completed' | 'archived';
  isResultsPublished: boolean;
  resultsPublishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAnswer {
  id: string;
  attemptId: string;
  questionId: string;
  selectedOptionId?: string | null;
  selectedOptionIds?: string[];
  descriptiveAnswer?: string | null;
  isCorrect?: boolean | null;
  marksObtained: number;
  mentorFeedback?: string | null;
  evaluatedAt?: string | null;
  updatedAt: string;
}

export interface StoredAttempt {
  id: string;
  assessmentId: string;
  studentId: string;
  attemptNumber: number;
  startedAt: string;
  submittedAt?: string | null;
  status: 'in_progress' | 'submitted' | 'evaluated' | 'abandoned';
  mcqScore: number;
  descriptiveScore: number;
  totalScore: number;
  isEvaluated: boolean;
  evaluatedAt?: string | null;
  evaluatedBy?: string | null;
  generalFeedback?: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapAssessmentRow(row: any): StoredAssessment {
  return {
    id: row.id,
    mentorId: row.mentor_id,
    originModuleId: row.origin_module_id || null,
    academicTermId: row.academic_term_id,
    title: row.title,
    description: row.description || '',
    subject: row.subject,
    topic: row.topic,
    durationMinutes: Number(row.duration_minutes),
    totalMarks: Number(row.total_marks || 0),
    passingMarks: Number(row.passing_marks || 0),
    passingPercentage: row.passing_percentage == null ? null : Number(row.passing_percentage),
    startTime: row.start_time,
    endTime: row.end_time,
    allowedAttempts: Number(row.allowed_attempts || 1),
    status: row.status,
    isResultsPublished: Boolean(row.is_results_published),
    resultsPublishedAt: row.results_published_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapQuestionRow(qRow: any, optRows: any[] = []): StoredQuestion {
  return {
    id: qRow.id,
    assessmentId: qRow.assessment_id,
    questionOrder: Number(qRow.question_order),
    questionType: qRow.question_type,
    questionText: qRow.question_text,
    marks: Number(qRow.marks),
    evaluationGuidance: qRow.evaluation_guidance || undefined,
    explanation: qRow.explanation || undefined,
    options: optRows.map((o) => ({
      id: o.id,
      questionId: o.question_id,
      optionOrder: Number(o.option_order),
      optionText: o.option_text,
      isCorrect: Boolean(o.is_correct),
    })),
  };
}

function mapAttemptRow(row: any): StoredAttempt {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    studentId: row.student_id,
    attemptNumber: Number(row.attempt_number),
    startedAt: row.started_at,
    submittedAt: row.submitted_at || null,
    status: row.status,
    mcqScore: Number(row.mcq_score || 0),
    descriptiveScore: Number(row.descriptive_score || 0),
    totalScore: Number(row.total_score || 0),
    isEvaluated: Boolean(row.is_evaluated),
    evaluatedAt: row.evaluated_at || null,
    evaluatedBy: row.evaluated_by || null,
    generalFeedback: row.general_feedback || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAnswerRow(row: any): StoredAnswer {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    questionId: row.question_id,
    selectedOptionId: row.selected_option_id || null,
    selectedOptionIds: row.selected_option_ids || (row.selected_option_id ? [row.selected_option_id] : []),
    descriptiveAnswer: row.descriptive_answer || null,
    isCorrect: row.is_correct !== null ? Boolean(row.is_correct) : null,
    marksObtained: Number(row.marks_obtained || 0),
    mentorFeedback: row.mentor_feedback || null,
    evaluatedAt: row.evaluated_at || null,
    updatedAt: row.updated_at,
  };
}

class AssessmentStore {
  // Ensure Supabase is configured and ready
  private getDb() {
    if (!isSupabaseAdminConfigured() || !supabaseAdmin) {
      throw new Error('Supabase database connection is not configured on the server. Please check .env configuration.');
    }
    return supabaseAdmin;
  }

  // --- Assessment Operations ---

  async createAssessment(data: Omit<StoredAssessment, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoredAssessment> {
    const db = this.getDb();
    const id = crypto.randomUUID();

    const insertPayload = {
      id,
      mentor_id: data.mentorId,
      academic_term_id: data.academicTermId || 'a0000000-0000-0000-0000-000000000001',
      title: data.title,
      description: data.description || '',
      subject: data.subject,
      topic: data.topic,
      duration_minutes: data.durationMinutes,
      total_marks: data.totalMarks,
      passing_marks: data.passingMarks || 0,
      passing_percentage: data.passingPercentage ?? null,
      start_time: data.startTime,
      end_time: data.endTime,
      allowed_attempts: data.allowedAttempts || 1,
      status: data.status || 'draft',
      is_results_published: Boolean(data.isResultsPublished),
      ...(data.originModuleId ? { origin_module_id: data.originModuleId } : {}),
    };

    const { data: created, error } = await db
      .from('assessments')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) {
      console.error('[AssessmentStore] Failed to insert assessment into Supabase:', error.message);
      throw new Error(`Database error creating assessment: ${error.message}`);
    }

    // Auto-assign mentor's active mentees so RLS and access work immediately
    try {
      const { data: mentees } = await db
        .from('mentor_assignments')
        .select('student_id')
        .eq('mentor_id', data.mentorId)
        .eq('is_active', true);

      if (mentees && mentees.length > 0) {
        const assignmentsToInsert = mentees.map((m) => ({
          assessment_id: id,
          student_id: m.student_id,
        }));
        await db.from('assessment_assignments').upsert(assignmentsToInsert, {
          onConflict: 'assessment_id,student_id',
          ignoreDuplicates: true,
        });
      }
    } catch (assignErr: any) {
      console.warn('[AssessmentStore] Mentee auto-assignment notice:', assignErr.message);
    }

    return mapAssessmentRow(created);
  }

  async getAssessment(id: string): Promise<StoredAssessment | null> {
    const db = this.getDb();
    const { data, error } = await db.from('assessments').select('*').eq('id', id).maybeSingle();
    if (error) {
      console.error('[AssessmentStore] Failed to get assessment from Supabase:', error.message);
      throw new Error(`Database error fetching assessment: ${error.message}`);
    }
    return data ? mapAssessmentRow(data) : null;
  }

  async updateAssessment(id: string, updates: Partial<StoredAssessment>, expectedStatuses?: StoredAssessment['status'][], expectedResultsPublished?: boolean): Promise<StoredAssessment | null> {
    const db = this.getDb();
    const payload: any = { updated_at: new Date().toISOString() };

    if (updates.title !== undefined) payload.title = updates.title;
    if (updates.description !== undefined) payload.description = updates.description;
    if (updates.subject !== undefined) payload.subject = updates.subject;
    if (updates.topic !== undefined) payload.topic = updates.topic;
    if (updates.durationMinutes !== undefined) payload.duration_minutes = updates.durationMinutes;
    if (updates.totalMarks !== undefined) payload.total_marks = updates.totalMarks;
    if (updates.passingMarks !== undefined) payload.passing_marks = updates.passingMarks;
    if (updates.passingPercentage !== undefined) payload.passing_percentage = updates.passingPercentage;
    if (updates.startTime !== undefined) payload.start_time = updates.startTime;
    if (updates.endTime !== undefined) payload.end_time = updates.endTime;
    if (updates.allowedAttempts !== undefined) payload.allowed_attempts = updates.allowedAttempts;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.isResultsPublished !== undefined) payload.is_results_published = updates.isResultsPublished;
    if (updates.resultsPublishedAt !== undefined) payload.results_published_at = updates.resultsPublishedAt;

    let query = db.from('assessments').update(payload).eq('id', id);
    if (expectedStatuses) query = query.in('status', expectedStatuses);
    if (expectedResultsPublished !== undefined) query = query.eq('is_results_published', expectedResultsPublished);
    const { data, error } = await query.select('*').maybeSingle();

    if (error) {
      console.error('[AssessmentStore] Failed to update assessment in Supabase:', error.message);
      throw new Error(`Database error updating assessment: ${error.message}`);
    }

    return data ? mapAssessmentRow(data) : null;
  }

  async deleteAssessment(id: string): Promise<boolean> {
    const db = this.getDb();
    const { error } = await db.from('assessments').delete().eq('id', id);
    if (error) {
      console.error('[AssessmentStore] Failed to delete assessment in Supabase:', error.message);
      throw new Error(`Database error deleting assessment: ${error.message}`);
    }
    return true;
  }

  async getMentorAssessments(mentorId: string): Promise<StoredAssessment[]> {
    const db = this.getDb();
    const { data, error } = await db
      .from('assessments')
      .select('*')
      .eq('mentor_id', mentorId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[AssessmentStore] Failed to get mentor assessments from Supabase:', error.message);
      throw new Error(`Database error fetching mentor assessments: ${error.message}`);
    }

    return (data || []).map(mapAssessmentRow);
  }

  async getStudentAssessments(studentId: string): Promise<StoredAssessment[]> {
    const db = this.getDb();

    const { data: allAssessments, error } = await db
      .from('assessments')
      .select('*')
      .in('status', ['published', 'completed', 'archived'])
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[AssessmentStore] Failed to get student assessments from Supabase:', error.message);
      throw new Error(`Database error fetching student assessments: ${error.message}`);
    }

    const eligibility = await Promise.all((allAssessments || []).map(async (a) => ({
      assessment: a,
      eligible: await this.canStudentAccessAssessment(a.id, studentId),
    })));
    const visibleAssessments = eligibility.filter((item) => item.eligible).map((item) => mapAssessmentRow(item.assessment));
    const withHistory = await Promise.all(visibleAssessments.map(async (assessment) => assessment.status !== 'archived'
      || (await this.getStudentAttempts(assessment.id, studentId)).length > 0));
    return visibleAssessments.filter((_assessment, index) => withHistory[index]);
  }

  async canStudentAccessAssessment(assessmentId: string, studentId: string): Promise<boolean> {
    const { data, error } = await this.getDb().rpc('assessment_student_is_eligible', { p_assessment_id: assessmentId, p_student_id: studentId });
    if (error) throw new Error('Unable to verify assessment eligibility.');
    if (data === true) return true;

    // Direct assessment assignment fallback
    const { data: directAssignment } = await this.getDb()
      .from('assessment_assignments')
      .select('id')
      .eq('assessment_id', assessmentId)
      .eq('student_id', studentId)
      .maybeSingle();
    if (directAssignment) return true;

    // Active mentor mentee fallback
    const assessment = await this.getAssessment(assessmentId);
    if (assessment) {
      const { data: mentorAssignment } = await this.getDb()
        .from('mentor_assignments')
        .select('id')
        .eq('mentor_id', assessment.mentorId)
        .eq('student_id', studentId)
        .eq('is_active', true)
        .maybeSingle();
      if (mentorAssignment) return true;
    }

    if (assessment?.status !== 'archived') return false;
    return (await this.getStudentAttempts(assessmentId, studentId)).length > 0;
  }

  async getStudentAssessmentQuestions(assessmentId: string, studentId: string): Promise<StoredQuestion[]> {
    const assessment = await this.getAssessment(assessmentId);
    if (assessment?.status === 'archived') {
      const attempts = await this.getStudentAttempts(assessmentId, studentId);
      if (!attempts.some((attempt) => attempt.status === 'in_progress')) return [];
      // Archived assessments cannot start new work, but a student's existing attempt
      // still needs its question text to resume and submit through Phase 5C.6.
      return this.getAssessmentQuestions(assessmentId);
    }
    const { data, error } = await this.getDb().rpc('student_assessment_content_for_backend', {
      p_assessment_id: assessmentId, p_student_id: studentId,
    });
    if (error) throw new Error('Unable to load assessment questions.');
    const questions = new Map<string, any>();
    for (const row of data || []) {
      const question = questions.get(row.question_id) || { id: row.question_id, assessment_id: assessmentId, question_order: row.question_order, question_type: row.question_type, question_text: row.question_text, marks: row.marks };
      if (row.option_id) question.options = [...(question.options || []), { id: row.option_id, question_id: row.question_id, option_order: row.option_order, option_text: row.option_text }];
      questions.set(row.question_id, question);
    }
    return [...questions.values()].map((question) => mapQuestionRow(question, question.options || []));
  }

  // --- Questions & Options Operations ---

  async addQuestion(question: Omit<StoredQuestion, 'id'>): Promise<StoredQuestion> {
    const db = this.getDb();
    const qId = crypto.randomUUID();

    // Insert Question
    const { data: qData, error: qErr } = await db
      .from('assessment_questions')
      .insert({
        id: qId,
        assessment_id: question.assessmentId,
        question_order: question.questionOrder || 1,
        question_type: question.questionType,
        question_text: question.questionText,
        marks: question.marks,
        evaluation_guidance: question.evaluationGuidance || null,
        explanation: question.explanation || null,
      })
      .select('*')
      .single();

    if (qErr) {
      console.error('[AssessmentStore] Failed to insert question in Supabase:', qErr.message);
      throw new Error(`Database error creating question: ${qErr.message}`);
    }

    // Insert Options if MCQ
    let createdOptions: any[] = [];
    if (question.questionType !== 'descriptive' && question.options && question.options.length > 0) {
      const optionsToInsert = question.options.map((opt, idx) => ({
        id: crypto.randomUUID(),
        question_id: qId,
        option_order: opt.optionOrder || idx + 1,
        option_text: opt.optionText,
        is_correct: Boolean(opt.isCorrect),
      }));

      const { data: optData, error: optErr } = await db
        .from('assessment_options')
        .insert(optionsToInsert)
        .select('*');

      if (optErr) {
        console.error('[AssessmentStore] Failed to insert options in Supabase:', optErr.message);
        throw new Error(`Database error creating options: ${optErr.message}`);
      }
      createdOptions = optData || [];
    }

    // Recalculate total marks in assessments table
    await this.syncAssessmentTotalMarks(question.assessmentId);

    return mapQuestionRow(qData, createdOptions);
  }

  async getAssessmentQuestions(assessmentId: string): Promise<StoredQuestion[]> {
    const db = this.getDb();

    const { data: questions, error: qErr } = await db
      .from('assessment_questions')
      .select('*')
      .eq('assessment_id', assessmentId)
      .is('removed_at', null)
      .order('question_order', { ascending: true });

    if (qErr) {
      console.error('[AssessmentStore] Failed to fetch questions from Supabase:', qErr.message);
      throw new Error(`Database error fetching questions: ${qErr.message}`);
    }

    if (!questions || questions.length === 0) return [];

    const qIds = questions.map((q) => q.id);
    const { data: options, error: optErr } = await db
      .from('assessment_options')
      .select('*')
      .in('question_id', qIds)
      .order('option_order', { ascending: true });

    if (optErr) {
      console.error('[AssessmentStore] Failed to fetch options from Supabase:', optErr.message);
      throw new Error(`Database error fetching options: ${optErr.message}`);
    }

    const optMap = new Map<string, any[]>();
    for (const opt of options || []) {
      const list = optMap.get(opt.question_id) || [];
      list.push(opt);
      optMap.set(opt.question_id, list);
    }

    return questions.map((q) => mapQuestionRow(q, optMap.get(q.id) || []));
  }

  async updateQuestion(id: string, updates: Partial<StoredQuestion>): Promise<StoredQuestion | null> {
    const db = this.getDb();

    const qPayload: any = { updated_at: new Date().toISOString() };
    if (updates.questionOrder !== undefined) qPayload.question_order = updates.questionOrder;
    if (updates.questionType !== undefined) qPayload.question_type = updates.questionType;
    if (updates.questionText !== undefined) qPayload.question_text = updates.questionText;
    if (updates.marks !== undefined) qPayload.marks = updates.marks;
    if (updates.evaluationGuidance !== undefined) qPayload.evaluation_guidance = updates.evaluationGuidance;
    if (updates.explanation !== undefined) qPayload.explanation = updates.explanation;
    if ((updates as any).difficulty !== undefined) qPayload.generation_difficulty = (updates as any).difficulty;
    if ((updates as any).cognitiveLevel !== undefined) qPayload.generation_cognitive_level = (updates as any).cognitiveLevel;
    if ((updates as any).topic !== undefined) qPayload.generation_topic = (updates as any).topic;

    const { data: qData, error: qErr } = await db
      .from('assessment_questions')
      .update(qPayload)
      .eq('id', id)
      .select('*')
      .single();

    if (qErr) {
      console.error('[AssessmentStore] Failed to update question in Supabase:', qErr.message);
      throw new Error(`Database error updating question: ${qErr.message}`);
    }

    let finalOptions: any[] = [];
    if (updates.options !== undefined) {
      // Replace options
      const { error: deleteOptionsError } = await db.from('assessment_options').delete().eq('question_id', id);
      if (deleteOptionsError) throw new Error(`Database error removing old options: ${deleteOptionsError.message}`);

      const toInsert = updates.options.map((opt, idx) => ({
        id: crypto.randomUUID(),
        question_id: id,
        option_order: opt.optionOrder || idx + 1,
        option_text: opt.optionText,
        is_correct: Boolean(opt.isCorrect),
      }));

      const { data: newOpts, error: optErr } = toInsert.length > 0
        ? await db.from('assessment_options').insert(toInsert).select('*')
        : { data: [], error: null };

      if (optErr) {
        throw new Error(`Database error replacing options: ${optErr.message}`);
      }
      finalOptions = newOpts || [];
      // Options are stored in a child table. Advance the parent version after
      // all child writes so regeneration workers detect an option-only edit.
      const { error: touchQuestionError } = await db.from('assessment_questions')
        .update({ updated_at: new Date().toISOString() }).eq('id', id);
      if (touchQuestionError) throw new Error(`Database error updating question version: ${touchQuestionError.message}`);
    } else {
      const { data: existingOpts } = await db
        .from('assessment_options')
        .select('*')
        .eq('question_id', id)
        .order('option_order', { ascending: true });
      finalOptions = existingOpts || [];
    }

    await this.syncAssessmentTotalMarks(qData.assessment_id);

    return mapQuestionRow(qData, finalOptions);
  }

  async deleteQuestion(id: string): Promise<boolean> {
    const db = this.getDb();
    const { data: existing } = await db
      .from('assessment_questions')
      .select('assessment_id')
      .eq('id', id)
      .maybeSingle();

    const { error } = await db.from('assessment_questions').delete().eq('id', id);
    if (error) {
      throw new Error(`Database error deleting question: ${error.message}`);
    }

    if (existing?.assessment_id) {
      await this.syncAssessmentTotalMarks(existing.assessment_id);
    }
    return true;
  }

  async reorderQuestions(assessmentId: string, orderedIds: string[]): Promise<boolean> {
    const db = this.getDb();
    for (let i = 0; i < orderedIds.length; i++) {
      const qId = orderedIds[i];
      await db
        .from('assessment_questions')
        .update({ question_order: i + 1, updated_at: new Date().toISOString() })
        .eq('id', qId)
        .eq('assessment_id', assessmentId);
    }
    return true;
  }

  private async syncAssessmentTotalMarks(assessmentId: string): Promise<void> {
    const db = this.getDb();
    const { data: questions } = await db
      .from('assessment_questions')
      .select('marks')
      .eq('assessment_id', assessmentId)
      .is('removed_at', null);

    const sumMarks = (questions || []).reduce((acc, curr) => acc + Number(curr.marks), 0);
    await db
      .from('assessments')
      .update({ total_marks: sumMarks, updated_at: new Date().toISOString() })
      .eq('id', assessmentId);
  }

  // --- Assignments Operations ---

  async assignAssessment(assessmentId: string, studentIds: string[], cohortId?: string): Promise<number> {
    const db = this.getDb();
    let count = 0;
    const records = studentIds.map((sId) => ({
      assessment_id: assessmentId,
      student_id: sId,
      cohort_id: cohortId || null,
    }));

    if (records.length > 0) {
      const { data, error } = await db
        .from('assessment_assignments')
        .upsert(records, { onConflict: 'assessment_id,student_id' })
        .select('*');

      if (error) {
        throw new Error(`Database error assigning students: ${error.message}`);
      }
      count = data?.length || 0;
    }
    return count;
  }

  async getAssessmentAssignments(assessmentId: string): Promise<StoredAssignment[]> {
    const db = this.getDb();
    const { data, error } = await db
      .from('assessment_assignments')
      .select('*')
      .eq('assessment_id', assessmentId);

    if (error) throw new Error(`Database error fetching assignments: ${error.message}`);
    return (data || []).map((row) => ({
      id: row.id,
      assessmentId: row.assessment_id,
      studentId: row.student_id,
      cohortId: row.cohort_id,
      assignedAt: row.assigned_at,
    }));
  }

  async isStudentAssigned(assessmentId: string, studentId: string): Promise<boolean> {
    return this.canStudentAccessAssessment(assessmentId, studentId);
  }

  // --- Attempts Operations ---

  async startAttempt(assessmentId: string, studentId: string): Promise<StoredAttempt> {
    const { data, error } = await this.getDb().rpc('start_assessment_attempt', {
      p_assessment_id: assessmentId, p_student_id: studentId,
    });
    if (error || !data) {
      const message = error?.message || '';
      if (message.includes('Attempt limit reached')) throw new Error('Attempt limit reached.');
      if (message.includes('outside its availability window')) throw new Error('Assessment is outside its availability window.');
      if (message.includes('not available to this student')) throw new Error('Assessment is not available to this student.');
      throw new Error('Unable to start assessment attempt.');
    }
    return mapAttemptRow(Array.isArray(data) ? data[0] : data);
  }

  async getAttempt(attemptId: string): Promise<StoredAttempt | null> {
    const db = this.getDb();
    const { data, error } = await db
      .from('assessment_attempts')
      .select('*')
      .eq('id', attemptId)
      .maybeSingle();

    if (error) throw new Error(`Database error fetching attempt: ${error.message}`);
    return data ? mapAttemptRow(data) : null;
  }

  async getStudentAttempts(assessmentId: string, studentId: string): Promise<StoredAttempt[]> {
    const db = this.getDb();
    const { data, error } = await db
      .from('assessment_attempts')
      .select('*')
      .eq('assessment_id', assessmentId)
      .eq('student_id', studentId)
      .order('attempt_number', { ascending: true });

    if (error) throw new Error(`Database error fetching student attempts: ${error.message}`);
    return (data || []).map(mapAttemptRow);
  }

  async getAssessmentSubmissions(assessmentId: string): Promise<StoredAttempt[]> {
    const db = this.getDb();
    const { data, error } = await db
      .from('assessment_attempts')
      .select('*')
      .eq('assessment_id', assessmentId)
      .neq('status', 'in_progress')
      .order('submitted_at', { ascending: false });

    if (error) throw new Error(`Database error fetching submissions: ${error.message}`);
    return (data || []).map(mapAttemptRow);
  }

  async getAssessmentLifecycleAttempts(assessmentId: string): Promise<StoredAttempt[]> {
    const { data, error } = await this.getDb().from('assessment_attempts').select('*')
      .eq('assessment_id', assessmentId).order('attempt_number', { ascending: true });
    if (error) throw new Error(`Database error fetching assessment attempts: ${error.message}`);
    return (data || []).map(mapAttemptRow);
  }

  async getAssessmentSubmissionsPage(assessmentId: string, limit: number, offset: number): Promise<{ attempts: StoredAttempt[]; total: number }> {
    const { data, error, count } = await this.getDb().from('assessment_attempts').select('*', { count: 'exact' })
      .eq('assessment_id', assessmentId).neq('status', 'in_progress')
      .order('submitted_at', { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw new Error('Unable to retrieve paginated submissions.');
    return { attempts: (data || []).map(mapAttemptRow), total: count || 0 };
  }

  // --- Answers Operations ---

  async saveAnswer(
    attemptId: string,
    questionId: string,
    data: { selectedOptionId?: string; selectedOptionIds?: string[]; descriptiveAnswer?: string }
  ): Promise<StoredAnswer> {
    const { data: saved, error } = await this.getDb().rpc('save_assessment_attempt_answer', {
      p_attempt_id: attemptId, p_question_id: questionId,
      p_selected_option_ids: data.selectedOptionIds ?? (data.selectedOptionId ? [data.selectedOptionId] : []),
      p_descriptive_answer: data.descriptiveAnswer ?? null,
    });
    if (error || !saved) {
      if (error?.message?.includes('Attempt has expired')) throw new Error('Attempt has expired.');
      if (error?.message?.includes('Attempt is not writable')) throw new Error('Attempt is no longer active.');
      throw new Error('Unable to save answer. Attempt may be expired or no longer active.');
    }
    return mapAnswerRow(Array.isArray(saved) ? saved[0] : saved);
  }

  async getAttemptAnswers(attemptId: string): Promise<StoredAnswer[]> {
    const db = this.getDb();
    const { data, error } = await db
      .from('assessment_answers')
      .select('*')
      .eq('attempt_id', attemptId);

    if (error) throw new Error(`Database error fetching attempt answers: ${error.message}`);
    return (data || []).map(mapAnswerRow);
  }

  // Submit and auto-evaluate MCQs
  async submitAttempt(attemptId: string): Promise<StoredAttempt | null> {
    const { data, error } = await this.getDb().rpc('submit_assessment_attempt', { p_attempt_id: attemptId });
    if (error || !data) return null;
    return mapAttemptRow(Array.isArray(data) ? data[0] : data);
    /* Legacy multi-request grading removed: it allowed partial commits and races.
    const { data: attemptRow, error: attErr } = await db
      .from('assessment_attempts')
      .select('*')
      .eq('id', attemptId)
      .single();

    if (attErr || !attemptRow || attemptRow.status !== 'in_progress') {
      return null;
    }

    // 2. Fetch assessment questions and options
    const questions = await this.getAssessmentQuestions(attemptRow.assessment_id);
    const answers = await this.getAttemptAnswers(attemptId);

    let mcqScore = 0;
    let hasDescriptive = false;

    for (const q of questions) {
      if (q.questionType === 'mcq') {
        const studentAns = answers.find((a) => a.questionId === q.id);
        const correctOpt = q.options.find((opt) => opt.isCorrect);

        let isCorrect = false;
        let marksObtained = 0;

        if (studentAns && correctOpt && studentAns.selectedOptionId === correctOpt.id) {
          isCorrect = true;
          marksObtained = q.marks;
          mcqScore += q.marks;
        }

        // Update answer in Supabase
        if (studentAns) {
          await db
            .from('assessment_answers')
            .update({
              is_correct: isCorrect,
              marks_obtained: marksObtained,
              updated_at: new Date().toISOString(),
            })
            .eq('id', studentAns.id);
        }
      } else {
        hasDescriptive = true;
      }
    }

    const timestamp = new Date().toISOString();
    const updateAttemptPayload: any = {
      submitted_at: timestamp,
      mcq_score: mcqScore,
      total_score: mcqScore,
      updated_at: timestamp,
    };

    if (!hasDescriptive) {
      updateAttemptPayload.is_evaluated = true;
      updateAttemptPayload.status = 'evaluated';
      updateAttemptPayload.evaluated_at = timestamp;
    } else {
      updateAttemptPayload.is_evaluated = false;
      updateAttemptPayload.status = 'submitted';
    }

    const { data: updatedAttempt, error: upErr } = await db
      .from('assessment_attempts')
      .update(updateAttemptPayload)
      .eq('id', attemptId)
      .select('*')
      .single();

    if (upErr) {
      throw new Error(`Database error submitting attempt: ${upErr.message}`);
    }

    return mapAttemptRow(updatedAttempt); */
  }

  // Mentor evaluates descriptive questions
  async evaluateAttempt(
    attemptId: string,
    mentorId: string,
    evaluations: Array<{ questionId: string; marksObtained: number; mentorFeedback?: string }>,
    generalFeedback?: string,
    isAdmin = false,
  ): Promise<StoredAttempt | null> {
    const { data, error } = await this.getDb().rpc('evaluate_assessment_attempt', {
      p_attempt_id: attemptId, p_evaluator_id: mentorId, p_is_admin: isAdmin,
      p_evaluations: evaluations, p_general_feedback: generalFeedback || null,
    });
    if (error) throw new Error('Unable to evaluate attempt.');
    return data ? mapAttemptRow(Array.isArray(data) ? data[0] : data) : null;
  }
}

export const assessmentStore = new AssessmentStore();

import { supabaseAdmin } from '../lib/supabaseAdmin.js';

type Row = Record<string, any>;

type LearningDb = NonNullable<typeof supabaseAdmin>;

export interface LearningActor {
  id: string;
  role: 'student' | 'mentor' | 'admin';
}

export interface DraftLearningModuleInput {
  category_id: string;
  academic_term_id: string;
  code: string;
  title: string;
  semester: number;
  level: 'Fundamental' | 'Intermediate' | 'Advanced';
  description?: string | null;
}

const LESSON_TYPES = ['theory', 'code_lab', 'case_study', 'milestone_prep'] as const;
const RESOURCE_TYPES = ['pdf', 'article_url', 'github_repo', 'doc', 'book_reference'] as const;

export interface LessonMutationInput {
  title?: string;
  summary?: string | null;
  content_markdown?: string;
  lesson_type?: typeof LESSON_TYPES[number];
  estimated_minutes?: number;
  is_mandatory?: boolean;
  code_snippet?: string | null;
  code_language?: string | null;
}

export interface ResourceMutationInput {
  title?: string;
  resource_type?: typeof RESOURCE_TYPES[number];
  url?: string;
  description?: string | null;
  is_mandatory?: boolean;
  lesson_id?: string | null;
}

export class LearningStoreError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'LearningStoreError';
  }
}

const MODULE_LEVELS = ['Fundamental', 'Intermediate', 'Advanced'] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateDraftLearningModule(body: unknown): DraftLearningModuleInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new LearningStoreError('A module object is required.', 400);
  }
  const input = body as Record<string, unknown>;
  if (input.status !== undefined && input.status !== 'draft') {
    throw new LearningStoreError('Modules must be created as drafts. Status cannot be set by the client.', 400);
  }

  const categoryId = typeof input.category_id === 'string' ? input.category_id.trim() : '';
  const academicTermId = typeof input.academic_term_id === 'string' ? input.academic_term_id.trim() : '';
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const semester = input.semester;
  const level = input.level;
  const description = input.description;

  if (!UUID_PATTERN.test(categoryId)) throw new LearningStoreError('Select a valid learning category.', 400);
  if (!UUID_PATTERN.test(academicTermId)) throw new LearningStoreError('Select a valid academic term.', 400);
  if (!code) throw new LearningStoreError('Module code is required.', 400);
  if (title.length < 3) throw new LearningStoreError('Module title must be at least 3 characters.', 400);
  if (typeof semester !== 'number' || !Number.isInteger(semester) || semester < 1 || semester > 8) {
    throw new LearningStoreError('Semester must be an integer from 1 to 8.', 400);
  }
  if (typeof level !== 'string' || !MODULE_LEVELS.includes(level as typeof MODULE_LEVELS[number])) {
    throw new LearningStoreError('Level must be Fundamental, Intermediate, or Advanced.', 400);
  }
  if (description !== undefined && description !== null && typeof description !== 'string') {
    throw new LearningStoreError('Module description must be text.', 400);
  }

  return {
    category_id: categoryId,
    academic_term_id: academicTermId,
    code,
    title,
    semester,
    level: level as DraftLearningModuleInput['level'],
    ...(description === undefined ? {} : { description: description === null ? null : description.trim() }),
  };
}

function inputObject(body: unknown, label: string): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new LearningStoreError(`A ${label} object is required.`, 400);
  }
  return body as Record<string, unknown>;
}

export function validateLessonInput(body: unknown, partial = false): LessonMutationInput {
  const input = inputObject(body, 'lesson');
  const output: LessonMutationInput = {};

  if (!partial || input.title !== undefined) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (title.length < 3) throw new LearningStoreError('Lesson title must be at least 3 characters.', 400);
    output.title = title;
  }
  if (!partial || input.content_markdown !== undefined) {
    const content = typeof input.content_markdown === 'string' ? input.content_markdown.trim() : '';
    if (!content) throw new LearningStoreError('Lesson content is required.', 400);
    output.content_markdown = content;
  }
  if (input.summary !== undefined) {
    if (input.summary !== null && typeof input.summary !== 'string') throw new LearningStoreError('Lesson summary must be text.', 400);
    output.summary = input.summary === null ? null : (input.summary as string).trim();
  }
  if (input.lesson_type !== undefined || !partial) {
    const lessonType = input.lesson_type === undefined ? 'theory' : input.lesson_type;
    if (typeof lessonType !== 'string' || !LESSON_TYPES.includes(lessonType as typeof LESSON_TYPES[number])) {
      throw new LearningStoreError('Lesson type is invalid.', 400);
    }
    output.lesson_type = lessonType as LessonMutationInput['lesson_type'];
  }
  if (input.estimated_minutes !== undefined || !partial) {
    const minutes = input.estimated_minutes === undefined ? 30 : input.estimated_minutes;
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes <= 0) {
      throw new LearningStoreError('Estimated lesson minutes must be a positive integer.', 400);
    }
    output.estimated_minutes = minutes;
  }
  if (input.is_mandatory !== undefined || !partial) {
    const mandatory = input.is_mandatory === undefined ? true : input.is_mandatory;
    if (typeof mandatory !== 'boolean') throw new LearningStoreError('Lesson mandatory setting must be true or false.', 400);
    output.is_mandatory = mandatory;
  }
  for (const field of ['code_snippet', 'code_language'] as const) {
    if (input[field] !== undefined) {
      const value = input[field];
      if (value !== null && typeof value !== 'string') throw new LearningStoreError(`${field} must be text.`, 400);
      output[field] = value === null ? null : (value as string).trim();
    }
  }
  if (partial && Object.keys(output).length === 0) throw new LearningStoreError('Provide at least one lesson field to update.', 400);
  return output;
}

export function validateResourceInput(body: unknown, partial = false): ResourceMutationInput {
  const input = inputObject(body, 'resource');
  const output: ResourceMutationInput = {};

  if (!partial || input.title !== undefined) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (title.length < 3) throw new LearningStoreError('Resource title must be at least 3 characters.', 400);
    output.title = title;
  }
  if (!partial || input.resource_type !== undefined) {
    const resourceType = input.resource_type === undefined ? undefined : input.resource_type;
    if (typeof resourceType !== 'string' || !RESOURCE_TYPES.includes(resourceType as typeof RESOURCE_TYPES[number])) {
      throw new LearningStoreError('Resource type is invalid.', 400);
    }
    output.resource_type = resourceType as ResourceMutationInput['resource_type'];
  }
  if (!partial || input.url !== undefined) {
    const url = typeof input.url === 'string' ? input.url.trim() : '';
    if (url.length < 5) throw new LearningStoreError('Resource URL must contain at least 5 characters.', 400);
    output.url = url;
  }
  if (input.description !== undefined) {
    if (input.description !== null && typeof input.description !== 'string') throw new LearningStoreError('Resource description must be text.', 400);
    output.description = input.description === null ? null : (input.description as string).trim();
  }
  if (input.is_mandatory !== undefined) {
    if (typeof input.is_mandatory !== 'boolean') throw new LearningStoreError('Resource mandatory setting must be true or false.', 400);
    output.is_mandatory = input.is_mandatory;
  }
  if (input.lesson_id !== undefined) {
    if (input.lesson_id !== null && (typeof input.lesson_id !== 'string' || !UUID_PATTERN.test(input.lesson_id))) {
      throw new LearningStoreError('Resource lesson reference is invalid.', 400);
    }
    output.lesson_id = input.lesson_id as string | null;
  }
  if (partial && Object.keys(output).length === 0) throw new LearningStoreError('Provide at least one resource field to update.', 400);
  return output;
}

function slugFromTitle(title: string): string {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lesson';
}

export function institutionalEnrollmentRpcCall(moduleId: string, studentId: string) {
  return {
    name: 'enroll_in_institutional_module',
    args: {
      p_module_id: moduleId,
      p_target_student_id: studentId,
    },
  } as const;
}

export function deriveLearningProgress(lessons: Array<{ id: string; is_mandatory: boolean }>, completions: Array<{ lesson_id: string }>) {
  const completed = new Set(completions.map((row) => row.lesson_id));
  const required = lessons.some((lesson) => lesson.is_mandatory)
    ? lessons.filter((lesson) => lesson.is_mandatory)
    : lessons;
  const requiredDone = required.filter((lesson) => completed.has(lesson.id)).length;
  const percentage = required.length ? Math.round(requiredDone / required.length * 10000) / 100 : 0;
  return {
    status: required.length > 0 && requiredDone === required.length ? 'completed' : 'in_progress',
    completedLessonsCount: completed.size,
    totalLessonsCount: lessons.length,
    progressPercentage: percentage,
    completedLessonIds: [...completed],
    requiredLessonsCount: required.length,
    requiredLessonsCompleted: requiredDone,
  };
}

export class LearningStore {
  constructor(private readonly database: LearningDb | null = supabaseAdmin) {}

  private db() {
    if (!this.database) throw new Error('Backend database service is not configured.');
    return this.database;
  }

  async listMentorModules(actor: LearningActor) {
    if (actor.role !== 'mentor' && actor.role !== 'admin') {
      throw new LearningStoreError('Mentor or administrator access is required.', 403);
    }
    let query = this.db().from('learning_modules')
      .select('id, category_id, academic_term_id, created_by, code, version, title, description, semester, level, estimated_hours, week_number, skills, status, is_institutional, target_cohort_id, created_at, updated_at, learning_categories(id, code, name), academic_terms(id, code, name)')
      .order('updated_at', { ascending: false });
    if (actor.role === 'mentor') query = query.eq('created_by', actor.id);
    const { data, error } = await query;
    if (error) throw new Error(`Database error fetching learning modules: ${error.message}`);
    return data || [];
  }

  async getMentorModuleOptions(actor: LearningActor) {
    if (actor.role !== 'mentor' && actor.role !== 'admin') {
      throw new LearningStoreError('Mentor or administrator access is required.', 403);
    }
    const db = this.db();
    const [{ data: categories, error: categoryError }, { data: terms, error: termError }] = await Promise.all([
      db.from('learning_categories').select('id, code, name, display_order').order('display_order'),
      db.from('academic_terms').select('id, code, name, start_date, end_date, is_current').order('start_date', { ascending: false }),
    ]);
    if (categoryError) throw new Error(`Database error fetching learning categories: ${categoryError.message}`);
    if (termError) throw new Error(`Database error fetching academic terms: ${termError.message}`);
    return { categories: categories || [], academicTerms: terms || [] };
  }

  async createDraftModule(input: DraftLearningModuleInput, actor: LearningActor) {
    if (actor.role !== 'mentor' && actor.role !== 'admin') {
      throw new LearningStoreError('Mentor or administrator access is required.', 403);
    }
    if (!UUID_PATTERN.test(actor.id)) throw new LearningStoreError('Authenticated profile is invalid.', 403);

    const db = this.db();
    const [{ data: category, error: categoryError }, { data: term, error: termError }] = await Promise.all([
      db.from('learning_categories').select('id').eq('id', input.category_id).maybeSingle(),
      db.from('academic_terms').select('id').eq('id', input.academic_term_id).maybeSingle(),
    ]);
    if (categoryError) throw new Error(`Database error validating learning category: ${categoryError.message}`);
    if (termError) throw new Error(`Database error validating academic term: ${termError.message}`);
    if (!category) throw new LearningStoreError('The selected learning category does not exist.', 400);
    if (!term) throw new LearningStoreError('The selected academic term does not exist.', 400);

    const { data, error } = await db.from('learning_modules').insert({
      ...input,
      created_by: actor.id,
      status: 'draft',
    }).select('id, category_id, academic_term_id, created_by, code, version, title, description, semester, level, estimated_hours, week_number, skills, status, is_institutional, target_cohort_id, created_at, updated_at, learning_categories(id, code, name), academic_terms(id, code, name)').single();
    if (error?.code === '23505') throw new LearningStoreError('A module with this code and version already exists.', 409);
    if (error?.code === '23503') throw new LearningStoreError('The selected category or academic term is no longer available.', 400);
    if (error?.code === '23514') throw new LearningStoreError('Module values do not satisfy the learning schema constraints.', 400);
    if (error) throw new Error(`Database error creating learning module: ${error.message}`);
    return data;
  }

  async publishMentorModule(moduleId: string, actor: LearningActor) {
    const module = await this.mentorModule(moduleId, actor);
    if (module.status === 'published') throw new LearningStoreError('This module has already been published.', 409);
    if (module.status === 'archived') throw new LearningStoreError('Archived modules cannot be published.', 409);

    const db = this.db();
    const { count, error: countError } = await db.from('module_lessons')
      .select('id', { count: 'exact', head: true }).eq('module_id', moduleId);
    if (countError) throw new Error(`Database error validating module lessons: ${countError.message}`);
    if (!count) throw new LearningStoreError('Add at least one lesson before publishing this module.', 400);

    // The Phase 5A mutation trigger remains authoritative and performs the same
    // prerequisite check atomically with the lifecycle transition.
    const { data, error } = await db.from('learning_modules').update({ status: 'published' })
      .eq('id', moduleId).eq('status', 'draft')
      .select('id, category_id, academic_term_id, created_by, code, version, title, description, semester, level, estimated_hours, week_number, skills, status, is_institutional, target_cohort_id, created_at, updated_at, learning_categories(id, code, name), academic_terms(id, code, name)')
      .maybeSingle();
    if (error) {
      if (/Publication rejected:.*no lessons/i.test(error.message)) throw new LearningStoreError('Add at least one lesson before publishing this module.', 400);
      if (/Curriculum integrity violation|Invalid lifecycle transition/i.test(error.message)) throw new LearningStoreError(error.message, 409);
      if (error.code === 'P0001') throw new LearningStoreError(error.message || 'The database rejected module publication.', 400);
      throw new Error(`Database error publishing learning module: ${error.message}`);
    }
    if (!data) throw new LearningStoreError('This module is no longer a draft. Refresh the module and try again.', 409);
    return { module: data, publication: { status: data.status, publishedAt: null, updatedAt: data.updated_at } };
  }

  async eligibleModuleMentees(moduleId: string, actor: LearningActor) {
    const module = await this.assignmentModule(moduleId, actor);
    const db = this.db();
    const { data: term, error: termError } = await db.from('academic_terms').select('is_current').eq('id', module.academic_term_id).maybeSingle();
    if (termError) throw new Error(`Database error validating module academic term: ${termError.message}`);
    if (!term?.is_current) return [];
    let studentIds: string[];
    if (actor.role === 'admin') {
      const { data, error } = await db.from('profiles').select('id').eq('role', 'student').eq('is_active', true);
      if (error) throw new Error(`Database error fetching active students: ${error.message}`);
      studentIds = (data || []).map((row: Row) => row.id);
    } else {
      const { data, error } = await db.from('mentor_assignments').select('student_id')
        .eq('mentor_id', actor.id).eq('academic_term_id', module.academic_term_id).eq('is_active', true);
      if (error) throw new Error(`Database error fetching active mentees: ${error.message}`);
      studentIds = [...new Set((data || []).map((row: Row) => row.student_id))];
    }
    if (!studentIds.length) return [];
    const [{ data: profiles, error: profileError }, { data: details, error: detailsError }] = await Promise.all([
      db.from('profiles').select('id, name, email, is_active').in('id', studentIds).eq('role', 'student').eq('is_active', true),
      db.from('student_details').select('profile_id, roll_number, semester, cohort_id').in('profile_id', studentIds),
    ]);
    if (profileError) throw new Error(`Database error validating student profiles: ${profileError.message}`);
    if (detailsError) throw new Error(`Database error fetching student academic details: ${detailsError.message}`);
    const detailById = new Map((details || []).map((row: Row) => [row.profile_id, row]));
    return (profiles || []).flatMap((profile: Row) => {
      const detail = detailById.get(profile.id);
      if (!detail || detail.semester !== module.semester || (module.target_cohort_id && detail.cohort_id !== module.target_cohort_id)) return [];
      return [{ ...profile, student_details: detail }];
    });
  }

  private async assignmentModule(moduleId: string, actor: LearningActor) {
    if (actor.role !== 'mentor' && actor.role !== 'admin') throw new LearningStoreError('Mentor or administrator access is required.', 403);
    if (!UUID_PATTERN.test(moduleId)) throw new LearningStoreError('Module ID is invalid.', 400);
    const { data: module, error } = await this.db().from('learning_modules')
      .select('id, created_by, academic_term_id, semester, target_cohort_id, status').eq('id', moduleId).maybeSingle();
    if (error) throw new Error(`Database error verifying module access: ${error.message}`);
    if (!module) throw new LearningStoreError('Learning module not found.', 404);
    if (actor.role === 'mentor' && module.created_by !== actor.id) throw new LearningStoreError('You can only assign modules you created.', 403);
    if (module.status !== 'published') throw new LearningStoreError('Only published modules can be assigned.', 409);
    return module;
  }

  async listModuleAssignments(moduleId: string, actor: LearningActor) {
    await this.assignmentModule(moduleId, actor);
    const db = this.db();
    const { data: assignments, error } = await db.from('module_assignments').select('*').eq('module_id', moduleId).order('assigned_at', { ascending: false });
    if (error) throw new Error(`Database error fetching module assignments: ${error.message}`);
    const rows = assignments || [];
    if (!rows.length) return [];
    const ids = [...new Set(rows.map((row: Row) => row.student_id))];
    const [{ data: profiles, error: profileError }, { data: details, error: detailError }] = await Promise.all([
      db.from('profiles').select('id, name, email, is_active').in('id', ids),
      db.from('student_details').select('profile_id, roll_number, semester, cohort_id').in('profile_id', ids),
    ]);
    if (profileError) throw new Error(`Database error fetching assigned student profiles: ${profileError.message}`);
    if (detailError) throw new Error(`Database error fetching assigned student details: ${detailError.message}`);
    const profileById = new Map((profiles || []).map((row: Row) => [row.id, row]));
    const detailById = new Map((details || []).map((row: Row) => [row.profile_id, row]));
    return rows.map((row: Row) => ({ ...row, student: profileById.get(row.student_id) || null, student_details: detailById.get(row.student_id) || null }));
  }

  async createModuleAssignment(moduleId: string, studentId: string, actor: LearningActor) {
    const module = await this.assignmentModule(moduleId, actor);
    if (!UUID_PATTERN.test(studentId)) throw new LearningStoreError('Student ID is invalid.', 400);
    const db = this.db();
    const [{ data: profile, error: profileError }, { data: detail, error: detailError }, { data: term, error: termError }] = await Promise.all([
      db.from('profiles').select('id, role, is_active').eq('id', studentId).maybeSingle(),
      db.from('student_details').select('semester, cohort_id').eq('profile_id', studentId).maybeSingle(),
      db.from('academic_terms').select('id, is_current').eq('id', module.academic_term_id).maybeSingle(),
    ]);
    if (profileError) throw new Error(`Database error validating target student: ${profileError.message}`);
    if (detailError) throw new Error(`Database error validating student academic details: ${detailError.message}`);
    if (termError) throw new Error(`Database error validating module academic term: ${termError.message}`);
    if (!profile || profile.role !== 'student' || !profile.is_active) throw new LearningStoreError('The target student is not active.', 400);
    if (!detail) throw new LearningStoreError('Student academic details were not found.', 400);
    if (detail.semester !== module.semester) throw new LearningStoreError('Student semester does not match the module semester.', 400);
    if (module.target_cohort_id && detail.cohort_id !== module.target_cohort_id) throw new LearningStoreError('Student cohort does not match the module target cohort.', 400);
    if (!term) throw new LearningStoreError('The module academic term is no longer available.', 400);
    if (!term.is_current) throw new LearningStoreError('Modules can only be assigned in the current academic term.', 400);
    if (actor.role === 'mentor') {
      const { data: allocation, error } = await db.from('mentor_assignments').select('id')
        .eq('mentor_id', actor.id).eq('student_id', studentId).eq('academic_term_id', module.academic_term_id).eq('is_active', true).maybeSingle();
      if (error) throw new Error(`Database error validating mentor-student allocation: ${error.message}`);
      if (!allocation) throw new LearningStoreError('This student is not an active mentee in the module academic term.', 403);
    }
    const { data, error } = await db.from('module_assignments').insert({
      module_id: moduleId,
      academic_term_id: module.academic_term_id,
      mentor_id: actor.id,
      student_id: studentId,
      cohort_id: detail.cohort_id,
      status: 'assigned',
    }).select('*').single();
    if (error?.code === '23505') throw new LearningStoreError('This module is already assigned to that student.', 409);
    if (error?.code === 'P0001') throw new LearningStoreError(error.message, 400);
    if (error) throw new Error(`Database error creating module assignment: ${error.message}`);
    return data;
  }

  async enrollAssignedModule(moduleId: string, studentId: string) {
    if (!UUID_PATTERN.test(moduleId) || !UUID_PATTERN.test(studentId)) throw new LearningStoreError('Module or student ID is invalid.', 400);
    const { data: assignment, error: assignmentError } = await this.db().from('module_assignments').select('id')
      .eq('module_id', moduleId).eq('student_id', studentId).eq('status', 'assigned').maybeSingle();
    if (assignmentError) throw new Error(`Database error verifying module assignment: ${assignmentError.message}`);
    if (!assignment) throw new LearningStoreError('An active assignment for this module is required.', 403);
    const { data: enrollmentId, error } = await this.db().rpc('enroll_in_assigned_module', {
      p_module_id: moduleId,
      p_assignment_id: assignment.id,
      p_target_student_id: studentId,
    });
    if (error) {
      if (error.code === 'P0001') throw new LearningStoreError(error.message, 400);
      if (error.code === '23505') throw new LearningStoreError('An enrollment already exists for this module from another source.', 409);
      throw new Error(`Assigned enrollment failed: ${error.message}`);
    }
    const enrollment = await this.enrollment(moduleId, studentId);
    if (!enrollment || enrollment.id !== enrollmentId || enrollment.assignment_id !== assignment.id || enrollment.enrollment_type !== 'assigned') {
      throw new Error('Assigned enrollment could not be confirmed.');
    }
    return { enrollment, progress: await this.progress(moduleId, studentId, enrollment) };
  }

  private async mentorModule(moduleId: string, actor: LearningActor, draftOnly = false) {
    if (actor.role !== 'mentor' && actor.role !== 'admin') {
      throw new LearningStoreError('Mentor or administrator access is required.', 403);
    }
    if (!UUID_PATTERN.test(moduleId)) throw new LearningStoreError('Module ID is invalid.', 400);
    const { data: module, error } = await this.db().from('learning_modules')
      .select('id, created_by, status').eq('id', moduleId).maybeSingle();
    if (error) throw new Error(`Database error verifying module access: ${error.message}`);
    if (!module) throw new LearningStoreError('Learning module not found.', 404);
    if (actor.role === 'mentor' && module.created_by !== actor.id) {
      throw new LearningStoreError('You can only manage modules you created.', 403);
    }
    if (draftOnly && module.status !== 'draft') {
      throw new LearningStoreError('Lessons and resources can only be changed while the module is a draft.', 409);
    }
    return module;
  }

  private async lessonInModule(moduleId: string, lessonId: string) {
    if (!UUID_PATTERN.test(lessonId)) throw new LearningStoreError('Lesson ID is invalid.', 400);
    const { data, error } = await this.db().from('module_lessons').select('id, module_id')
      .eq('id', lessonId).eq('module_id', moduleId).maybeSingle();
    if (error) throw new Error(`Database error verifying lesson ownership: ${error.message}`);
    if (!data) throw new LearningStoreError('Lesson not found in this module.', 404);
    return data;
  }

  private async resourceInModule(moduleId: string, resourceId: string) {
    if (!UUID_PATTERN.test(resourceId)) throw new LearningStoreError('Resource ID is invalid.', 400);
    const { data, error } = await this.db().from('learning_resources').select('id, module_id')
      .eq('id', resourceId).eq('module_id', moduleId).maybeSingle();
    if (error) throw new Error(`Database error verifying resource ownership: ${error.message}`);
    if (!data) throw new LearningStoreError('Resource not found in this module.', 404);
    return data;
  }

  private async validateResourceLesson(moduleId: string, lessonId: string | null | undefined) {
    if (lessonId) await this.lessonInModule(moduleId, lessonId);
  }

  async listMentorLessons(moduleId: string, actor: LearningActor) {
    await this.mentorModule(moduleId, actor);
    const { data, error } = await this.db().from('module_lessons').select('*')
      .eq('module_id', moduleId).order('lesson_order');
    if (error) throw new Error(`Database error fetching module lessons: ${error.message}`);
    return data || [];
  }

  async createMentorLesson(moduleId: string, body: unknown, actor: LearningActor) {
    await this.mentorModule(moduleId, actor, true);
    const input = validateLessonInput(body);
    const { data: existing, error: listError } = await this.db().from('module_lessons')
      .select('lesson_order').eq('module_id', moduleId).order('lesson_order', { ascending: false });
    if (listError) throw new Error(`Database error determining lesson order: ${listError.message}`);
    const lessonOrder = (existing?.[0]?.lesson_order || 0) + 1;
    const { data, error } = await this.db().from('module_lessons').insert({
      ...input,
      module_id: moduleId,
      lesson_order: lessonOrder,
      slug: slugFromTitle(input.title!),
    }).select('*').single();
    if (error?.code === '23505') throw new LearningStoreError('Lesson order changed. Refresh the module and try again.', 409);
    if (error?.code === '23514') throw new LearningStoreError('Lesson values do not satisfy the learning schema constraints.', 400);
    if (error) throw new Error(`Database error creating lesson: ${error.message}`);
    return data;
  }

  async updateMentorLesson(moduleId: string, lessonId: string, body: unknown, actor: LearningActor) {
    await this.mentorModule(moduleId, actor, true);
    await this.lessonInModule(moduleId, lessonId);
    const input = validateLessonInput(body, true);
    const updates: Row = { ...input };
    if (input.title) updates.slug = slugFromTitle(input.title);
    const { data, error } = await this.db().from('module_lessons').update(updates)
      .eq('id', lessonId).eq('module_id', moduleId).select('*').single();
    if (error?.code === '23514') throw new LearningStoreError('Lesson values do not satisfy the learning schema constraints.', 400);
    if (error) throw new Error(`Database error updating lesson: ${error.message}`);
    return data;
  }

  async deleteMentorLesson(moduleId: string, lessonId: string, actor: LearningActor) {
    await this.mentorModule(moduleId, actor, true);
    await this.lessonInModule(moduleId, lessonId);
    const { error } = await this.db().from('module_lessons').delete()
      .eq('id', lessonId).eq('module_id', moduleId);
    if (error) throw new Error(`Database error deleting lesson: ${error.message}`);
    return { deleted: true };
  }

  private async setLessonOrder(moduleId: string, lessonId: string, lessonOrder: number) {
    const { error } = await this.db().from('module_lessons').update({ lesson_order: lessonOrder })
      .eq('id', lessonId).eq('module_id', moduleId);
    if (error) throw error;
  }

  async reorderMentorLessons(moduleId: string, lessonIds: unknown, actor: LearningActor) {
    await this.mentorModule(moduleId, actor, true);
    if (!Array.isArray(lessonIds) || lessonIds.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id)) ||
      new Set(lessonIds).size !== lessonIds.length) {
      throw new LearningStoreError('Provide a unique ordered list of lesson IDs.', 400);
    }
    const lessons = await this.listMentorLessons(moduleId, actor);
    if (lessonIds.length !== lessons.length || lessons.some((lesson: Row) => !lessonIds.includes(lesson.id))) {
      throw new LearningStoreError('The lesson order must include every lesson in this module exactly once.', 400);
    }
    if (lessons.every((lesson: Row, index: number) => lesson.id === lessonIds[index])) return lessons;

    const original = lessons.map((lesson: Row) => ({ id: lesson.id, lesson_order: lesson.lesson_order }));
    const maxOrder = Math.max(0, ...original.map((lesson) => lesson.lesson_order));
    const temporaryBase = maxOrder + lessons.length + 1;
    try {
      for (let index = 0; index < lessons.length; index++) {
        await this.setLessonOrder(moduleId, lessons[index].id, temporaryBase + index);
      }
      for (let index = 0; index < lessonIds.length; index++) {
        await this.setLessonOrder(moduleId, lessonIds[index], index + 1);
      }
    } catch (error) {
      try {
        const { data: current, error: readError } = await this.db().from('module_lessons').select('id, lesson_order')
          .eq('module_id', moduleId).order('lesson_order');
        if (readError) throw readError;
        const recoveryBase = Math.max(temporaryBase, ...(current || []).map((lesson: Row) => lesson.lesson_order || 0)) + lessons.length + 1;
        for (let index = 0; index < (current || []).length; index++) {
          await this.setLessonOrder(moduleId, current[index].id, recoveryBase + index);
        }
        for (const lesson of original) await this.setLessonOrder(moduleId, lesson.id, lesson.lesson_order);
      } catch (recoveryError) {
        console.error('[LearningStore] Lesson order recovery failed. Manual review may be required.', recoveryError);
      }
      if ((error as Row)?.code === '23505') throw new LearningStoreError('Lesson order changed concurrently. Refresh and try again.', 409);
      throw new Error('Database error reordering lessons.');
    }
    return this.listMentorLessons(moduleId, actor);
  }

  async listMentorResources(moduleId: string, actor: LearningActor) {
    await this.mentorModule(moduleId, actor);
    const { data, error } = await this.db().from('learning_resources').select('*')
      .eq('module_id', moduleId).order('created_at');
    if (error) throw new Error(`Database error fetching module resources: ${error.message}`);
    return data || [];
  }

  async createMentorResource(moduleId: string, body: unknown, actor: LearningActor) {
    await this.mentorModule(moduleId, actor, true);
    const input = validateResourceInput(body);
    await this.validateResourceLesson(moduleId, input.lesson_id);
    const { data, error } = await this.db().from('learning_resources').insert({
      ...input,
      module_id: moduleId,
    }).select('*').single();
    if (error?.code === '23503') throw new LearningStoreError('The selected lesson does not belong to this module.', 400);
    if (error?.code === '23514') throw new LearningStoreError('Resource values do not satisfy the learning schema constraints.', 400);
    if (error) throw new Error(`Database error creating resource: ${error.message}`);
    return data;
  }

  async updateMentorResource(moduleId: string, resourceId: string, body: unknown, actor: LearningActor) {
    await this.mentorModule(moduleId, actor, true);
    await this.resourceInModule(moduleId, resourceId);
    const input = validateResourceInput(body, true);
    if (input.lesson_id !== undefined) await this.validateResourceLesson(moduleId, input.lesson_id);
    const { data, error } = await this.db().from('learning_resources').update(input)
      .eq('id', resourceId).eq('module_id', moduleId).select('*').single();
    if (error?.code === '23503') throw new LearningStoreError('The selected lesson does not belong to this module.', 400);
    if (error?.code === '23514') throw new LearningStoreError('Resource values do not satisfy the learning schema constraints.', 400);
    if (error) throw new Error(`Database error updating resource: ${error.message}`);
    return data;
  }

  async deleteMentorResource(moduleId: string, resourceId: string, actor: LearningActor) {
    await this.mentorModule(moduleId, actor, true);
    await this.resourceInModule(moduleId, resourceId);
    const { error } = await this.db().from('learning_resources').delete()
      .eq('id', resourceId).eq('module_id', moduleId);
    if (error) throw new Error(`Database error deleting resource: ${error.message}`);
    return { deleted: true };
  }

  private async enrollment(moduleId: string, studentId: string) {
    const { data, error } = await this.db().from('student_module_enrollments').select('*')
      .eq('module_id', moduleId).eq('student_id', studentId).maybeSingle();
    if (error) throw new Error(`Database error fetching enrollment: ${error.message}`);
    return data;
  }

  private async eligibility(module: Row, studentId: string) {
    const db = this.db();
    const [{ data: assignment, error: assignmentError }, { data: details, error: detailsError }, { data: term, error: termError }] = await Promise.all([
      db.from('module_assignments').select('*')
      .eq('module_id', module.id).eq('student_id', studentId).eq('status', 'assigned').maybeSingle(),
      db.from('student_details').select('semester, cohort_id').eq('profile_id', studentId).maybeSingle(),
      db.from('academic_terms').select('is_current').eq('id', module.academic_term_id).maybeSingle(),
    ]);
    if (assignmentError) throw new Error(`Database error checking module assignment: ${assignmentError.message}`);
    if (detailsError) throw new Error(`Database error checking student eligibility: ${detailsError.message}`);
    if (termError) throw new Error(`Database error checking academic term: ${termError.message}`);
    const studentMatches = Boolean(details && term?.is_current && details.semester === module.semester &&
      (!module.target_cohort_id || details.cohort_id === module.target_cohort_id));
    return { assignment, eligible: studentMatches && (Boolean(assignment) || Boolean(module.is_institutional)) };
  }

  private async progress(moduleId: string, studentId: string, enrollment: Row) {
    const db = this.db();
    const [{ data: lessons, error: lessonsError }, { data: completions, error: completionsError }] = await Promise.all([
      db.from('module_lessons').select('id, lesson_order, title, is_mandatory').eq('module_id', moduleId).order('lesson_order'),
      db.from('lesson_completions').select('lesson_id, completed_at').eq('module_id', moduleId).eq('student_id', studentId).eq('enrollment_id', enrollment.id),
    ]);
    if (lessonsError) throw new Error(`Database error fetching lessons: ${lessonsError.message}`);
    if (completionsError) throw new Error(`Database error fetching lesson completions: ${completionsError.message}`);
    const lessonRows = lessons || [];
    return {
      ...deriveLearningProgress(lessonRows, completions || []),
      completedLessons: completions || [],
    };
  }

  async listModules(studentId: string) {
    const db = this.db();
    const { data: modules, error } = await db.from('learning_modules')
      .select('*, learning_categories(id, code, name, description, display_order)')
      .eq('status', 'published').order('created_at', { ascending: false });
    if (error) throw new Error(`Database error fetching learning modules: ${error.message}`);
    const output = [];
    for (const module of modules || []) {
      const enrollment = await this.enrollment(module.id, studentId);
      const eligibility = await this.eligibility(module, studentId);
      if (!enrollment && !eligibility.eligible) continue;
      const { count, error: countError } = await db.from('module_lessons').select('id', { count: 'exact', head: true }).eq('module_id', module.id);
      if (countError) throw new Error(`Database error counting module lessons: ${countError.message}`);
      const completion = enrollment ? await this.progress(module.id, studentId, enrollment) : null;
      const assignment = enrollment?.assignment_id
        ? (await db.from('module_assignments').select('*').eq('id', enrollment.assignment_id).maybeSingle()).data
        : eligibility.assignment;
      output.push({ ...module, assignment: assignment || null, access_type: enrollment?.enrollment_type || (assignment ? 'assigned' : 'institutional_common'), lessonCount: count || 0, enrollment: enrollment ? { ...enrollment, status: completion?.status } : null, progress: completion });
    }
    return output;
  }

  async getModule(moduleId: string, studentId: string) {
    const db = this.db();
    const { data: module, error } = await db.from('learning_modules')
      .select('*, learning_categories(id, code, name, description, display_order)')
      .eq('id', moduleId).eq('status', 'published').maybeSingle();
    if (error) throw new Error(`Database error fetching learning module: ${error.message}`);
    if (!module) return null;
    const enrollment = await this.enrollment(moduleId, studentId);
    const eligibility = await this.eligibility(module, studentId);
    if (!enrollment && !eligibility.eligible) return null;
    const [{ data: lessons, error: lessonError }, { data: resources, error: resourceError }] = await Promise.all([
      db.from('module_lessons').select('*').eq('module_id', moduleId).order('lesson_order'),
      db.from('learning_resources').select('*').eq('module_id', moduleId).order('created_at'),
    ]);
    if (lessonError) throw new Error(`Database error fetching module lessons: ${lessonError.message}`);
    if (resourceError) throw new Error(`Database error fetching learning resources: ${resourceError.message}`);
    const progress = enrollment ? await this.progress(moduleId, studentId, enrollment) : null;
    return {
      module: { ...module, assignment: enrollment?.assignment_id
        ? (await db.from('module_assignments').select('*').eq('id', enrollment.assignment_id).maybeSingle()).data || null
        : eligibility.assignment || null,
        access_type: enrollment?.enrollment_type || (eligibility.assignment ? 'assigned' : 'institutional_common') },
      lessons: (lessons || []).map((lesson) => ({
        ...lesson,
        isCompleted: Boolean(progress?.completedLessonIds.includes(lesson.id)),
        resources: (resources || []).filter((resource) => resource.lesson_id === lesson.id),
      })),
      resources: (resources || []).filter((resource) => !resource.lesson_id),
      enrollment: enrollment ? { ...enrollment, status: progress?.status } : null,
      progress,
      canEnroll: !enrollment && module.is_institutional && eligibility.eligible && !eligibility.assignment,
      canAssignedEnroll: !enrollment && Boolean(eligibility.assignment),
      assignment: eligibility.assignment,
    };
  }

  async enroll(moduleId: string, studentId: string) {
    const current = await this.enrollment(moduleId, studentId);
    if (current) {
      const detail = await this.getModule(moduleId, studentId);
      if (!detail) return null;
      return { enrollment: current, progress: detail.progress };
    }
    const detail = await this.getModule(moduleId, studentId);
    if (!detail || !detail.canEnroll) return null;
    const rpcCall = institutionalEnrollmentRpcCall(moduleId, studentId);
    const { data: enrollmentId, error } = await this.db().rpc(rpcCall.name, rpcCall.args);
    if (error) throw new Error(`Enrollment failed: ${error.message}`);
    const enrollment = await this.enrollment(moduleId, studentId);
    if (!enrollment || enrollment.id !== enrollmentId) throw new Error('Enrollment could not be confirmed.');
    return { enrollment, progress: await this.progress(moduleId, studentId, enrollment) };
  }

  async getProgress(moduleId: string, studentId: string) {
    const detail = await this.getModule(moduleId, studentId);
    if (!detail) return null;
    if (!detail.enrollment) return { enrolled: false, progress: null };
    return { enrolled: true, progress: detail.progress };
  }

  async completeLesson(moduleId: string, lessonId: string, studentId: string) {
    const detail = await this.getModule(moduleId, studentId);
    if (!detail || !detail.enrollment || !detail.lessons.some((lesson: Row) => lesson.id === lessonId)) return null;
    const { data, error } = await this.db().rpc('complete_module_lesson', {
      p_module_id: moduleId,
      p_lesson_id: lessonId,
      p_student_id: studentId,
    });
    if (error) throw new Error(`Failed to record lesson completion: ${error.message}`);
    const enrollment = await this.enrollment(moduleId, studentId);
    if (!enrollment) throw new Error('Enrollment could not be confirmed after lesson completion.');
    return { completion: data, progress: await this.progress(moduleId, studentId, enrollment) };
  }
}

export const learningStore = new LearningStore();

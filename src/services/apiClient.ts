import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type {
  PerformanceMetricSummary,
  StudentCounts,
  AssessmentHistoryItem,
  TopicAnalyticsItem,
  TrendDataPoint,
  AtRiskStudentItem,
  MentorOverviewMetrics,
  AdminTopicAnalyticsItem,
  MenteePerformanceListItem,
} from '../types/analytics';
import type { AttemptReviewResponse, AttemptAiFeedback } from '../types/assessment';

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  status: number;
}

export type { AttemptReviewResponse, AttemptAiFeedback };

export interface LearningModuleSummary {
  id: string; code: string; version: number; title: string; description: string | null;
  semester: number; level: string; estimated_hours: number; week_number: number | null;
  skills: string[]; is_institutional: boolean; learning_categories: { id: string; code: string; name: string };
  lessonCount: number; enrollment: any | null; progress: any | null;
  assignment?: { id: string; status: 'assigned' | 'revoked' | 'completed'; due_date: string | null; assigned_at: string } | null;
  access_type?: 'assigned' | 'institutional_common';
}

export interface MentorLearningModule {
  id: string;
  category_id: string;
  academic_term_id: string;
  created_by: string;
  code: string;
  version: number;
  title: string;
  description: string | null;
  semester: number;
  level: 'Fundamental' | 'Intermediate' | 'Advanced';
  estimated_hours: number;
  week_number: number | null;
  skills: string[];
  status: 'draft' | 'published' | 'archived';
  is_institutional: boolean;
  target_cohort_id: string | null;
  created_at: string;
  updated_at: string;
  learning_categories: { id: string; code: string; name: string } | null;
  academic_terms: { id: string; code: string; name: string } | null;
}

export interface MentorModuleOptions {
  categories: Array<{ id: string; code: string; name: string; display_order: number }>;
  academicTerms: Array<{
    id: string;
    code: string;
    name: string;
    start_date: string;
    end_date: string;
    is_current: boolean;
  }>;
}

export interface AssessmentSourceDocument {
  id: string; assessmentId: string; moduleId: string; filename: string; mimeType: string; sizeBytes: number;
  extractionStatus: 'pending' | 'processing' | 'ready' | 'failed' | 'rejected'; extractionErrorCode?: string | null;
  unitCount?: number; characterCount?: number; rangeKind?: 'page' | 'slide' | 'paragraph' | 'line';
  availableRanges?: number[]; extractedUnits?: Array<{ number: number; text: string }>;
  uploadedAt: string; extractedAt?: string | null;
}

export type AssessmentGenerationPayload = {
  assessmentId: string; moduleId: string; idempotencyKey: string;
  documents: Array<{ documentId: string; ranges: Array<{ start: number; end: number }> }>;
  questionCounts: { mcq: number; multiple_select: number; true_false: number };
  difficultyDistribution: { easy: number; medium: number; hard: number };
  cognitiveLevels: Array<'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create'>;
  topicCoverage: string[]; additionalInstructions?: string;
};

export interface CreateDraftLearningModuleInput {
  category_id: string;
  academic_term_id: string;
  code: string;
  title: string;
  semester: number;
  level: 'Fundamental' | 'Intermediate' | 'Advanced';
  description?: string;
}

export type LearningLessonType = 'theory' | 'code_lab' | 'case_study' | 'milestone_prep';
export type LearningResourceType = 'pdf' | 'article_url' | 'github_repo' | 'doc' | 'book_reference';

export interface MentorLearningLesson {
  id: string;
  module_id: string;
  lesson_order: number;
  title: string;
  slug: string;
  summary: string | null;
  content_markdown: string;
  lesson_type: LearningLessonType;
  estimated_minutes: number;
  is_mandatory: boolean;
  code_snippet: string | null;
  code_language: string | null;
  created_at: string;
  updated_at: string;
}

export interface MentorLearningResource {
  id: string;
  module_id: string;
  lesson_id: string | null;
  title: string;
  resource_type: LearningResourceType;
  url: string;
  description: string | null;
  is_mandatory: boolean;
  created_at: string;
  updated_at: string;
}

export interface MentorLearningLessonInput {
  title: string;
  summary?: string | null;
  content_markdown: string;
  lesson_type?: LearningLessonType;
  estimated_minutes?: number;
  is_mandatory?: boolean;
  code_snippet?: string | null;
  code_language?: string | null;
}

export interface MentorLearningResourceInput {
  title: string;
  resource_type: LearningResourceType;
  url: string;
  description?: string | null;
  is_mandatory?: boolean;
  lesson_id?: string | null;
}

async function getAuthHeader(): Promise<Record<string, string>> {
  if (!isSupabaseConfigured()) {
    return {};
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return {};
  return {
    Authorization: `Bearer ${token}`,
  };
}

export const apiClient = {
  async getMentorLearningModules() {
    return this.request<{ modules: MentorLearningModule[] }>('/api/learning/mentor/modules');
  },

  async getMentorModuleOptions() {
    return this.request<MentorModuleOptions>('/api/learning/mentor/module-options');
  },

  async createMentorLearningModule(payload: CreateDraftLearningModuleInput) {
    return this.request<{ module: MentorLearningModule }>('/api/learning/mentor/modules', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async publishMentorLearningModule(moduleId: string) {
    return this.request<{ message: string; module: MentorLearningModule; publication: { status: 'published'; publishedAt: string | null; updatedAt: string } }>(`/api/learning/mentor/modules/${encodeURIComponent(moduleId)}/publish`, {
      method: 'POST',
    });
  },

  async getEligibleLearningMentees(moduleId: string) {
    return this.request<{ students: Array<{ id: string; name: string; email: string; student_details: { roll_number: string; semester: number; cohort_id: string | null } }> }>(`/api/learning/mentor/modules/${encodeURIComponent(moduleId)}/mentees`);
  },

  async getMentorModuleAssignments(moduleId: string) {
    return this.request<{ assignments: Array<Record<string, any>> }>(`/api/learning/mentor/modules/${encodeURIComponent(moduleId)}/assignments`);
  },

  async createMentorModuleAssignment(moduleId: string, studentId: string) {
    return this.request<{ assignment: Record<string, any> }>(`/api/learning/mentor/modules/${encodeURIComponent(moduleId)}/assignments`, {
      method: 'POST', body: JSON.stringify({ student_id: studentId }),
    });
  },

  async getMentorModuleLessons(moduleId: string) {
    return this.request<{ lessons: MentorLearningLesson[] }>(`/api/learning/mentor/modules/${encodeURIComponent(moduleId)}/lessons`);
  },

  async createMentorModuleLesson(moduleId: string, payload: MentorLearningLessonInput) {
    return this.request<{ lesson: MentorLearningLesson }>(`/api/learning/mentor/modules/${encodeURIComponent(moduleId)}/lessons`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateMentorModuleLesson(moduleId: string, lessonId: string, payload: Partial<MentorLearningLessonInput>) {
    return this.request<{ lesson: MentorLearningLesson }>(`/api/learning/mentor/modules/${encodeURIComponent(moduleId)}/lessons/${encodeURIComponent(lessonId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async deleteMentorModuleLesson(moduleId: string, lessonId: string) {
    return this.request<{ deleted: boolean }>(`/api/learning/mentor/modules/${encodeURIComponent(moduleId)}/lessons/${encodeURIComponent(lessonId)}`, {
      method: 'DELETE',
    });
  },

  async reorderMentorModuleLessons(moduleId: string, lessonIds: string[]) {
    return this.request<{ lessons: MentorLearningLesson[] }>(`/api/learning/mentor/modules/${encodeURIComponent(moduleId)}/lessons/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ lessonIds }),
    });
  },

  async getMentorModuleResources(moduleId: string) {
    return this.request<{ resources: MentorLearningResource[] }>(`/api/learning/mentor/modules/${encodeURIComponent(moduleId)}/resources`);
  },

  async createMentorModuleResource(moduleId: string, payload: MentorLearningResourceInput) {
    return this.request<{ resource: MentorLearningResource }>(`/api/learning/mentor/modules/${encodeURIComponent(moduleId)}/resources`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateMentorModuleResource(moduleId: string, resourceId: string, payload: Partial<MentorLearningResourceInput>) {
    return this.request<{ resource: MentorLearningResource }>(`/api/learning/mentor/modules/${encodeURIComponent(moduleId)}/resources/${encodeURIComponent(resourceId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async deleteMentorModuleResource(moduleId: string, resourceId: string) {
    return this.request<{ deleted: boolean }>(`/api/learning/mentor/modules/${encodeURIComponent(moduleId)}/resources/${encodeURIComponent(resourceId)}`, {
      method: 'DELETE',
    });
  },

  async getStudentLearningModules() {
    return this.request<{ modules: LearningModuleSummary[] }>('/api/learning/student/modules');
  },

  async getStudentLearningModule(moduleId: string) {
    return this.request<any>(`/api/learning/student/modules/${encodeURIComponent(moduleId)}`);
  },

  async enrollStudentLearningModule(moduleId: string) {
    return this.request<any>(`/api/learning/student/modules/${encodeURIComponent(moduleId)}/enroll`, { method: 'POST' });
  },

  async enrollStudentAssignedLearningModule(moduleId: string) {
    return this.request<any>(`/api/learning/student/modules/${encodeURIComponent(moduleId)}/assigned-enroll`, { method: 'POST' });
  },

  async getStudentLearningProgress(moduleId: string) {
    return this.request<any>(`/api/learning/student/modules/${encodeURIComponent(moduleId)}/progress`);
  },

  async completeStudentLearningLesson(moduleId: string, lessonId: string) {
    return this.request<any>(
      `/api/learning/student/modules/${encodeURIComponent(moduleId)}/lessons/${encodeURIComponent(lessonId)}/complete`,
      { method: 'POST' }
    );
  },

  // Backend Express API Health check
  async checkHealth(): Promise<{ status: string; phase?: string; database?: string; uptime?: number }> {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error('Backend server responded with non-200');
      return await res.json();
    } catch {
      return { status: 'backend_offline', uptime: 0 };
    }
  },

  isDatabaseConfigured(): boolean {
    return isSupabaseConfigured();
  },

  async getAuthSession() {
    if (!isSupabaseConfigured()) {
      return { session: null, error: new Error('Supabase client not configured') };
    }
    const { data, error } = await supabase.auth.getSession();
    return { session: data.session, error };
  },

  // Authenticated generic request method
  async request<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ data: T | null; error: string | null; status: number }> {
    try {
      const authHeaders = await getAuthHeader();
      const headers = {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...(options.headers || {}),
      };

      const response = await fetch(endpoint, {
        ...options,
        headers,
      });

      const contentType = response.headers.get('content-type');
      let payload: any = null;
      if (contentType && contentType.includes('application/json')) {
        payload = await response.json();
      } else {
        payload = await response.text();
      }

      if (!response.ok) {
        return {
          data: null,
          error: payload?.error || payload?.message || `Request failed with status ${response.status}`,
          status: response.status,
        };
      }

      return {
        data: payload,
        error: null,
        status: response.status,
      };
    } catch (err: unknown) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'Network error or backend unreachable.',
        status: 0,
      };
    }
  },

  // ==========================================
  // Administrative API Methods
  // ==========================================
  async getAdminStats() {
    return this.request<any>('/api/admin/stats');
  },

  async getStudents(params: Record<string, string | number> = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        query.append(key, String(val));
      }
    });
    const qs = query.toString();
    return this.request<any>(`/api/admin/students${qs ? `?${qs}` : ''}`);
  },

  async createStudent(payload: {
    name: string;
    email: string;
    rollNumber: string;
    branch?: string;
    semester?: number;
    division?: string;
    admissionYear?: number;
    cohortId?: string | null;
  }) {
    return this.request<any>('/api/admin/students', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateStudent(id: string, payload: Record<string, any>) {
    return this.request<any>(`/api/admin/students/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async setUserStatus(id: string, isActive: boolean) {
    return this.request<any>(`/api/admin/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
  },

  async reinviteUser(id: string) {
    return this.request<any>(`/api/admin/users/${id}/reinvite`, {
      method: 'POST',
    });
  },

  async getMentors(params: Record<string, string> = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val) query.append(key, val);
    });
    const qs = query.toString();
    return this.request<any>(`/api/admin/mentors${qs ? `?${qs}` : ''}`);
  },

  async createMentor(payload: {
    name: string;
    email: string;
    employeeId: string;
    department?: string;
    designation?: string;
    officeLocation?: string;
    officeHours?: string;
    specializations?: string[];
  }) {
    return this.request<any>('/api/admin/mentors', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateMentor(id: string, payload: Record<string, any>) {
    return this.request<any>(`/api/admin/mentors/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async getAcademicTerms() {
    return this.request<any>('/api/admin/academic/terms');
  },

  async createAcademicTerm(payload: {
    code: string;
    name: string;
    startDate: string;
    endDate: string;
    isCurrent?: boolean;
  }) {
    return this.request<any>('/api/admin/academic/terms', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async setCurrentAcademicTerm(id: string) {
    return this.request<any>(`/api/admin/academic/terms/${id}/current`, {
      method: 'PATCH',
    });
  },

  async getCohorts() {
    return this.request<any>('/api/admin/academic/cohorts');
  },

  async createCohort(payload: {
    code: string;
    name: string;
    department?: string;
    admissionYear: number;
    graduationYear: number;
  }) {
    return this.request<any>('/api/admin/academic/cohorts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getAllocations(termId?: string) {
    const qs = termId ? `?termId=${termId}` : '';
    return this.request<any>(`/api/admin/allocations${qs}`);
  },

  async assignStudents(payload: {
    studentIds: string[];
    mentorId: string;
    academicTermId: string;
    notes?: string;
  }) {
    return this.request<any>('/api/admin/allocations/assign', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async reassignMentor(payload: {
    studentId: string;
    newMentorId: string;
    academicTermId: string;
    notes?: string;
  }) {
    return this.request<any>('/api/admin/allocations/reassign', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async deleteAllocation(id: string) {
    return this.request<any>(`/api/admin/allocations/${id}`, {
      method: 'DELETE',
    });
  },

  // ============================================================================
  // Weekly Assessment Engine (Phase 3B)
  // ============================================================================

  // Mentor: Assessments & Rubric Management
  async getMentorAssessments() {
    return this.request<{
      assessments: any[];
      stats: {
        totalCreated: number;
        published: number;
        draft: number;
        completed: number;
        pendingSubmissions: number;
      };
    }>('/api/assessments/mentor');
  },

  async getMentorAssessmentReport(id: string) {
    return this.request<{ report: any }>(`/api/assessments/${id}/report`);
  },

  async linkAssessmentToModule(assessmentId: string, moduleId: string) {
    return this.request<{ message: string }>(`/api/assessments/${encodeURIComponent(assessmentId)}/modules/${encodeURIComponent(moduleId)}`, { method: 'POST' });
  },

  async getAssessmentSourceDocuments(assessmentId: string, moduleId: string) {
    return this.request<{ documents: AssessmentSourceDocument[] }>(`/api/assessments/${encodeURIComponent(assessmentId)}/modules/${encodeURIComponent(moduleId)}/source-documents`);
  },

  async getAssessmentSourceDocument(assessmentId: string, moduleId: string, documentId: string) {
    return this.request<{ document: AssessmentSourceDocument }>(`/api/assessments/${encodeURIComponent(assessmentId)}/modules/${encodeURIComponent(moduleId)}/source-documents/${encodeURIComponent(documentId)}`);
  },

  async uploadAssessmentSourceDocument(assessmentId: string, moduleId: string, file: File, mimeType: string) {
    return this.request<{ document: AssessmentSourceDocument }>(`/api/assessments/${encodeURIComponent(assessmentId)}/modules/${encodeURIComponent(moduleId)}/source-documents`, {
      method: 'POST', body: file,
      headers: { 'Content-Type': 'application/octet-stream', 'x-file-name': file.name, 'x-file-mime': mimeType },
    });
  },

  async retryAssessmentSourceExtraction(assessmentId: string, moduleId: string, documentId: string) {
    return this.request<{ document: AssessmentSourceDocument }>(`/api/assessments/${encodeURIComponent(assessmentId)}/modules/${encodeURIComponent(moduleId)}/source-documents/${encodeURIComponent(documentId)}/retry-extraction`, { method: 'POST' });
  },

  async deleteAssessmentSourceDocument(assessmentId: string, moduleId: string, documentId: string) {
    return this.request<{ message: string }>(`/api/assessments/${encodeURIComponent(assessmentId)}/modules/${encodeURIComponent(moduleId)}/source-documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
  },

  async generateAssessmentQuestions(assessmentId: string, moduleId: string, payload: AssessmentGenerationPayload) {
    return this.request<{ generation: { jobId: string; status: string }; questions: any[] }>(`/api/assessments/${encodeURIComponent(assessmentId)}/modules/${encodeURIComponent(moduleId)}/generate-questions`, { method: 'POST', body: JSON.stringify(payload) });
  },

  async createAssessment(payload: {
    title: string;
    description?: string;
    subject: string;
    topic: string;
    academicTermId?: string;
    durationMinutes: number;
    totalMarks?: number;
    passingMarks?: number;
    startTime: string;
    endTime: string;
    allowedAttempts?: number;
    assignedStudentIds?: string[];
    assignedCohortId?: string | null;
    originModuleId?: string | null;
  }) {
    return this.request<{ message: string; assessment: any }>('/api/assessments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getAssessment(id: string) {
    return this.request<{ assessment: any }>(`/api/assessments/${id}`);
  },

  async getAssessmentReviewQuestions(id: string) {
    return this.request<{questions:any[];assessment:any;module:any}>(`/api/assessments/${id}/review/questions`);
  },
  async approveAssessmentQuestion(assessmentId:string,questionId:string) {
    return this.request<{message:string}>(`/api/assessments/${assessmentId}/questions/${questionId}/approve`,{method:'POST'});
  },
  async rejectAssessmentQuestion(assessmentId:string,questionId:string,reason?:string) {
    return this.request<{message:string}>(`/api/assessments/${assessmentId}/questions/${questionId}/reject`,{method:'POST',body:JSON.stringify({reason})});
  },
  async getAssessmentQuestionHistory(assessmentId:string,questionId:string) {
    return this.request<{history:any[]}>(`/api/assessments/${assessmentId}/questions/${questionId}/history`);
  },
  async regenerateAssessmentQuestion(assessmentId:string,questionId:string,idempotencyKey:string) {
    return this.request<{message:string;question:any}>(`/api/assessments/${assessmentId}/questions/${questionId}/regenerate`,{method:'POST',body:JSON.stringify({idempotencyKey})});
  },

  async updateAssessment(id: string, payload: any) {
    return this.request<{ message: string; assessment: any }>(`/api/assessments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async deleteAssessment(id: string) {
    return this.request<{ message: string }>(`/api/assessments/${id}`, {
      method: 'DELETE',
    });
  },

  async publishAssessment(id: string) {
    return this.request<{ message: string; assessment: any }>(`/api/assessments/${id}/publish`, {
      method: 'POST',
    });
  },

  async getAssessmentReadiness(id: string) {
    return this.request<{ ready: boolean; totalMarks: number; issues: Array<{ code: string; message: string; questionOrder?: number }> }>(`/api/assessments/${id}/readiness`);
  },

  async archiveAssessment(id: string) {
    return this.request<{ message: string; assessment: any }>(`/api/assessments/${id}/archive`, { method: 'POST' });
  },

  async addAssessmentQuestion(assessmentId: string, payload: {
    questionType: 'mcq' | 'multiple_select' | 'true_false' | 'descriptive';
    questionText: string;
    marks: number;
    options?: Array<{ optionText: string; isCorrect: boolean }>;
    evaluationGuidance?: string;
    explanation?: string;
  }) {
    return this.request<{ message: string; question: any }>(`/api/assessments/${assessmentId}/questions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateAssessmentQuestion(assessmentId: string, questionId: string, payload: any) {
    return this.request<{ message: string; question: any }>(
      `/api/assessments/${assessmentId}/questions/${questionId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    );
  },

  async deleteAssessmentQuestion(assessmentId: string, questionId: string) {
    return this.request<{ message: string }>(
      `/api/assessments/${assessmentId}/questions/${questionId}`,
      {
        method: 'DELETE',
      }
    );
  },

  async reorderAssessmentQuestions(assessmentId: string, orderedQuestionIds: string[]) {
    return this.request<{ message: string }>(`/api/assessments/${assessmentId}/questions/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ orderedQuestionIds }),
    });
  },

  async getAssessmentSubmissions(assessmentId: string) {
    return this.request<{ submissions: any[]; assessmentTitle: string; totalMarks: number }>(
      `/api/assessments/${assessmentId}/submissions`
    );
  },

  async getSubmissionDetail(attemptId: string) {
    return this.request<{
      attempt: any;
      assessment: any;
      questions: any[];
      answers: any[];
    }>(`/api/assessments/submissions/${attemptId}`);
  },

  async evaluateSubmission(
    attemptId: string,
    payload: {
      evaluations: Array<{ questionId: string; marksObtained: number; mentorFeedback?: string }>;
      generalFeedback?: string;
    }
  ) {
    return this.request<{ message: string; attempt: any }>(
      `/api/assessments/submissions/${attemptId}/evaluate`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  },

  async publishAssessmentResults(assessmentId: string) {
    return this.request<{ message: string; assessment: any }>(
      `/api/assessments/${assessmentId}/publish-results`,
      {
        method: 'POST',
      }
    );
  },

  // Student: Assessment Portal & Testing Engine
  async getStudentAssessments() {
    return this.request<{ assessments: any[] }>('/api/assessments/student');
  },

  async startAssessmentAttempt(assessmentId: string) {
    return this.request<{
      attempt: any;
      assessment: any;
      questions: any[];
      answers: any[];
      remainingSeconds: number;
    }>(`/api/assessments/${assessmentId}/start`, {
      method: 'POST',
    });
  },

  async getAttemptState(attemptId: string) {
    return this.request<{
      attempt: any;
      assessment: any;
      questions: any[];
      answers: any[];
      remainingSeconds: number;
    }>(`/api/assessments/attempts/${attemptId}`);
  },

  async getAttemptAnswers(attemptId: string) {
    return this.request<{ answers: any[] }>(`/api/assessments/attempts/${attemptId}/answers`);
  },

  async saveAssessmentAnswer(
    attemptId: string,
    payload: { questionId: string; selectedOptionId?: string; selectedOptionIds?: string[]; descriptiveAnswer?: string }
  ) {
    return this.request<{ message: string; answer: any }>(
      `/api/assessments/attempts/${attemptId}/answers`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  },

  async submitAssessmentAttempt(attemptId: string) {
    return this.request<{ message: string; attempt: any }>(
      `/api/assessments/attempts/${attemptId}/submit`,
      {
        method: 'POST',
      }
    );
  },

  async getAttemptReview(attemptId: string) {
    return this.request<AttemptReviewResponse>(`/api/assessments/attempts/${attemptId}/review`);
  },

  // ==========================================
  // Student & Mentor Analytics API Methods
  // ==========================================
  async getStudentAnalyticsSummary() {
    return this.request<{ summary: PerformanceMetricSummary }>('/api/analytics/student/summary');
  },

  async getStudentAnalyticsHistory(params: { page?: number; limit?: number; subject?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.page) qs.append('page', params.page.toString());
    if (params.limit) qs.append('limit', params.limit.toString());
    if (params.subject) qs.append('subject', params.subject);
    return this.request<{ items: AssessmentHistoryItem[]; total: number; page: number; limit: number; hasMore: boolean }>(
      `/api/analytics/student/history?${qs.toString()}`
    );
  },

  async getStudentTopicAnalytics() {
    return this.request<{ topics: TopicAnalyticsItem[] }>('/api/analytics/student/topics');
  },

  async getStudentAnalyticsTopics() {
    return this.getStudentTopicAnalytics();
  },

  async getStudentAnalyticsTrends() {
    return this.request<{ timeline: TrendDataPoint[]; overallTrend: string }>('/api/analytics/student/trends');
  },

  async getStudentRecentActivity(limit: number = 5) {
    return this.request<{ recent: AssessmentHistoryItem[] }>(`/api/analytics/student/recent?limit=${limit}`);
  },

  async getStudentAnalyticsCounts() {
    return this.request<{ counts: StudentCounts }>('/api/analytics/student/counts');
  },

  async getMentorAnalyticsOverview() {
    return this.request<{ overview: MentorOverviewMetrics }>('/api/analytics/mentor/overview');
  },

  async getMentorCohortTopics() {
    return this.request<{ topics: AdminTopicAnalyticsItem[] }>('/api/analytics/mentor/topics');
  },

  async getMentorMenteesAnalytics() {
    return this.request<{ mentees: MenteePerformanceListItem[] }>('/api/analytics/mentor/mentees');
  },

  async getMentorMenteesList() {
    return this.getMentorMenteesAnalytics();
  },

  async getMentorAtRiskMentees() {
    return this.request<{ atRiskStudents: AtRiskStudentItem[] }>('/api/analytics/mentor/at-risk');
  },

  async getIndividualMenteeSummary(studentId: string) {
    return this.request<{ summary: PerformanceMetricSummary }>(`/api/analytics/mentor/mentees/${studentId}`);
  },

  async getIndividualMenteeTopics(studentId: string) {
    return this.request<{ topics: TopicAnalyticsItem[] }>(`/api/analytics/mentor/mentees/${studentId}/topics`);
  },

  async getIndividualMenteeTrends(studentId: string) {
    return this.request<{ timeline: TrendDataPoint[]; overallTrend: string }>(
      `/api/analytics/mentor/mentees/${studentId}/trends`
    );
  },

  async getAdminAnalyticsOverview() {
    return this.request<{ overview: any }>('/api/analytics/admin/overview');
  },

  async getAdminCohortAnalytics() {
    return this.request<{ cohorts: any[] }>('/api/analytics/admin/cohorts');
  },

  async getAdminTopicAnalytics() {
    return this.request<{ topics: AdminTopicAnalyticsItem[] }>('/api/analytics/admin/topics');
  },
};

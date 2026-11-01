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
  }) {
    return this.request<{ message: string; assessment: any }>('/api/assessments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getAssessment(id: string) {
    return this.request<{ assessment: any }>(`/api/assessments/${id}`);
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

  async addAssessmentQuestion(assessmentId: string, payload: {
    questionType: 'mcq' | 'descriptive';
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
    payload: { questionId: string; selectedOptionId?: string; descriptiveAnswer?: string }
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

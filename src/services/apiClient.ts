import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  status: number;
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
};

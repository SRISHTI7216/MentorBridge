export type UserRole = 'student' | 'mentor' | 'admin';

export interface StudentDetailsRecord {
  id: string;
  rollNumber: string;
  branch: string;
  semester: number;
  division: string;
  admissionYear: number;
  cohortId?: string;
  cohortName?: string;
  overallScore?: number;
  dsaProficiency?: number;
  systemDesignScore?: number;
  attendanceRate?: number;
}

export interface MentorDetailsRecord {
  id: string;
  employeeId: string;
  department: string;
  designation: string;
  officeLocation?: string;
  officeHours?: string;
  specializations?: string[];
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  studentDetails?: StudentDetailsRecord;
  mentorDetails?: MentorDetailsRecord;
}

export interface AssignedMentee {
  assignmentId: string;
  studentId: string;
  name: string;
  email: string;
  avatarUrl?: string;
  rollNumber: string;
  branch: string;
  semester: number;
  division: string;
  cohortName?: string;
  assignedDate: string;
  isActive: boolean;
  overallScore?: number;
  dsaProficiency?: number;
  attendanceRate?: number;
  notes?: string;
}

export interface AssignedMentor {
  assignmentId: string;
  mentorId: string;
  name: string;
  email: string;
  avatarUrl?: string;
  employeeId: string;
  department: string;
  designation: string;
  officeLocation?: string;
  officeHours?: string;
  specializations?: string[];
  assignedDate: string;
}

export interface AuthContextType {
  user: { id: string; email?: string } | null;
  profile: UserProfile | null;
  role: UserRole | null;
  isLoading: boolean;
  error: string | null;
  isConfigured: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null; role?: UserRole }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null; success?: boolean }>;
  refreshProfile: () => Promise<void>;
}


import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { UserProfile, AssignedMentee, AssignedMentor } from '../types/auth';

/**
 * Fetches the user profile and associated role details (student_details or mentor_details)
 */
export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !profile) {
      console.error('[DataService] Error fetching profile:', error);
      return null;
    }

    const userProfile: UserProfile = {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      avatarUrl: profile.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.name)}&background=3525CD&color=fff`,
      isActive: profile.is_active,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    };

    if (profile.role === 'student') {
      const { data: studentDetails } = await supabase
        .from('student_details')
        .select('*, cohort:cohorts(name)')
        .eq('profile_id', userId)
        .maybeSingle();

      if (studentDetails) {
        userProfile.studentDetails = {
          id: studentDetails.id,
          rollNumber: studentDetails.roll_number,
          branch: studentDetails.branch,
          semester: studentDetails.semester,
          division: studentDetails.division,
          admissionYear: studentDetails.admission_year,
          cohortId: studentDetails.cohort_id,
          cohortName: studentDetails.cohort?.name,
          overallScore: Number(studentDetails.overall_score) || 0,
          dsaProficiency: Number(studentDetails.dsa_proficiency) || 0,
          systemDesignScore: Number(studentDetails.system_design_score) || 0,
          attendanceRate: Number(studentDetails.attendance_rate) || 0,
        };
      }
    } else if (profile.role === 'mentor') {
      const { data: mentorDetails } = await supabase
        .from('mentor_details')
        .select('*')
        .eq('profile_id', userId)
        .maybeSingle();

      if (mentorDetails) {
        userProfile.mentorDetails = {
          id: mentorDetails.id,
          employeeId: mentorDetails.employee_id,
          department: mentorDetails.department,
          designation: mentorDetails.designation,
          officeLocation: mentorDetails.office_location,
          officeHours: mentorDetails.office_hours,
          specializations: mentorDetails.specializations || [],
        };
      }
    }

    return userProfile;
  } catch (err) {
    console.error('[DataService] Unexpected error fetching user profile:', err);
    return null;
  }
}

/**
 * Fetches real assigned mentees for a faculty mentor
 */
export async function fetchMentorMentees(mentorId: string): Promise<AssignedMentee[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('mentor_assignments')
      .select(`
        id,
        assigned_date,
        is_active,
        notes,
        student:profiles!mentor_assignments_student_id_fkey (
          id,
          name,
          email,
          avatar_url,
          student_details (
            roll_number,
            branch,
            semester,
            division,
            overall_score,
            dsa_proficiency,
            attendance_rate,
            cohort:cohorts (name)
          )
        )
      `)
      .eq('mentor_id', mentorId)
      .eq('is_active', true);

    if (error) {
      console.error('[DataService] Error fetching mentor mentees:', error);
      return [];
    }

    if (!data) return [];

    return data.map((item: any) => {
      const student = item.student;
      const details = Array.isArray(student?.student_details)
        ? student?.student_details[0]
        : student?.student_details;

      return {
        assignmentId: item.id,
        studentId: student?.id,
        name: student?.name || 'Unnamed Student',
        email: student?.email || '',
        avatarUrl: student?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(student?.name || 'Student')}&background=3525CD&color=fff`,
        rollNumber: details?.roll_number || 'N/A',
        branch: details?.branch || 'CSE',
        semester: details?.semester || 1,
        division: details?.division || 'A',
        cohortName: details?.cohort?.name || 'Unassigned Cohort',
        assignedDate: item.assigned_date,
        isActive: item.is_active,
        overallScore: Number(details?.overall_score) || 0,
        dsaProficiency: Number(details?.dsa_proficiency) || 0,
        attendanceRate: Number(details?.attendance_rate) || 0,
        notes: item.notes,
      };
    });
  } catch (err) {
    console.error('[DataService] Unexpected error querying mentees:', err);
    return [];
  }
}

/**
 * Fetches the assigned faculty mentor for a student
 */
export async function fetchStudentMentor(studentId: string): Promise<AssignedMentor | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('mentor_assignments')
      .select(`
        id,
        assigned_date,
        is_active,
        mentor:profiles!mentor_assignments_mentor_id_fkey (
          id,
          name,
          email,
          avatar_url,
          mentor_details (
            employee_id,
            department,
            designation,
            office_location,
            office_hours,
            specializations
          )
        )
      `)
      .eq('student_id', studentId)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) {
      if (error) console.error('[DataService] Error fetching student mentor:', error);
      return null;
    }

    const mentor = (data as any).mentor;
    const details = Array.isArray(mentor?.mentor_details)
      ? mentor?.mentor_details[0]
      : mentor?.mentor_details;

    return {
      assignmentId: data.id,
      mentorId: mentor?.id,
      name: mentor?.name || 'Faculty Mentor',
      email: mentor?.email || '',
      avatarUrl: mentor?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(mentor?.name || 'Mentor')}&background=006E4B&color=fff`,
      employeeId: details?.employee_id || 'FAC-N/A',
      department: details?.department || 'Department of Computer Science & Engineering',
      designation: details?.designation || 'Faculty Advisor',
      officeLocation: details?.office_location || 'Faculty Cabin',
      officeHours: details?.office_hours || 'Office hours on appointment',
      specializations: details?.specializations || [],
      assignedDate: data.assigned_date,
    };
  } catch (err) {
    console.error('[DataService] Unexpected error querying mentor:', err);
    return null;
  }
}


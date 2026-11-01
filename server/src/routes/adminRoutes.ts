import { Router, Response } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { AdminRequest, requireAdminAuth } from '../middleware/auth.js';

const router = Router();

const rawUrl = process.env.SUPABASE_URL || '';
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '').trim();
const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();

// Creates a Supabase client executing in the security context of the authenticated administrator
const getAdminUserClient = (token: string): SupabaseClient => {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
};

const getReqToken = (req: AdminRequest): string => {
  return (req.headers.authorization || '').replace('Bearer ', '').trim();
};

const getInvitationRedirectUrl = (req: AdminRequest): string => {
  let origin = (req.headers.origin as string) || '';
  if (!origin && req.headers.referer) {
    try {
      origin = new URL(req.headers.referer as string).origin;
    } catch {
      origin = '';
    }
  }
  const frontendBase = process.env.FRONTEND_URL || origin || 'http://localhost:5173';
  return `${frontendBase.replace(/\/+$/, '')}/auth/callback`;
};

// Enforce admin authentication across all administrative routes
router.use(requireAdminAuth);

// ============================================================================
// 1. DASHBOARD & AGGREGATE STATISTICS
// ============================================================================
router.get('/stats', async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const admin = supabaseAdmin!;

    // 1. Get current active academic term
    const { data: currentTerm } = await admin
      .from('academic_terms')
      .select('*')
      .eq('is_current', true)
      .maybeSingle();

    // 2. Aggregate counts from profiles
    const [
      studentsCountRes,
      mentorsCountRes,
      activeAccountsRes,
      inactiveAccountsRes,
      assignmentsCountRes,
      recentProfilesRes,
    ] = await Promise.all([
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student'),
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'mentor'),
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', false),
      admin.from('mentor_assignments').select('id', { count: 'exact', head: true }).eq('is_active', true),
      admin
        .from('profiles')
        .select('id, name, email, role, is_active, created_at')
        .order('created_at', { ascending: false })
        .limit(6),
    ]);

    // 3. Count unassigned active students for current term
    let unassignedStudentsCount = 0;
    if (currentTerm?.id) {
      const { data: activeStudents } = await admin
        .from('profiles')
        .select('id')
        .eq('role', 'student')
        .eq('is_active', true);

      const { data: assignedStudents } = await admin
        .from('mentor_assignments')
        .select('student_id')
        .eq('academic_term_id', currentTerm.id)
        .eq('is_active', true);

      const assignedSet = new Set((assignedStudents || []).map((a) => a.student_id));
      unassignedStudentsCount = (activeStudents || []).filter((s) => !assignedSet.has(s.id)).length;
    }

    // 4. Recent assignments
    const { data: recentAssignments } = await admin
      .from('mentor_assignments')
      .select(`
        id,
        assigned_date,
        created_at,
        is_active,
        student:profiles!mentor_assignments_student_id_fkey(id, name, email),
        mentor:profiles!mentor_assignments_mentor_id_fkey(id, name, email),
        academic_term:academic_terms(name, code)
      `)
      .order('created_at', { ascending: false })
      .limit(6);

    res.json({
      totalStudents: studentsCountRes.count ?? 0,
      totalMentors: mentorsCountRes.count ?? 0,
      activeAccounts: activeAccountsRes.count ?? 0,
      inactiveAccounts: inactiveAccountsRes.count ?? 0,
      unassignedStudents: unassignedStudentsCount,
      totalActiveAssignments: assignmentsCountRes.count ?? 0,
      currentTerm: currentTerm || null,
      recentRegistrations: recentProfilesRes.data || [],
      recentAssignments: recentAssignments || [],
    });
  } catch (err: unknown) {
    console.error('[AdminStats] Error fetching dashboard statistics:', err);
    res.status(500).json({ error: 'Failed to retrieve administrative statistics.' });
  }
});

// ============================================================================
// 2. STUDENT MANAGEMENT
// ============================================================================
router.get('/students', async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const admin = supabaseAdmin!;
    const { search, semester, division, branch, status, cohortId } = req.query;

    let query = admin
      .from('profiles')
      .select(`
        id,
        name,
        email,
        role,
        is_active,
        avatar_url,
        created_at,
        updated_at,
        student_details (
          id,
          roll_number,
          branch,
          semester,
          division,
          admission_year,
          cohort_id,
          overall_score,
          dsa_proficiency,
          system_design_score,
          attendance_rate,
          cohort:cohorts(id, name, code)
        )
      `)
      .eq('role', 'student')
      .order('created_at', { ascending: false });

    if (status === 'active') query = query.eq('is_active', true);
    if (status === 'inactive') query = query.eq('is_active', false);

    const { data: students, error } = await query;
    if (error) throw error;

    // Fetch active assignments for current term
    const { data: currentTerm } = await admin
      .from('academic_terms')
      .select('id')
      .eq('is_current', true)
      .maybeSingle();

    let assignmentsMap = new Map<string, any>();
    if (currentTerm?.id) {
      const { data: assignments } = await admin
        .from('mentor_assignments')
        .select(`
          id,
          student_id,
          assigned_date,
          mentor:profiles!mentor_assignments_mentor_id_fkey(id, name, email)
        `)
        .eq('academic_term_id', currentTerm.id)
        .eq('is_active', true);

      (assignments || []).forEach((a) => {
        assignmentsMap.set(a.student_id, {
          assignmentId: a.id,
          assignedDate: a.assigned_date,
          mentor: a.mentor,
        });
      });
    }

    // Format & filter in-memory for joined fields if query parameters were provided
    const formatted = (students || [])
      .map((item: any) => {
        const details = Array.isArray(item.student_details)
          ? item.student_details[0]
          : item.student_details;

        return {
          id: item.id,
          name: item.name,
          email: item.email,
          role: item.role,
          isActive: item.is_active,
          avatarUrl: item.avatar_url,
          createdAt: item.created_at,
          rollNumber: details?.roll_number || 'N/A',
          branch: details?.branch || 'CSE',
          semester: details?.semester ?? null,
          division: details?.division || '',
          admissionYear: details?.admission_year ?? null,
          cohortId: details?.cohort_id || null,
          cohortName: details?.cohort?.name || 'Unassigned',
          cohortCode: details?.cohort?.code || '',
          overallScore: Number(details?.overall_score) || 0,
          dsaProficiency: Number(details?.dsa_proficiency) || 0,
          attendanceRate: Number(details?.attendance_rate) || 0,
          assignedMentor: assignmentsMap.get(item.id) || null,
        };
      })
      .filter((s: any) => {
        if (search) {
          const q = String(search).toLowerCase().trim();
          const match =
            s.name.toLowerCase().includes(q) ||
            s.email.toLowerCase().includes(q) ||
            s.rollNumber.toLowerCase().includes(q);
          if (!match) return false;
        }
        if (semester && String(s.semester) !== String(semester)) return false;
        if (division && s.division.toLowerCase() !== String(division).toLowerCase()) return false;
        if (branch && s.branch.toLowerCase() !== String(branch).toLowerCase()) return false;
        if (cohortId && s.cohortId !== cohortId) return false;
        return true;
      });

    res.json({ students: formatted });
  } catch (err: unknown) {
    console.error('[AdminStudents] Error listing students:', err);
    res.status(500).json({ error: 'Failed to retrieve students list.' });
  }
});

router.post('/students', async (req: AdminRequest, res: Response): Promise<void> => {
  const admin = supabaseAdmin!;
  const {
    name,
    email,
    rollNumber,
    branch = 'CSE',
    semester = 1,
    division = 'A',
    admissionYear = new Date().getFullYear(),
    cohortId = null,
  } = req.body;

  // 1. Validation
  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Student full name is required.' });
    return;
  }
  if (!email || !email.trim() || !email.includes('@')) {
    res.status(400).json({ error: 'A valid student email address is required.' });
    return;
  }
  if (!rollNumber || !rollNumber.trim()) {
    res.status(400).json({ error: 'Student roll number / registration number is required.' });
    return;
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanRollNumber = rollNumber.trim().toUpperCase();

  let createdUserId: string | null = null;

  try {
    // 2. Check for duplicate email in profiles
    const { data: existingEmailProfile } = await admin
      .from('profiles')
      .select('id, email')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (existingEmailProfile) {
      res.status(409).json({
        error: `An account with email '${cleanEmail}' is already registered in the system.`,
      });
      return;
    }

    // 3. Check for duplicate roll number in student_details
    const { data: existingRoll } = await admin
      .from('student_details')
      .select('id, roll_number')
      .eq('roll_number', cleanRollNumber)
      .maybeSingle();

    if (existingRoll) {
      res.status(409).json({
        error: `Roll number '${cleanRollNumber}' is already registered for another student.`,
      });
      return;
    }

    // 4. Invite user via Supabase Auth Admin API
    const redirectTo = getInvitationRedirectUrl(req);
    let emailSent = false;
    let inviteLink: string | undefined;
    let smtpNote: string | undefined;

    // First attempt official Supabase email invitation
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      cleanEmail,
      {
        redirectTo,
        data: {
          name: name.trim(),
          role: 'student',
        },
      }
    );

    if (!inviteError && inviteData?.user) {
      createdUserId = inviteData.user.id;
      emailSent = true;
    } else {
      // If direct email delivery fails (e.g. SMTP unconfigured or rate limited)
      // fallback safely to generating the invitation token/link
      console.warn('[AdminCreateStudent] Direct SMTP invite failed, generating invite link:', inviteError?.message);
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: 'invite',
        email: cleanEmail,
        options: {
          redirectTo,
          data: {
            name: name.trim(),
            role: 'student',
          },
        },
      });

      if (linkError || !linkData?.user) {
        throw new Error(linkError?.message || inviteError?.message || 'Failed to create auth invitation.');
      }

      createdUserId = linkData.user.id;
      inviteLink = linkData.properties?.action_link;
      smtpNote =
        'Direct SMTP email sending is not configured on this Supabase project. An invitation link was generated successfully and can be copied to the student.';
    }

    // 5. Ensure profile is present (trigger handles it, but safe upsert ensures role & name)
    const { error: profileUpsertError } = await admin.from('profiles').upsert({
      id: createdUserId,
      name: name.trim(),
      email: cleanEmail,
      role: 'student',
      is_active: true,
    });

    if (profileUpsertError) {
      throw new Error(`Profile sync error: ${profileUpsertError.message}`);
    }

    // 6. Insert student_details
    const { data: studentDetail, error: detailError } = await admin
      .from('student_details')
      .insert({
        profile_id: createdUserId,
        roll_number: cleanRollNumber,
        branch: branch.trim(),
        semester: Number(semester) || 1,
        division: division.trim(),
        admission_year: Number(admissionYear),
        cohort_id: cohortId || null,
        overall_score: 0.0,
        dsa_proficiency: 0.0,
        system_design_score: 0.0,
        attendance_rate: 100.0,
      })
      .select('*, cohort:cohorts(name, code)')
      .single();

    if (detailError) {
      // Rollback auth user creation to prevent inconsistent records
      console.error('[AdminCreateStudent] Rolling back user creation due to details insert failure:', detailError);
      await admin.auth.admin.deleteUser(createdUserId);
      throw detailError;
    }

    res.status(201).json({
      message: 'Student account provisioned successfully.',
      student: {
        id: createdUserId,
        name: name.trim(),
        email: cleanEmail,
        role: 'student',
        isActive: true,
        rollNumber: cleanRollNumber,
        branch: branch.trim(),
        semester: Number(semester) || 1,
        division: division.trim(),
        admissionYear: Number(admissionYear),
        cohortId: cohortId || null,
        cohortName: studentDetail?.cohort?.name || 'Unassigned',
      },
      invitation: {
        emailSent,
        inviteLink,
        smtpNote,
      },
    });
  } catch (err: unknown) {
    console.error('[AdminCreateStudent] Failed to create student account:', err);
    // Cleanup if partially created
    if (createdUserId) {
      try {
        await admin.auth.admin.deleteUser(createdUserId);
      } catch (cleanupErr) {
        console.error('[AdminCreateStudent] Failed to delete orphaned auth user:', cleanupErr);
      }
    }
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to provision student account.',
    });
  }
});

router.put('/students/:id', async (req: AdminRequest, res: Response): Promise<void> => {
  const admin = supabaseAdmin!;
  const studentId = req.params.id;
  const { name, rollNumber, branch, semester, division, admissionYear, cohortId } = req.body;

  try {
    // 1. Verify user exists and is a student
    const { data: existingStudent, error: fetchErr } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', studentId)
      .maybeSingle();

    if (fetchErr || !existingStudent) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }

    if (existingStudent.role !== 'student') {
      res.status(400).json({ error: 'Target user is not a student account.' });
      return;
    }

    // 2. Check roll number uniqueness if changed
    if (rollNumber) {
      const cleanRoll = rollNumber.trim().toUpperCase();
      const { data: conflict } = await admin
        .from('student_details')
        .select('id, profile_id')
        .eq('roll_number', cleanRoll)
        .neq('profile_id', studentId)
        .maybeSingle();

      if (conflict) {
        res.status(409).json({ error: `Roll number '${cleanRoll}' is already in use by another student.` });
        return;
      }
    }

    // 3. Update profile name if provided
    if (name && name.trim()) {
      await admin.from('profiles').update({ name: name.trim() }).eq('id', studentId);
    }

    // 4. Update student details
    const updates: Record<string, any> = {};
    if (rollNumber) updates.roll_number = rollNumber.trim().toUpperCase();
    if (branch) updates.branch = branch.trim();
    if (semester !== undefined) updates.semester = Number(semester);
    if (division) updates.division = division.trim();
    if (admissionYear !== undefined) updates.admission_year = Number(admissionYear);
    if (cohortId !== undefined) updates.cohort_id = cohortId || null;

    const { data: updatedDetails, error: updateErr } = await admin
      .from('student_details')
      .update(updates)
      .eq('profile_id', studentId)
      .select('*, cohort:cohorts(name, code)')
      .single();

    if (updateErr) throw updateErr;

    res.json({
      message: 'Student record updated successfully.',
      student: updatedDetails,
    });
  } catch (err: unknown) {
    console.error('[AdminUpdateStudent] Error updating student record:', err);
    res.status(500).json({ error: 'Failed to update student details.' });
  }
});

// ============================================================================
// 3. MENTOR MANAGEMENT
// ============================================================================
router.get('/mentors', async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const admin = supabaseAdmin!;
    const { search, status, department } = req.query;

    let query = admin
      .from('profiles')
      .select(`
        id,
        name,
        email,
        role,
        is_active,
        avatar_url,
        created_at,
        mentor_details (
          id,
          employee_id,
          department,
          designation,
          office_location,
          office_hours,
          specializations
        )
      `)
      .eq('role', 'mentor')
      .order('created_at', { ascending: false });

    if (status === 'active') query = query.eq('is_active', true);
    if (status === 'inactive') query = query.eq('is_active', false);

    const { data: mentors, error } = await query;
    if (error) throw error;

    // Get active assignments per mentor for current term
    const { data: currentTerm } = await admin
      .from('academic_terms')
      .select('id')
      .eq('is_current', true)
      .maybeSingle();

    const mentorAssignmentsMap = new Map<string, any[]>();
    if (currentTerm?.id) {
      const { data: assignments } = await admin
        .from('mentor_assignments')
        .select(`
          id,
          mentor_id,
          assigned_date,
          student:profiles!mentor_assignments_student_id_fkey(
            id,
            name,
            email,
            student_details(roll_number, semester, division)
          )
        `)
        .eq('academic_term_id', currentTerm.id)
        .eq('is_active', true);

      (assignments || []).forEach((a: any) => {
        const list = mentorAssignmentsMap.get(a.mentor_id) || [];
        const studentObj = Array.isArray(a.student) ? a.student[0] : a.student;
        const details = Array.isArray(studentObj?.student_details)
          ? studentObj?.student_details[0]
          : studentObj?.student_details;

        list.push({
          assignmentId: a.id,
          studentId: studentObj?.id,
          name: studentObj?.name,
          email: studentObj?.email,
          rollNumber: details?.roll_number || 'N/A',
          assignedDate: a.assigned_date,
        });
        mentorAssignmentsMap.set(a.mentor_id, list);
      });
    }

    const formatted = (mentors || [])
      .map((item: any) => {
        const details = Array.isArray(item.mentor_details)
          ? item.mentor_details[0]
          : item.mentor_details;

        const mentees = mentorAssignmentsMap.get(item.id) || [];

        return {
          id: item.id,
          name: item.name,
          email: item.email,
          role: item.role,
          isActive: item.is_active,
          avatarUrl: item.avatar_url,
          createdAt: item.created_at,
          employeeId: details?.employee_id || 'N/A',
          department: details?.department || 'Computer Science & Engineering',
          designation: details?.designation || 'Faculty Advisor',
          officeLocation: details?.office_location || 'Not Specified',
          officeHours: details?.office_hours || 'On appointment',
          specializations: details?.specializations || [],
          assignedStudentsCount: mentees.length,
          assignedMentees: mentees,
        };
      })
      .filter((m: any) => {
        if (search) {
          const q = String(search).toLowerCase().trim();
          const match =
            m.name.toLowerCase().includes(q) ||
            m.email.toLowerCase().includes(q) ||
            m.employeeId.toLowerCase().includes(q);
          if (!match) return false;
        }
        if (department && m.department.toLowerCase() !== String(department).toLowerCase()) {
          return false;
        }
        return true;
      });

    res.json({ mentors: formatted });
  } catch (err: unknown) {
    console.error('[AdminMentors] Error listing mentors:', err);
    res.status(500).json({ error: 'Failed to retrieve mentors list.' });
  }
});

router.post('/mentors', async (req: AdminRequest, res: Response): Promise<void> => {
  const admin = supabaseAdmin!;
  const {
    name,
    email,
    employeeId,
    department = 'Computer Science & Engineering',
    designation = 'Assistant Professor',
    officeLocation = 'Faculty Cabin',
    officeHours = 'Monâ€“Thu 14:00â€“16:00',
    specializations = [],
  } = req.body;

  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Faculty mentor full name is required.' });
    return;
  }
  if (!email || !email.trim() || !email.includes('@')) {
    res.status(400).json({ error: 'A valid institutional email address is required.' });
    return;
  }
  if (!employeeId || !employeeId.trim()) {
    res.status(400).json({ error: 'Faculty Employee ID is required.' });
    return;
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanEmpId = employeeId.trim().toUpperCase();

  let createdUserId: string | null = null;

  try {
    // 1. Check duplicate email
    const { data: existingEmail } = await admin
      .from('profiles')
      .select('id, email')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (existingEmail) {
      res.status(409).json({ error: `An account with email '${cleanEmail}' is already registered.` });
      return;
    }

    // 2. Check duplicate employee ID
    const { data: existingEmp } = await admin
      .from('mentor_details')
      .select('id, employee_id')
      .eq('employee_id', cleanEmpId)
      .maybeSingle();

    if (existingEmp) {
      res.status(409).json({ error: `Employee ID '${cleanEmpId}' is already registered.` });
      return;
    }

    // 3. Invite user via Supabase Auth Admin
    const redirectTo = getInvitationRedirectUrl(req);
    let emailSent = false;
    let inviteLink: string | undefined;
    let smtpNote: string | undefined;

    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      cleanEmail,
      {
        redirectTo,
        data: {
          name: name.trim(),
          role: 'mentor',
        },
      }
    );

    if (!inviteError && inviteData?.user) {
      createdUserId = inviteData.user.id;
      emailSent = true;
    } else {
      console.warn('[AdminCreateMentor] Direct SMTP invite failed, generating invite link:', inviteError?.message);
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: 'invite',
        email: cleanEmail,
        options: {
          redirectTo,
          data: {
            name: name.trim(),
            role: 'mentor',
          },
        },
      });

      if (linkError || !linkData?.user) {
        throw new Error(linkError?.message || inviteError?.message || 'Failed to create mentor invitation.');
      }

      createdUserId = linkData.user.id;
      inviteLink = linkData.properties?.action_link;
      smtpNote =
        'Direct SMTP email sending is not configured on this Supabase project. An invitation link was generated successfully and can be copied to the faculty mentor.';
    }

    // 4. Ensure profile is present with role = 'mentor'
    await admin.from('profiles').upsert({
      id: createdUserId,
      name: name.trim(),
      email: cleanEmail,
      role: 'mentor',
      is_active: true,
    });

    // 5. Insert mentor_details
    const { data: mentorDetail, error: detailError } = await admin
      .from('mentor_details')
      .insert({
        profile_id: createdUserId,
        employee_id: cleanEmpId,
        department: department.trim(),
        designation: designation.trim(),
        office_location: officeLocation?.trim() || null,
        office_hours: officeHours?.trim() || null,
        specializations: Array.isArray(specializations) ? specializations : [],
      })
      .select('*')
      .single();

    if (detailError) {
      console.error('[AdminCreateMentor] Rolling back user creation:', detailError);
      await admin.auth.admin.deleteUser(createdUserId);
      throw detailError;
    }

    res.status(201).json({
      message: 'Faculty mentor account provisioned successfully.',
      mentor: {
        id: createdUserId,
        name: name.trim(),
        email: cleanEmail,
        role: 'mentor',
        isActive: true,
        employeeId: cleanEmpId,
        department: mentorDetail.department,
        designation: mentorDetail.designation,
        officeLocation: mentorDetail.office_location,
        officeHours: mentorDetail.office_hours,
        specializations: mentorDetail.specializations,
      },
      invitation: {
        emailSent,
        inviteLink,
        smtpNote,
      },
    });
  } catch (err: unknown) {
    console.error('[AdminCreateMentor] Error creating mentor account:', err);
    if (createdUserId) {
      try {
        await admin.auth.admin.deleteUser(createdUserId);
      } catch (cleanupErr) {
        console.error('[AdminCreateMentor] Cleanup failed:', cleanupErr);
      }
    }
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to provision mentor account.',
    });
  }
});

router.put('/mentors/:id', async (req: AdminRequest, res: Response): Promise<void> => {
  const admin = supabaseAdmin!;
  const mentorId = req.params.id;
  const {
    name,
    employeeId,
    department,
    designation,
    officeLocation,
    officeHours,
    specializations,
  } = req.body;

  try {
    const { data: existingMentor } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', mentorId)
      .maybeSingle();

    if (!existingMentor || existingMentor.role !== 'mentor') {
      res.status(404).json({ error: 'Faculty mentor not found.' });
      return;
    }

    if (employeeId) {
      const cleanEmp = employeeId.trim().toUpperCase();
      const { data: conflict } = await admin
        .from('mentor_details')
        .select('id, profile_id')
        .eq('employee_id', cleanEmp)
        .neq('profile_id', mentorId)
        .maybeSingle();

      if (conflict) {
        res.status(409).json({ error: `Employee ID '${cleanEmp}' is already in use.` });
        return;
      }
    }

    if (name && name.trim()) {
      await admin.from('profiles').update({ name: name.trim() }).eq('id', mentorId);
    }

    const updates: Record<string, any> = {};
    if (employeeId) updates.employee_id = employeeId.trim().toUpperCase();
    if (department) updates.department = department.trim();
    if (designation) updates.designation = designation.trim();
    if (officeLocation !== undefined) updates.office_location = officeLocation?.trim() || null;
    if (officeHours !== undefined) updates.office_hours = officeHours?.trim() || null;
    if (specializations !== undefined) {
      updates.specializations = Array.isArray(specializations) ? specializations : [];
    }

    const { data: updatedDetails, error: updateErr } = await admin
      .from('mentor_details')
      .update(updates)
      .eq('profile_id', mentorId)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    res.json({
      message: 'Faculty mentor record updated successfully.',
      mentor: updatedDetails,
    });
  } catch (err: unknown) {
    console.error('[AdminUpdateMentor] Error updating mentor record:', err);
    res.status(500).json({ error: 'Failed to update mentor details.' });
  }
});

// ============================================================================
// 4. ACCOUNT ACTIVATION / DEACTIVATION
// ============================================================================
router.patch('/users/:id/status', async (req: AdminRequest, res: Response): Promise<void> => {
  const admin = supabaseAdmin!;
  const targetUserId = req.params.id;
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    res.status(400).json({ error: 'isActive must be a boolean value.' });
    return;
  }

  // Security guard: Admin cannot deactivate their own session account
  if (req.adminUser?.id === targetUserId) {
    res.status(400).json({
      error: 'Self-deactivation prohibited: An administrator cannot deactivate their own account.',
    });
    return;
  }

  try {
    const token = getReqToken(req);
    const userClient = getAdminUserClient(token);

    const { data: profile, error } = await userClient
      .from('profiles')
      .update({ is_active: isActive })
      .eq('id', targetUserId)
      .select('id, name, email, role, is_active')
      .single();

    if (error || !profile) {
      res.status(404).json({ error: 'Target user account not found.' });
      return;
    }

    // If deactivating a student or mentor, optionally deactivate their active assignments
    if (!isActive) {
      await admin
        .from('mentor_assignments')
        .update({ is_active: false })
        .or(`student_id.eq.${targetUserId},mentor_id.eq.${targetUserId}`)
        .eq('is_active', true);
    }

    res.json({
      message: `Account successfully ${isActive ? 'activated' : 'deactivated'}.`,
      profile,
    });
  } catch (err: unknown) {
    console.error('[AdminUserStatus] Error modifying account status:', err);
    res.status(500).json({ error: 'Failed to update account status.' });
  }
});

// Re-generate or dispatch fresh invitation link for an existing student or mentor
router.post('/users/:id/reinvite', async (req: AdminRequest, res: Response): Promise<void> => {
  const admin = supabaseAdmin!;
  const targetUserId = req.params.id;

  try {
    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .select('id, name, email, role, is_active')
      .eq('id', targetUserId)
      .single();

    if (profileErr || !profile) {
      res.status(404).json({ error: 'User profile not found.' });
      return;
    }

    const redirectTo = getInvitationRedirectUrl(req);
    let emailSent = false;
    let inviteLink: string | undefined;
    let smtpNote: string | undefined;

    // Attempt official Supabase email invitation
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      profile.email,
      {
        redirectTo,
        data: {
          name: profile.name,
          role: profile.role,
        },
      }
    );

    if (!inviteError && inviteData?.user) {
      emailSent = true;
    } else {
      console.warn('[AdminReinviteUser] Direct invite error, generating invite/recovery link:', inviteError?.message);
      let linkRes = await admin.auth.admin.generateLink({
        type: 'invite',
        email: profile.email,
        options: {
          redirectTo,
          data: {
            name: profile.name,
            role: profile.role,
          },
        },
      });

      if (linkRes.error) {
        linkRes = await admin.auth.admin.generateLink({
          type: 'recovery',
          email: profile.email,
          options: {
            redirectTo,
          },
        });
      }

      if (linkRes.error || !linkRes.data?.user) {
        throw new Error(linkRes.error?.message || 'Failed to re-generate invitation link.');
      }

      inviteLink = linkRes.data.properties?.action_link;
      smtpNote =
        'Direct SMTP email sending is not configured on this Supabase project. A fresh invitation link was generated successfully and can be copied.';
    }

    res.json({
      message: `Fresh invitation generated for ${profile.name} (${profile.email}).`,
      invitation: {
        emailSent,
        inviteLink,
        smtpNote,
      },
    });
  } catch (err: unknown) {
    console.error('[AdminReinviteUser] Failed to generate fresh invitation:', err);
    res.status(500).json({ error: (err as Error).message || 'Failed to re-generate invitation.' });
  }
});

// ============================================================================
// 5. MENTORâ€“MENTEE ALLOCATION
// ============================================================================
router.get('/allocations', async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const admin = supabaseAdmin!;
    const termIdParam = req.query.termId as string;

    // Get selected term or default to current
    let termQuery = admin.from('academic_terms').select('*');
    if (termIdParam) {
      termQuery = termQuery.eq('id', termIdParam);
    } else {
      termQuery = termQuery.eq('is_current', true);
    }

    const { data: termData } = await termQuery.maybeSingle();
    const activeTerm = termData;

    if (!activeTerm) {
      res.json({
        term: null,
        mentors: [],
        unassignedStudents: [],
        stats: { totalAssigned: 0, totalUnassigned: 0, totalMentors: 0 },
      });
      return;
    }

    // 1. Get active mentors
    const { data: mentors } = await admin
      .from('profiles')
      .select(`
        id,
        name,
        email,
        mentor_details(employee_id, department, designation, office_location)
      `)
      .eq('role', 'mentor')
      .eq('is_active', true)
      .order('name');

    // 2. Get active students
    const { data: students } = await admin
      .from('profiles')
      .select(`
        id,
        name,
        email,
        student_details(roll_number, branch, semester, division, cohort:cohorts(name))
      `)
      .eq('role', 'student')
      .eq('is_active', true)
      .order('name');

    // 3. Get active assignments for this term
    const { data: assignments } = await admin
      .from('mentor_assignments')
      .select(`
        id,
        mentor_id,
        student_id,
        assigned_date,
        notes,
        is_active
      `)
      .eq('academic_term_id', activeTerm.id)
      .eq('is_active', true);

    const studentMap = new Map((students || []).map((s) => [s.id, s]));
    const mentorMap = new Map((mentors || []).map((m) => [m.id, m]));

    const assignedStudentIds = new Set<string>();
    const mentorAllocations = new Map<string, any[]>();

    (assignments || []).forEach((asgn: any) => {
      assignedStudentIds.add(asgn.student_id);
      const student = studentMap.get(asgn.student_id) as any;
      const stdDetails = (Array.isArray(student?.student_details)
        ? student?.student_details[0]
        : student?.student_details) as any;

      const list = mentorAllocations.get(asgn.mentor_id) || [];
      list.push({
        assignmentId: asgn.id,
        studentId: asgn.student_id,
        name: student?.name || 'Unknown Student',
        email: student?.email || '',
        rollNumber: stdDetails?.roll_number || 'N/A',
        branch: stdDetails?.branch || 'CSE',
        semester: stdDetails?.semester || 1,
        division: stdDetails?.division || 'A',
        cohortName: stdDetails?.cohort?.name || 'Unassigned',
        assignedDate: asgn.assigned_date,
        notes: asgn.notes,
      });
      mentorAllocations.set(asgn.mentor_id, list);
    });

    const mentorsList = (mentors || []).map((m: any) => {
      const details = m.mentor_details?.[0] || m.mentor_details;
      const assigned = mentorAllocations.get(m.id) || [];
      return {
        id: m.id,
        name: m.name,
        email: m.email,
        employeeId: details?.employee_id || 'N/A',
        department: details?.department || 'Computer Science & Engineering',
        designation: details?.designation || 'Faculty Advisor',
        officeLocation: details?.office_location || '',
        assignedCount: assigned.length,
        assignedMentees: assigned,
      };
    });

    const unassignedStudents = (students || [])
      .filter((s) => !assignedStudentIds.has(s.id))
      .map((s: any) => {
        const details = s.student_details?.[0] || s.student_details;
        return {
          id: s.id,
          name: s.name,
          email: s.email,
          rollNumber: details?.roll_number || 'N/A',
          branch: details?.branch || 'CSE',
          semester: details?.semester || 1,
          division: details?.division || 'A',
          cohortName: details?.cohort?.name || 'Unassigned',
        };
      });

    res.json({
      term: activeTerm,
      mentors: mentorsList,
      unassignedStudents,
      stats: {
        totalAssigned: assignedStudentIds.size,
        totalUnassigned: unassignedStudents.length,
        totalMentors: mentorsList.length,
      },
    });
  } catch (err: unknown) {
    console.error('[AdminAllocations] Error fetching allocations:', err);
    res.status(500).json({ error: 'Failed to retrieve mentor allocations.' });
  }
});

router.post('/allocations/assign', async (req: AdminRequest, res: Response): Promise<void> => {
  const admin = supabaseAdmin!;
  const { studentIds, mentorId, academicTermId, notes } = req.body;

  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    res.status(400).json({ error: 'Please select at least one student to assign.' });
    return;
  }
  if (!mentorId) {
    res.status(400).json({ error: 'A mentor must be selected.' });
    return;
  }
  if (!academicTermId) {
    res.status(400).json({ error: 'An academic term must be specified.' });
    return;
  }

  try {
    // 1. Verify mentor is active
    const { data: mentor, error: mentorErr } = await admin
      .from('profiles')
      .select('id, name, is_active, role')
      .eq('id', mentorId)
      .maybeSingle();

    if (mentorErr || !mentor || mentor.role !== 'mentor' || !mentor.is_active) {
      res.status(400).json({ error: 'Selected mentor is invalid or inactive.' });
      return;
    }

    // 2. Process assignments transactionally / sequentially
    const token = getReqToken(req);
    const userClient = getAdminUserClient(token);
    const createdAssignments: string[] = [];

    for (const studentId of studentIds) {
      // Reassign deactivating any active assignment for this student & term
      const { data: newId, error: rpcErr } = await userClient.rpc('reassign_mentor', {
        p_student_id: studentId,
        p_new_mentor_id: mentorId,
        p_academic_term_id: academicTermId,
        p_notes: notes || null,
      });

      if (rpcErr) {
        // Fallback: direct update & insert if rpc security context differs
        await admin
          .from('mentor_assignments')
          .update({ is_active: false })
          .eq('student_id', studentId)
          .eq('academic_term_id', academicTermId)
          .eq('is_active', true);

        const { data: directInsert, error: directErr } = await admin
          .from('mentor_assignments')
          .insert({
            student_id: studentId,
            mentor_id: mentorId,
            academic_term_id: academicTermId,
            assigned_date: new Date().toISOString().split('T')[0],
            is_active: true,
            notes: notes || null,
          })
          .select('id')
          .single();

        if (directErr) throw directErr;
        createdAssignments.push(directInsert.id);
      } else {
        createdAssignments.push(newId);
      }
    }

    res.status(201).json({
      message: `Successfully allocated ${createdAssignments.length} student(s) to ${mentor.name}.`,
      assignedCount: createdAssignments.length,
    });
  } catch (err: unknown) {
    console.error('[AdminAssign] Error executing mentor allocation:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to allocate mentor assignments.',
    });
  }
});

router.post('/allocations/reassign', async (req: AdminRequest, res: Response): Promise<void> => {
  const admin = supabaseAdmin!;
  const { studentId, newMentorId, academicTermId, notes } = req.body;

  if (!studentId || !newMentorId || !academicTermId) {
    res.status(400).json({ error: 'studentId, newMentorId, and academicTermId are all required.' });
    return;
  }

  try {
    const token = getReqToken(req);
    const userClient = getAdminUserClient(token);

    const { data: newAssignmentId, error: rpcError } = await userClient.rpc('reassign_mentor', {
      p_student_id: studentId,
      p_new_mentor_id: newMentorId,
      p_academic_term_id: academicTermId,
      p_notes: notes || null,
    });

    if (rpcError) {
      // Fallback direct execution
      await admin
        .from('mentor_assignments')
        .update({ is_active: false })
        .eq('student_id', studentId)
        .eq('academic_term_id', academicTermId)
        .eq('is_active', true);

      const { data: newAsgn, error: insertError } = await admin
        .from('mentor_assignments')
        .insert({
          student_id: studentId,
          mentor_id: newMentorId,
          academic_term_id: academicTermId,
          assigned_date: new Date().toISOString().split('T')[0],
          is_active: true,
          notes: notes || null,
        })
        .select('id')
        .single();

      if (insertError) throw insertError;

      res.json({
        message: 'Mentor reassignment completed successfully.',
        assignmentId: newAsgn.id,
      });
      return;
    }

    res.json({
      message: 'Mentor reassignment completed successfully via stored procedure.',
      assignmentId: newAssignmentId,
    });
  } catch (err: unknown) {
    console.error('[AdminReassign] Error reassigning mentor:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to reassign mentor.',
    });
  }
});

router.delete('/allocations/:id', async (req: AdminRequest, res: Response): Promise<void> => {
  const admin = supabaseAdmin!;
  const assignmentId = req.params.id;

  try {
    const { error } = await admin
      .from('mentor_assignments')
      .update({ is_active: false })
      .eq('id', assignmentId);

    if (error) throw error;

    res.json({ message: 'Assignment successfully deactivated.' });
  } catch (err: unknown) {
    console.error('[AdminDeleteAllocation] Error removing assignment:', err);
    res.status(500).json({ error: 'Failed to deactivate assignment.' });
  }
});

// ============================================================================
// 6. ACADEMIC MANAGEMENT (TERMS & COHORTS)
// ============================================================================
router.get('/academic/terms', async (_req: AdminRequest, res: Response): Promise<void> => {
  try {
    const admin = supabaseAdmin!;
    const { data: terms, error } = await admin
      .from('academic_terms')
      .select('*')
      .order('start_date', { ascending: false });

    if (error) throw error;

    // Get active assignment count per term
    const { data: assignments } = await admin
      .from('mentor_assignments')
      .select('academic_term_id')
      .eq('is_active', true);

    const termAssignmentCounts = new Map<string, number>();
    (assignments || []).forEach((a) => {
      termAssignmentCounts.set(a.academic_term_id, (termAssignmentCounts.get(a.academic_term_id) || 0) + 1);
    });

    const enriched = (terms || []).map((t) => ({
      ...t,
      activeAssignmentsCount: termAssignmentCounts.get(t.id) || 0,
    }));

    res.json({ terms: enriched });
  } catch (err: unknown) {
    console.error('[AdminTerms] Error listing academic terms:', err);
    res.status(500).json({ error: 'Failed to retrieve academic terms.' });
  }
});

router.post('/academic/terms', async (req: AdminRequest, res: Response): Promise<void> => {
  const admin = supabaseAdmin!;
  const { code, name, startDate, endDate, isCurrent = false } = req.body;

  if (!code || !code.trim()) {
    res.status(400).json({ error: 'Term code (e.g. AY24-25-S6) is required.' });
    return;
  }
  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Term display name is required.' });
    return;
  }
  if (!startDate || !endDate) {
    res.status(400).json({ error: 'Start date and end date are required.' });
    return;
  }
  if (new Date(endDate) < new Date(startDate)) {
    res.status(400).json({ error: 'End date must be greater than or equal to start date.' });
    return;
  }

  const cleanCode = code.trim().toUpperCase();

  try {
    // If setting as current, reset other terms
    if (isCurrent) {
      await admin.from('academic_terms').update({ is_current: false }).neq('id', '00000000-0000-0000-0000-000000000000');
    }

    const { data: newTerm, error } = await admin
      .from('academic_terms')
      .insert({
        code: cleanCode,
        name: name.trim(),
        start_date: startDate,
        end_date: endDate,
        is_current: Boolean(isCurrent),
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: `An academic term with code '${cleanCode}' already exists.` });
        return;
      }
      throw error;
    }

    res.status(201).json({
      message: 'Academic term created successfully.',
      term: newTerm,
    });
  } catch (err: unknown) {
    console.error('[AdminCreateTerm] Error creating academic term:', err);
    res.status(500).json({ error: 'Failed to create academic term.' });
  }
});

router.patch('/academic/terms/:id/current', async (req: AdminRequest, res: Response): Promise<void> => {
  const admin = supabaseAdmin!;
  const termId = req.params.id;

  try {
    // 1. Unset existing current term(s)
    await admin.from('academic_terms').update({ is_current: false }).neq('id', termId);

    // 2. Set target term as current
    const { data: updatedTerm, error } = await admin
      .from('academic_terms')
      .update({ is_current: true })
      .eq('id', termId)
      .select('*')
      .single();

    if (error || !updatedTerm) {
      res.status(404).json({ error: 'Academic term not found.' });
      return;
    }

    res.json({
      message: `Term '${updatedTerm.name}' set as the active academic term.`,
      term: updatedTerm,
    });
  } catch (err: unknown) {
    console.error('[AdminSetCurrentTerm] Error updating current term:', err);
    res.status(500).json({ error: 'Failed to set current academic term.' });
  }
});

router.get('/academic/cohorts', async (_req: AdminRequest, res: Response): Promise<void> => {
  try {
    const admin = supabaseAdmin!;
    const { data: cohorts, error } = await admin
      .from('cohorts')
      .select('*')
      .order('admission_year', { ascending: false });

    if (error) throw error;

    // Get student count per cohort
    const { data: students } = await admin
      .from('student_details')
      .select('cohort_id')
      .not('cohort_id', 'is', null);

    const cohortCounts = new Map<string, number>();
    (students || []).forEach((s) => {
      if (s.cohort_id) {
        cohortCounts.set(s.cohort_id, (cohortCounts.get(s.cohort_id) || 0) + 1);
      }
    });

    const enriched = (cohorts || []).map((c) => ({
      ...c,
      studentCount: cohortCounts.get(c.id) || 0,
    }));

    res.json({ cohorts: enriched });
  } catch (err: unknown) {
    console.error('[AdminCohorts] Error retrieving cohorts:', err);
    res.status(500).json({ error: 'Failed to retrieve cohorts.' });
  }
});

router.post('/academic/cohorts', async (req: AdminRequest, res: Response): Promise<void> => {
  const admin = supabaseAdmin!;
  const {
    code,
    name,
    department = 'Department of Computer Science & Engineering',
    admissionYear,
    graduationYear,
  } = req.body;

  if (!code || !code.trim()) {
    res.status(400).json({ error: 'Cohort code (e.g. CSE-A-2023-2027) is required.' });
    return;
  }
  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Cohort display name is required.' });
    return;
  }
  if (!admissionYear || !graduationYear) {
    res.status(400).json({ error: 'Admission year and graduation year are required.' });
    return;
  }
  if (Number(graduationYear) < Number(admissionYear)) {
    res.status(400).json({ error: 'Graduation year cannot precede admission year.' });
    return;
  }

  const cleanCode = code.trim().toUpperCase();

  try {
    const { data: newCohort, error } = await admin
      .from('cohorts')
      .insert({
        code: cleanCode,
        name: name.trim(),
        department: department.trim(),
        admission_year: Number(admissionYear),
        graduation_year: Number(graduationYear),
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: `Cohort with code '${cleanCode}' already exists.` });
        return;
      }
      throw error;
    }

    res.status(201).json({
      message: 'Cohort created successfully.',
      cohort: newCohort,
    });
  } catch (err: unknown) {
    console.error('[AdminCreateCohort] Error creating cohort:', err);
    res.status(500).json({ error: 'Failed to create cohort.' });
  }
});

export default router;

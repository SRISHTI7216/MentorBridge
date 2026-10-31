-- ==============================================================================
-- Migration: 20261030_000002_enable_rls.sql
-- Description: Row Level Security (RLS) Policies and Access Control for MentorBridge
-- Enforces:
-- 1. Students access only their own permitted records.
-- 2. Mentors access only assigned mentees and permitted data.
-- 3. Mentors cannot assign themselves students or change roles.
-- 4. Administrators manage authorized institutional records.
-- 5. Role modifications strictly guarded against client-side tampering.
-- ==============================================================================

-- 1. Helper Security Functions (SECURITY DEFINER with strict search_path)
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active = true LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_mentor_for_student(student_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mentor_assignments
    WHERE mentor_id = auth.uid()
      AND student_id = student_uuid
      AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_student_for_mentor(mentor_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mentor_assignments
    WHERE student_id = auth.uid()
      AND mentor_id = mentor_uuid
      AND is_active = true
  );
$$;

-- 2. Prevent role tampering and privilege escalation
CREATE OR REPLACE FUNCTION public.prevent_role_or_active_tampering()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.is_active IS DISTINCT FROM OLD.is_active) THEN
    IF NOT public.is_admin() AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized: Only institutional administrators can modify user roles or active status.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS enforce_role_integrity ON public.profiles;
CREATE TRIGGER enforce_role_integrity
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_role_or_active_tampering();

-- 3. Explicit Reassignment Procedure
CREATE OR REPLACE FUNCTION public.reassign_mentor(
  p_student_id UUID,
  p_new_mentor_id UUID,
  p_academic_term_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_new_assignment_id UUID;
BEGIN
  IF NOT public.is_admin() AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied: Only institutional administrators can reassign mentors.';
  END IF;

  -- Verify target mentor has role 'mentor'
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_new_mentor_id AND role = 'mentor' AND is_active = true) THEN
    RAISE EXCEPTION 'Invalid mentor: Specified user is not an active faculty mentor.';
  END IF;

  -- 1. Deactivate existing active assignment for this student in this term
  UPDATE public.mentor_assignments
  SET is_active = false,
      updated_at = timezone('utc'::text, now())
  WHERE student_id = p_student_id
    AND academic_term_id = p_academic_term_id
    AND is_active = true;

  -- 2. Insert new assignment
  INSERT INTO public.mentor_assignments (
    mentor_id,
    student_id,
    academic_term_id,
    assigned_date,
    is_active,
    notes
  ) VALUES (
    p_new_mentor_id,
    p_student_id,
    p_academic_term_id,
    CURRENT_DATE,
    true,
    p_notes
  ) RETURNING id INTO v_new_assignment_id;

  RETURN v_new_assignment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- ENABLE ROW LEVEL SECURITY
-- ==============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_assignments ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- POLICIES: profiles
-- ==============================================================================
-- Admin has full access
CREATE POLICY "admin_all_profiles"
  ON public.profiles
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- User can view their own profile
CREATE POLICY "user_view_own_profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- Mentors can view profiles of their actively assigned mentees
CREATE POLICY "mentor_view_assigned_mentee_profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_active_mentor_for_student(id));

-- Students can view the profile of their actively assigned mentor
CREATE POLICY "student_view_assigned_mentor_profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_active_student_for_mentor(id));

-- Faculty mentors are visible to all authenticated students for advising directory
CREATE POLICY "authenticated_view_mentor_profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (role = 'mentor' AND is_active = true);

-- Users can update their own profile name and avatar (role change guarded by trigger)
CREATE POLICY "user_update_own_profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ==============================================================================
-- POLICIES: student_details
-- ==============================================================================
CREATE POLICY "admin_all_student_details"
  ON public.student_details
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Student views only their own details
CREATE POLICY "student_view_own_details"
  ON public.student_details
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

-- Mentor views student details ONLY for assigned active mentees
CREATE POLICY "mentor_view_assigned_mentee_details"
  ON public.student_details
  FOR SELECT
  TO authenticated
  USING (public.is_active_mentor_for_student(profile_id));

-- Note: No INSERT/UPDATE/DELETE policies for students or mentors on student_details.

-- ==============================================================================
-- POLICIES: mentor_details
-- ==============================================================================
CREATE POLICY "admin_all_mentor_details"
  ON public.mentor_details
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- All authenticated users can view faculty mentor directory details
CREATE POLICY "authenticated_view_mentor_details"
  ON public.mentor_details
  FOR SELECT
  TO authenticated
  USING (true);

-- Mentors can update their own office location, hours, and specializations
CREATE POLICY "mentor_update_own_details"
  ON public.mentor_details
  FOR UPDATE
  TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- ==============================================================================
-- POLICIES: academic_terms & cohorts
-- ==============================================================================
CREATE POLICY "admin_all_academic_terms"
  ON public.academic_terms
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "authenticated_view_academic_terms"
  ON public.academic_terms
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admin_all_cohorts"
  ON public.cohorts
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "authenticated_view_cohorts"
  ON public.cohorts
  FOR SELECT
  TO authenticated
  USING (true);

-- ==============================================================================
-- POLICIES: mentor_assignments
-- ==============================================================================
CREATE POLICY "admin_all_assignments"
  ON public.mentor_assignments
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Mentors view only assignments where they are the assigned mentor
CREATE POLICY "mentor_view_own_assignments"
  ON public.mentor_assignments
  FOR SELECT
  TO authenticated
  USING (mentor_id = auth.uid());

-- Students view only assignments where they are the assigned mentee
CREATE POLICY "student_view_own_assignments"
  ON public.mentor_assignments
  FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

-- Mentors and students CANNOT insert, update, or delete assignments.
-- Assignment creation and reassignment must be performed by admin or via reassign_mentor().


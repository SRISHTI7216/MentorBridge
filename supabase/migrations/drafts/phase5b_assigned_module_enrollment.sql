-- DRAFT ONLY — review and apply only after the Phase 5A learning schema exists.
-- Adds the backend-only enrollment operation required by service-role APIs.
-- No SQL has been executed by this proposal.

CREATE OR REPLACE FUNCTION public.enroll_in_assigned_module(
  p_module_id UUID,
  p_assignment_id UUID,
  p_target_student_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_module public.learning_modules%ROWTYPE;
  v_assignment public.module_assignments%ROWTYPE;
  v_mentor_allocation public.mentor_assignments%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_student_detail public.student_details%ROWTYPE;
  v_term public.academic_terms%ROWTYPE;
  v_enrollment public.student_module_enrollments%ROWTYPE;
  v_enrollment_id UUID;
  v_total_lessons INTEGER;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Assigned enrollment is available only to the authorized backend service.';
  END IF;
  IF p_module_id IS NULL OR p_assignment_id IS NULL OR p_target_student_id IS NULL THEN
    RAISE EXCEPTION 'Module, assignment, and student identifiers are required.';
  END IF;

  SELECT * INTO v_module FROM public.learning_modules WHERE id = p_module_id FOR SHARE;
  IF NOT FOUND OR v_module.status <> 'published' THEN
    RAISE EXCEPTION 'Assigned enrollment requires an existing published module.';
  END IF;
  SELECT * INTO v_assignment FROM public.module_assignments
  WHERE id = p_assignment_id
    AND module_id = p_module_id
    AND student_id = p_target_student_id
    AND academic_term_id = v_module.academic_term_id
    AND status = 'assigned'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A matching active assignment for this student and module is required.';
  END IF;

  -- The assignment's original mentor must still have the active allocation
  -- for this exact student and term. Lock it against concurrent deactivation
  -- until the enrollment transaction completes. `is_active` is the schema's
  -- allocation status column; mentor_assignments has no status enum.
  SELECT * INTO v_mentor_allocation FROM public.mentor_assignments
  WHERE mentor_id = v_assignment.mentor_id
    AND student_id = p_target_student_id
    AND academic_term_id = v_module.academic_term_id
    AND is_active = true
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The assignment mentor no longer has an active allocation for this student and academic term.';
  END IF;

  SELECT * INTO v_profile FROM public.profiles
  WHERE id = p_target_student_id AND role = 'student' AND is_active = true
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target user is not an active student.'; END IF;
  SELECT * INTO v_student_detail FROM public.student_details WHERE profile_id = p_target_student_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student academic profile was not found.'; END IF;
  SELECT * INTO v_term FROM public.academic_terms
  WHERE id = v_module.academic_term_id AND is_current = true
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assigned enrollment requires the current academic term.'; END IF;
  IF v_student_detail.semester <> v_module.semester THEN
    RAISE EXCEPTION 'Student semester does not match the module semester.';
  END IF;
  IF v_module.target_cohort_id IS NOT NULL AND v_student_detail.cohort_id IS DISTINCT FROM v_module.target_cohort_id THEN
    RAISE EXCEPTION 'Student cohort does not match the module target cohort.';
  END IF;

  -- Never convert an existing institutional enrollment or bind it to a new assignment.
  SELECT * INTO v_enrollment FROM public.student_module_enrollments
  WHERE module_id = p_module_id AND student_id = p_target_student_id FOR UPDATE;
  IF FOUND THEN
    IF v_enrollment.assignment_id = p_assignment_id AND v_enrollment.enrollment_type = 'assigned' THEN
      RETURN v_enrollment.id;
    END IF;
    RAISE EXCEPTION 'An enrollment already exists for this module from a different source.';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_total_lessons
  FROM public.module_lessons WHERE module_id = p_module_id;
  INSERT INTO public.student_module_enrollments (
    module_id, student_id, assignment_id, enrollment_type, status,
    completed_lessons_count, total_lessons_count, progress_percentage
  ) VALUES (
    p_module_id, p_target_student_id, p_assignment_id, 'assigned', 'in_progress',
    0, v_total_lessons, 0.0
  )
  ON CONFLICT (module_id, student_id) DO NOTHING
  RETURNING id INTO v_enrollment_id;

  IF v_enrollment_id IS NOT NULL THEN RETURN v_enrollment_id; END IF;
  -- A concurrent retry may have won. Return only if it created this exact binding.
  SELECT * INTO v_enrollment FROM public.student_module_enrollments
  WHERE module_id = p_module_id AND student_id = p_target_student_id
  FOR UPDATE;
  IF FOUND AND v_enrollment.assignment_id = p_assignment_id AND v_enrollment.enrollment_type = 'assigned' THEN
    RETURN v_enrollment.id;
  END IF;
  RAISE EXCEPTION 'An enrollment already exists for this module from a different source.';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enroll_in_assigned_module(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_in_assigned_module(UUID, UUID, UUID) TO service_role;

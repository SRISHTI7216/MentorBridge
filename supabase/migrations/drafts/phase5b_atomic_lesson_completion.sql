-- DRAFT ONLY: Phase 5B atomic lesson completion and enrollment progress refresh.
-- Review and apply separately before enabling POST .../lessons/:lessonId/complete.
-- This function is intentionally service_role-only; callers must derive the
-- target student from the authenticated Express request.

CREATE OR REPLACE FUNCTION public.complete_module_lesson(
  p_module_id UUID,
  p_lesson_id UUID,
  p_student_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_enrollment public.student_module_enrollments%ROWTYPE;
  v_module_status TEXT;
  v_total INTEGER;
  v_completed INTEGER;
  v_required_total INTEGER;
  v_required_completed INTEGER;
  v_percent NUMERIC(5,2);
  v_completed_at TIMESTAMPTZ;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied: service role required.';
  END IF;

  IF p_module_id IS NULL OR p_lesson_id IS NULL OR p_student_id IS NULL THEN
    RAISE EXCEPTION 'Completion rejected: module, lesson, and authenticated student are required.';
  END IF;

  SELECT status INTO v_module_status
  FROM public.learning_modules WHERE id = p_module_id;
  IF v_module_status IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'Completion rejected: module is not published.';
  END IF;

  SELECT * INTO v_enrollment
  FROM public.student_module_enrollments
  WHERE module_id = p_module_id AND student_id = p_student_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Completion rejected: student enrollment not found.';
  END IF;

  -- Phase 5A permits in_progress, completed, and archived enrollments.
  -- Completed enrollments may still complete optional lessons and safely retry
  -- an existing completion; archived enrollments are closed to new completions.
  IF v_enrollment.status NOT IN ('in_progress', 'completed') THEN
    RAISE EXCEPTION 'Completion rejected: enrollment is not open for lesson completions.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.module_lessons
    WHERE id = p_lesson_id AND module_id = p_module_id
  ) THEN
    RAISE EXCEPTION 'Completion rejected: lesson does not belong to module.';
  END IF;

  INSERT INTO public.lesson_completions (enrollment_id, module_id, lesson_id, student_id)
  VALUES (v_enrollment.id, p_module_id, p_lesson_id, p_student_id)
  ON CONFLICT (enrollment_id, lesson_id) DO NOTHING;

  SELECT completed_at INTO v_completed_at FROM public.lesson_completions
  WHERE enrollment_id = v_enrollment.id AND lesson_id = p_lesson_id;

  SELECT COUNT(*)::INTEGER INTO v_total FROM public.module_lessons WHERE module_id = p_module_id;
  SELECT COUNT(*)::INTEGER INTO v_completed FROM public.lesson_completions
  WHERE enrollment_id = v_enrollment.id AND module_id = p_module_id;

  SELECT COUNT(*)::INTEGER INTO v_required_total FROM public.module_lessons
  WHERE module_id = p_module_id AND is_mandatory = true;
  IF v_required_total = 0 THEN
    SELECT COUNT(*)::INTEGER INTO v_required_total FROM public.module_lessons WHERE module_id = p_module_id;
    SELECT COUNT(*)::INTEGER INTO v_required_completed
    FROM public.lesson_completions lc JOIN public.module_lessons ml ON ml.id = lc.lesson_id
    WHERE lc.enrollment_id = v_enrollment.id AND ml.module_id = p_module_id;
  ELSE
    SELECT COUNT(*)::INTEGER INTO v_required_completed
    FROM public.lesson_completions lc JOIN public.module_lessons ml ON ml.id = lc.lesson_id
    WHERE lc.enrollment_id = v_enrollment.id AND ml.module_id = p_module_id AND ml.is_mandatory = true;
  END IF;

  v_percent := CASE WHEN v_required_total = 0 THEN 0
    ELSE ROUND((v_required_completed::NUMERIC / v_required_total) * 100, 2) END;

  UPDATE public.student_module_enrollments
  SET completed_lessons_count = v_completed,
      total_lessons_count = v_total,
      progress_percentage = v_percent,
      status = CASE WHEN v_required_total > 0 AND v_required_completed = v_required_total
        THEN 'completed' ELSE 'in_progress' END,
      completed_at = CASE WHEN v_required_total > 0 AND v_required_completed = v_required_total
        THEN COALESCE(completed_at, now()) ELSE NULL END,
      last_accessed_at = now()
  WHERE id = v_enrollment.id;

  RETURN jsonb_build_object(
    'enrollmentId', v_enrollment.id,
    'lessonId', p_lesson_id,
    'completedAt', v_completed_at,
    'completedLessonsCount', v_completed,
    'totalLessonsCount', v_total,
    'requiredLessonsCount', v_required_total,
    'requiredLessonsCompleted', v_required_completed,
    'progressPercentage', v_percent,
    'status', CASE WHEN v_required_total > 0 AND v_required_completed = v_required_total
      THEN 'completed' ELSE 'in_progress' END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_module_lesson(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_module_lesson(UUID, UUID, UUID) TO service_role;

-- ==============================================================================
-- Migration: 20261101_000005_enable_assessment_rls.sql
-- Description: Row Level Security (RLS) Policies for Phase 3B Assessment Engine
-- ==============================================================================

-- 1. Enable RLS on all assessment tables
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_answers ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- POLICIES: assessments
-- ------------------------------------------------------------------------------

-- Admin has complete access
CREATE POLICY "admin_all_assessments"
  ON public.assessments FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Mentors have full access to assessments they authored
CREATE POLICY "mentor_manage_own_assessments"
  ON public.assessments FOR ALL TO authenticated
  USING (mentor_id = auth.uid())
  WITH CHECK (mentor_id = auth.uid());

-- Students can view published assessments assigned to them
CREATE POLICY "student_view_assigned_assessments"
  ON public.assessments FOR SELECT TO authenticated
  USING (
    status IN ('published', 'completed')
    AND EXISTS (
      SELECT 1 FROM public.assessment_assignments aa
      WHERE aa.assessment_id = id
        AND aa.student_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------------------
-- POLICIES: assessment_questions
-- ------------------------------------------------------------------------------

CREATE POLICY "admin_all_assessment_questions"
  ON public.assessment_questions FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "mentor_manage_assessment_questions"
  ON public.assessment_questions FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.assessments a
      WHERE a.id = assessment_id AND a.mentor_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.assessments a
      WHERE a.id = assessment_id AND a.mentor_id = auth.uid()
    )
  );

CREATE POLICY "student_view_assessment_questions"
  ON public.assessment_questions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.assessments a
      JOIN public.assessment_assignments aa ON aa.assessment_id = a.id
      WHERE a.id = assessment_id
        AND aa.student_id = auth.uid()
        AND a.status IN ('published', 'completed')
        AND a.start_time <= now()
    )
  );

-- ------------------------------------------------------------------------------
-- POLICIES: assessment_options
-- ------------------------------------------------------------------------------

CREATE POLICY "admin_all_assessment_options"
  ON public.assessment_options FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "mentor_manage_assessment_options"
  ON public.assessment_options FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.assessment_questions q
      JOIN public.assessments a ON a.id = q.assessment_id
      WHERE q.id = question_id AND a.mentor_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.assessment_questions q
      JOIN public.assessments a ON a.id = q.assessment_id
      WHERE q.id = question_id AND a.mentor_id = auth.uid()
    )
  );

CREATE POLICY "student_view_assessment_options"
  ON public.assessment_options FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.assessment_questions q
      JOIN public.assessments a ON a.id = q.assessment_id
      JOIN public.assessment_assignments aa ON aa.assessment_id = a.id
      WHERE q.id = question_id
        AND aa.student_id = auth.uid()
        AND a.status IN ('published', 'completed')
        AND a.start_time <= now()
    )
  );

-- ------------------------------------------------------------------------------
-- POLICIES: assessment_assignments
-- ------------------------------------------------------------------------------

CREATE POLICY "admin_all_assessment_assignments"
  ON public.assessment_assignments FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "mentor_manage_assessment_assignments"
  ON public.assessment_assignments FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.assessments a
      WHERE a.id = assessment_id AND a.mentor_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.assessments a
      WHERE a.id = assessment_id AND a.mentor_id = auth.uid()
    )
  );

CREATE POLICY "student_view_own_assignments"
  ON public.assessment_assignments FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- ------------------------------------------------------------------------------
-- POLICIES: assessment_attempts
-- ------------------------------------------------------------------------------

CREATE POLICY "admin_all_assessment_attempts"
  ON public.assessment_attempts FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "mentor_manage_assessment_attempts"
  ON public.assessment_attempts FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.assessments a
      WHERE a.id = assessment_id AND a.mentor_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.assessments a
      WHERE a.id = assessment_id AND a.mentor_id = auth.uid()
    )
  );

CREATE POLICY "student_manage_own_attempts"
  ON public.assessment_attempts FOR ALL TO authenticated
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

-- ------------------------------------------------------------------------------
-- POLICIES: assessment_answers
-- ------------------------------------------------------------------------------

CREATE POLICY "admin_all_assessment_answers"
  ON public.assessment_answers FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "mentor_manage_assessment_answers"
  ON public.assessment_answers FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.assessment_attempts att
      JOIN public.assessments a ON a.id = att.assessment_id
      WHERE att.id = attempt_id AND a.mentor_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.assessment_attempts att
      JOIN public.assessments a ON a.id = att.assessment_id
      WHERE att.id = attempt_id AND a.mentor_id = auth.uid()
    )
  );

CREATE POLICY "student_manage_own_answers"
  ON public.assessment_answers FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.assessment_attempts att
      WHERE att.id = attempt_id
        AND att.student_id = auth.uid()
        AND att.status = 'in_progress'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.assessment_attempts att
      WHERE att.id = attempt_id
        AND att.student_id = auth.uid()
        AND att.status = 'in_progress'
    )
  );

CREATE POLICY "student_view_submitted_answers"
  ON public.assessment_answers FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.assessment_attempts att
      WHERE att.id = attempt_id
        AND att.student_id = auth.uid()
    )
  );


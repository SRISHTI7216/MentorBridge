-- ==============================================================================
-- Migration: 20261101_000004_create_assessment_schema.sql
-- Description: Core Schema for Phase 3B Weekly Assessment Engine
-- Entities: assessments, assessment_questions, assessment_options,
--           assessment_assignments, assessment_attempts, assessment_answers
-- ==============================================================================

-- 1. Assessments Table
CREATE TABLE IF NOT EXISTS public.assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  academic_term_id UUID NOT NULL REFERENCES public.academic_terms(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  subject TEXT NOT NULL, -- e.g., 'DSA', 'DBMS', 'OS', 'System Design', 'Networks'
  topic TEXT NOT NULL,   -- weekly curriculum topic
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
  total_marks NUMERIC(6, 2) NOT NULL DEFAULT 0.0 CHECK (total_marks >= 0),
  passing_marks NUMERIC(6, 2) DEFAULT 0.0 CHECK (passing_marks >= 0),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  allowed_attempts INTEGER NOT NULL DEFAULT 1 CHECK (allowed_attempts >= 1),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'completed', 'archived')),
  is_results_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT check_assessment_times CHECK (end_time >= start_time)
);

CREATE TRIGGER update_assessments_timestamp
  BEFORE UPDATE ON public.assessments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 2. Assessment Questions Table
CREATE TABLE IF NOT EXISTS public.assessment_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  question_order INTEGER NOT NULL DEFAULT 1,
  question_type TEXT NOT NULL CHECK (question_type IN ('mcq', 'descriptive')),
  question_text TEXT NOT NULL,
  marks NUMERIC(5, 2) NOT NULL DEFAULT 1.0 CHECK (marks > 0),
  evaluation_guidance TEXT, -- evaluation criteria / rubrics for mentors
  explanation TEXT,         -- pedagogical explanation shown to students after result publication
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TRIGGER update_assessment_questions_timestamp
  BEFORE UPDATE ON public.assessment_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 3. Assessment Options Table (For MCQ Question Types)
CREATE TABLE IF NOT EXISTS public.assessment_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.assessment_questions(id) ON DELETE CASCADE,
  option_order INTEGER NOT NULL DEFAULT 1,
  option_text TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. Assessment Assignments Table (Maps which students can access the assessment)
CREATE TABLE IF NOT EXISTS public.assessment_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cohort_id UUID REFERENCES public.cohorts(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT unique_assessment_student_assignment UNIQUE (assessment_id, student_id)
);

-- 5. Assessment Attempts Table (Tracks student exam sessions)
CREATE TABLE IF NOT EXISTS public.assessment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  submitted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'evaluated', 'abandoned')),
  mcq_score NUMERIC(6, 2) DEFAULT 0.0 CHECK (mcq_score >= 0),
  descriptive_score NUMERIC(6, 2) DEFAULT 0.0 CHECK (descriptive_score >= 0),
  total_score NUMERIC(6, 2) DEFAULT 0.0 CHECK (total_score >= 0),
  is_evaluated BOOLEAN NOT NULL DEFAULT false,
  evaluated_at TIMESTAMPTZ,
  evaluated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  general_feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT unique_student_assessment_attempt UNIQUE (assessment_id, student_id, attempt_number)
);

CREATE TRIGGER update_assessment_attempts_timestamp
  BEFORE UPDATE ON public.assessment_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 6. Assessment Answers Table (Student responses per question)
CREATE TABLE IF NOT EXISTS public.assessment_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES public.assessment_attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.assessment_questions(id) ON DELETE CASCADE,
  selected_option_id UUID REFERENCES public.assessment_options(id) ON DELETE SET NULL,
  descriptive_answer TEXT,
  is_correct BOOLEAN, -- auto-graded for MCQ, null for descriptive until graded
  marks_obtained NUMERIC(5, 2) DEFAULT 0.0 CHECK (marks_obtained >= 0),
  mentor_feedback TEXT,
  evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT unique_attempt_question_answer UNIQUE (attempt_id, question_id)
);

CREATE TRIGGER update_assessment_answers_timestamp
  BEFORE UPDATE ON public.assessment_answers
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 7. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_assessments_mentor ON public.assessments(mentor_id);
CREATE INDEX IF NOT EXISTS idx_assessments_term ON public.assessments(academic_term_id);
CREATE INDEX IF NOT EXISTS idx_assessments_status ON public.assessments(status);
CREATE INDEX IF NOT EXISTS idx_assessments_dates ON public.assessments(start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_questions_assessment ON public.assessment_questions(assessment_id);
CREATE INDEX IF NOT EXISTS idx_questions_order ON public.assessment_questions(assessment_id, question_order);

CREATE INDEX IF NOT EXISTS idx_options_question ON public.assessment_options(question_id);

CREATE INDEX IF NOT EXISTS idx_assignments_assessment ON public.assessment_assignments(assessment_id);
CREATE INDEX IF NOT EXISTS idx_assignments_student ON public.assessment_assignments(student_id);

CREATE INDEX IF NOT EXISTS idx_attempts_assessment ON public.assessment_attempts(assessment_id);
CREATE INDEX IF NOT EXISTS idx_attempts_student ON public.assessment_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON public.assessment_attempts(status);

CREATE INDEX IF NOT EXISTS idx_answers_attempt ON public.assessment_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_answers_question ON public.assessment_answers(question_id);


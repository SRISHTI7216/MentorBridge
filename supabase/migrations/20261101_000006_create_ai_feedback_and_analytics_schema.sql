-- ==============================================================================
-- Migration: 20261101_000006_create_ai_feedback_and_analytics_schema.sql
-- Description: Phase 4A Database Preparation:
--   1. Adds results_published_at to public.assessments.
--   2. Creates public.ai_feedback_reports with immediate and weekly support.
--   3. Enforces idempotency and uniqueness constraints (attempt-level & period-level).
--   4. Preserves feedback audit history with non-destructive foreign key behaviors.
--   5. Creates targeted performance indexes for analytics aggregations.
--   6. Enforces Row Level Security (RLS) policies for students, mentors, and admins.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Assessment Publication Timestamp
-- ------------------------------------------------------------------------------
ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS results_published_at TIMESTAMPTZ;

COMMENT ON COLUMN public.assessments.results_published_at IS
  'Timestamp when assessment results were first officially published to students. For historical records created prior to this column, remains NULL unless explicitly updated.';

-- ------------------------------------------------------------------------------
-- 2. AI Feedback Reports Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_feedback_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('immediate', 'weekly')),

  -- Assessment context (nullable for weekly progress summaries)
  assessment_id UUID REFERENCES public.assessments(id) ON DELETE SET NULL,
  attempt_id UUID REFERENCES public.assessment_attempts(id) ON DELETE RESTRICT,

  -- Academic term & date window (required for weekly summaries, nullable for immediate)
  academic_term_id UUID REFERENCES public.academic_terms(id) ON DELETE RESTRICT,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,

  -- Lifecycle and generation status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped_insufficient_data')),

  -- Pedagogical feedback payload
  summary TEXT,
  strengths TEXT[] DEFAULT '{}',
  weaknesses TEXT[] DEFAULT '{}',
  recommended_actions TEXT[] DEFAULT '{}',

  -- AI Provider & Execution Metadata (Zero secrets/keys stored)
  provider TEXT NOT NULL DEFAULT 'openrouter',
  model_name TEXT NOT NULL DEFAULT 'openrouter/free',
  prompt_tokens INTEGER DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER DEFAULT 0 CHECK (completion_tokens >= 0),
  latency_ms INTEGER CHECK (latency_ms >= 0),
  input_snapshot_hash TEXT NOT NULL,

  -- Error tracing and retry tracking
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  -- Field integrity constraints
  CONSTRAINT check_immediate_feedback_attempt
    CHECK (feedback_type <> 'immediate' OR attempt_id IS NOT NULL),
  CONSTRAINT check_weekly_feedback_fields
    CHECK (
      feedback_type <> 'weekly'
      OR (academic_term_id IS NOT NULL AND period_start IS NOT NULL AND period_end IS NOT NULL)
    ),
  CONSTRAINT check_feedback_period_dates
    CHECK (
      period_start IS NULL
      OR period_end IS NULL
      OR period_end >= period_start
    )
);

-- Trigger for auto-updating updated_at on modification
DROP TRIGGER IF EXISTS update_ai_feedback_reports_timestamp ON public.ai_feedback_reports;
CREATE TRIGGER update_ai_feedback_reports_timestamp
  BEFORE UPDATE ON public.ai_feedback_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ------------------------------------------------------------------------------
-- 3. Idempotency & Uniqueness Indexes
-- ------------------------------------------------------------------------------

-- Immediate Feedback Uniqueness:
-- Each attempt can have at most one immediate feedback report per student.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_immediate_feedback_per_attempt
  ON public.ai_feedback_reports (student_id, attempt_id, feedback_type)
  WHERE feedback_type = 'immediate' AND attempt_id IS NOT NULL;

-- Weekly Feedback Uniqueness:
-- A student can have at most one weekly summary for any given term and reporting period.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_weekly_feedback_per_period
  ON public.ai_feedback_reports (student_id, academic_term_id, period_start, period_end, feedback_type)
  WHERE feedback_type = 'weekly' AND academic_term_id IS NOT NULL AND period_start IS NOT NULL AND period_end IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 4. Analytics & AI Feedback Performance Indexes
-- ------------------------------------------------------------------------------

-- AI Feedback Reports indexes
CREATE INDEX IF NOT EXISTS idx_feedback_student_type_status
  ON public.ai_feedback_reports (student_id, feedback_type, status);

CREATE INDEX IF NOT EXISTS idx_feedback_attempt
  ON public.ai_feedback_reports (attempt_id);

CREATE INDEX IF NOT EXISTS idx_feedback_period
  ON public.ai_feedback_reports (period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_feedback_status
  ON public.ai_feedback_reports (status);

-- Assessment Engine indexes for Analytics queries:
-- Fast lookup of student evaluated attempts
CREATE INDEX IF NOT EXISTS idx_attempts_student_eval_status
  ON public.assessment_attempts (student_id, is_evaluated, status);

-- Fast lookup of published assessment results
CREATE INDEX IF NOT EXISTS idx_assessments_results_published
  ON public.assessments (is_results_published, status);

-- Fast aggregation of answers by attempt and correctness/marks
CREATE INDEX IF NOT EXISTS idx_answers_attempt_eval
  ON public.assessment_answers (attempt_id, is_correct, marks_obtained);

-- ------------------------------------------------------------------------------
-- 5. Row Level Security (RLS) Policies for ai_feedback_reports
-- ------------------------------------------------------------------------------

ALTER TABLE public.ai_feedback_reports ENABLE ROW LEVEL SECURITY;

-- 5.1 Admin full access
DROP POLICY IF EXISTS "admin_all_ai_feedback_reports" ON public.ai_feedback_reports;
CREATE POLICY "admin_all_ai_feedback_reports"
  ON public.ai_feedback_reports
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 5.2 Students view only their own completed reports
DROP POLICY IF EXISTS "student_view_own_completed_feedback" ON public.ai_feedback_reports;
CREATE POLICY "student_view_own_completed_feedback"
  ON public.ai_feedback_reports
  FOR SELECT
  TO authenticated
  USING (
    student_id = auth.uid()
    AND status = 'completed'
  );

-- 5.3 Mentors view feedback only for actively assigned mentees
DROP POLICY IF EXISTS "mentor_view_mentee_feedback" ON public.ai_feedback_reports;
CREATE POLICY "mentor_view_mentee_feedback"
  ON public.ai_feedback_reports
  FOR SELECT
  TO authenticated
  USING (
    public.is_active_mentor_for_student(student_id)
  );

-- Note: Direct INSERT, UPDATE, and DELETE operations are disallowed for students
-- and mentors. AI feedback record creation and lifecycle state transitions are
-- strictly performed by authorized backend services utilizing the service role.


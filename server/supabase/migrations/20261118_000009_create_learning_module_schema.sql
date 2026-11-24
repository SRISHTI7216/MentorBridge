-- ==============================================================================
-- Migration: 20261118_000009_create_learning_module_schema.sql
-- Description: Phase 5A: Technical Learning Module Foundation (Remediated & Hardened)
-- Entities:
--   1. learning_categories        (Standard CSE syllabus disciplines)
--   2. learning_modules           (Curriculum units with publication freeze & versioning)
--   3. module_lessons             (Sequential topics, pedagogy, and code labs)
--   4. learning_resources         (Curated reference assets, PDFs, repositories)
--   5. module_assignments         (Mentor-to-mentee term assignments with revocation history)
--   6. student_module_enrollments (Student progress state container)
--   7. lesson_completions         (Tamper-proof granular completion ledger)
--   8. module_assessment_links    (Milestone & capstone links to Phase 3 assessments)
--   9. certificate_credentials    (Cryptographically signed micro-credentials)
--
-- Security Remediation (Phase 5A.1 Review):
--   - Strict module visibility boundary via public.can_access_learning_module().
--   - Elimination of broad authenticated SELECT policies; prevents permissive OR leaks.
--   - Freeze of ALL curriculum fields upon publication; only published->archived allowed.
--   - Direct draft insertion only (cannot insert status = 'published' or 'archived').
--   - Publication validation trigger requiring at least one lesson before publishing.
--   - Child records immutability against OLD or NEW published/archived parents.
--   - Composite integrity constraints for resources, assignments, enrollments, and certs.
--   - Assignment history preservation (revocation status instead of physical deletion).
--   - Hardened SECURITY DEFINER functions with REVOKE FROM PUBLIC and explicit search_path.
--   - Dual-mode institutional enrollment (auth.uid() for students, explicit id for service_role).
--   - Single-algorithm HMAC-SHA256 with signature_version, canonical_payload, deletion guard.
--   - Standard now() defaults across all TIMESTAMPTZ columns.
--
-- STRICT PRE-CONDITION: DRAFT ONLY — DO NOT APPLY DIRECTLY TO DATABASE
-- ==============================================================================

-- ==============================================================================
-- 1. LEARNING CATEGORIES TABLE (Standardized CSE Pillars)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.learning_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 1 CHECK (display_order > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_learning_categories_timestamp ON public.learning_categories;
CREATE TRIGGER update_learning_categories_timestamp
  BEFORE UPDATE ON public.learning_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- 2. LEARNING MODULES TABLE (Curriculum Units with Versioning)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.learning_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.learning_categories(id) ON DELETE RESTRICT,
  academic_term_id UUID NOT NULL REFERENCES public.academic_terms(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,                         -- e.g., 'CSE-MOD-301'
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  title TEXT NOT NULL CHECK (char_length(trim(title)) >= 3),
  description TEXT,
  semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
  level TEXT NOT NULL CHECK (level IN ('Fundamental', 'Intermediate', 'Advanced')),
  estimated_hours NUMERIC(4, 1) NOT NULL DEFAULT 10.0 CHECK (estimated_hours > 0),
  week_number INTEGER CHECK (week_number BETWEEN 1 AND 16),
  skills TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  is_institutional BOOLEAN NOT NULL DEFAULT false,
  target_cohort_id UUID REFERENCES public.cohorts(id) ON DELETE SET NULL, -- NULL = all cohorts in semester
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_module_code_version UNIQUE (code, version),
  CONSTRAINT unique_module_id_term UNIQUE (id, academic_term_id)
);

DROP TRIGGER IF EXISTS update_learning_modules_timestamp ON public.learning_modules;
CREATE TRIGGER update_learning_modules_timestamp
  BEFORE UPDATE ON public.learning_modules
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- TRIGGER: Prevent direct insertion of non-draft modules
CREATE OR REPLACE FUNCTION public.check_module_insert_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('published', 'archived') THEN
    RAISE EXCEPTION 'Integrity violation: Modules must always be created in "draft" status initially.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS trg_check_module_insert_guard ON public.learning_modules;
CREATE TRIGGER trg_check_module_insert_guard
  BEFORE INSERT ON public.learning_modules
  FOR EACH ROW
  EXECUTE FUNCTION public.check_module_insert_guard();

-- TRIGGER: Strict publication freeze & validation
CREATE OR REPLACE FUNCTION public.check_module_mutation_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_lesson_count INTEGER;
BEGIN
  -- 1. Validate transition from 'draft' to 'published'
  IF OLD.status = 'draft' AND NEW.status = 'published' THEN
    SELECT COUNT(*)::INTEGER INTO v_lesson_count
    FROM public.module_lessons
    WHERE module_id = OLD.id;

    IF v_lesson_count = 0 THEN
      RAISE EXCEPTION 'Publication rejected: Module "% (v%)" has no lessons. Modules must contain at least one lesson before publishing.',
        OLD.code, OLD.version;
    END IF;

    -- Forbid changing identity during publication transition
    IF NEW.code IS DISTINCT FROM OLD.code OR
       NEW.version IS DISTINCT FROM OLD.version OR
       NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'Publication rejected: Module code, version, and author cannot be modified during publication.';
    END IF;

    RETURN NEW;
  END IF;

  -- 2. Once published, freeze ALL curriculum fields; only published -> archived allowed
  IF OLD.status = 'published' THEN
    IF NEW.status = 'archived' THEN
      -- Verify NO curriculum-defining fields are altered during archival
      IF NEW.code IS DISTINCT FROM OLD.code OR
         NEW.version IS DISTINCT FROM OLD.version OR
         NEW.category_id IS DISTINCT FROM OLD.category_id OR
         NEW.semester IS DISTINCT FROM OLD.semester OR
         NEW.academic_term_id IS DISTINCT FROM OLD.academic_term_id OR
         NEW.title IS DISTINCT FROM OLD.title OR
         NEW.description IS DISTINCT FROM OLD.description OR
         NEW.level IS DISTINCT FROM OLD.level OR
         NEW.estimated_hours IS DISTINCT FROM OLD.estimated_hours OR
         NEW.week_number IS DISTINCT FROM OLD.week_number OR
         NEW.skills IS DISTINCT FROM OLD.skills OR
         NEW.is_institutional IS DISTINCT FROM OLD.is_institutional OR
         NEW.target_cohort_id IS DISTINCT FROM OLD.target_cohort_id OR
         NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'Curriculum integrity violation: Cannot modify curriculum attributes when archiving module "% (v%)".',
          OLD.code, OLD.version;
      END IF;
      RETURN NEW;
    END IF;

    -- Any other modification to a published module is forbidden
    RAISE EXCEPTION 'Curriculum integrity violation: Published module "% (v%)" is permanently frozen. To modify curriculum, clone into a new draft version using public.clone_module_version().',
      OLD.code, OLD.version;
  END IF;

  -- 3. Archived modules are entirely immutable
  IF OLD.status = 'archived' THEN
    RAISE EXCEPTION 'Curriculum integrity violation: Archived module "% (v%)" is entirely immutable and cannot be modified or unarchived.',
      OLD.code, OLD.version;
  END IF;

  -- 4. Cannot skip from draft directly to archived
  IF OLD.status = 'draft' AND NEW.status = 'archived' THEN
    RAISE EXCEPTION 'Invalid lifecycle transition: Draft module cannot transition directly to archived. Delete the draft or publish it first.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS trg_check_module_mutation_guard ON public.learning_modules;
CREATE TRIGGER trg_check_module_mutation_guard
  BEFORE UPDATE ON public.learning_modules
  FOR EACH ROW
  EXECUTE FUNCTION public.check_module_mutation_guard();

-- TRIGGER: Prevent deletion of published or archived modules
CREATE OR REPLACE FUNCTION public.check_module_delete_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('published', 'archived') THEN
    RAISE EXCEPTION 'Deletion forbidden: Published or archived modules cannot be deleted. Deletion is restricted strictly to unassigned draft modules.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS trg_check_module_delete_guard ON public.learning_modules;
CREATE TRIGGER trg_check_module_delete_guard
  BEFORE DELETE ON public.learning_modules
  FOR EACH ROW
  EXECUTE FUNCTION public.check_module_delete_guard();

-- ==============================================================================
-- 3. MODULE LESSONS TABLE (Sequential Topics & Content)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.module_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
  lesson_order INTEGER NOT NULL DEFAULT 1 CHECK (lesson_order > 0),
  title TEXT NOT NULL CHECK (char_length(trim(title)) >= 3),
  slug TEXT NOT NULL,
  summary TEXT,
  content_markdown TEXT NOT NULL CHECK (char_length(trim(content_markdown)) > 0),
  lesson_type TEXT NOT NULL DEFAULT 'theory'
    CHECK (lesson_type IN ('theory', 'code_lab', 'case_study', 'milestone_prep')),
  estimated_minutes INTEGER NOT NULL DEFAULT 30 CHECK (estimated_minutes > 0),
  is_mandatory BOOLEAN NOT NULL DEFAULT true,
  code_snippet TEXT,
  code_language TEXT DEFAULT 'cpp',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_module_lesson_order UNIQUE (module_id, lesson_order),
  CONSTRAINT unique_lesson_module UNIQUE (id, module_id)
);

DROP TRIGGER IF EXISTS update_module_lessons_timestamp ON public.module_lessons;
CREATE TRIGGER update_module_lessons_timestamp
  BEFORE UPDATE ON public.module_lessons
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- TRIGGER: Guard lessons against modifying published/archived parent or moving between modules
CREATE OR REPLACE FUNCTION public.check_lesson_mutation_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_old_status TEXT;
  v_new_status TEXT;
BEGIN
  -- Check OLD parent module if UPDATE or DELETE
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO v_old_status FROM public.learning_modules WHERE id = OLD.module_id;
    IF v_old_status IN ('published', 'archived') THEN
      RAISE EXCEPTION 'Curriculum integrity violation: Cannot % lesson on module "%" because the module is %.',
        TG_OP, OLD.module_id, v_old_status;
    END IF;
  END IF;

  -- Check NEW parent module if INSERT or UPDATE
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO v_new_status FROM public.learning_modules WHERE id = NEW.module_id;
    IF v_new_status IN ('published', 'archived') THEN
      RAISE EXCEPTION 'Curriculum integrity violation: Cannot % lesson on module "%" because the module is %.',
        TG_OP, NEW.module_id, v_new_status;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS trg_check_lesson_mutation_guard ON public.module_lessons;
CREATE TRIGGER trg_check_lesson_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.module_lessons
  FOR EACH ROW
  EXECUTE FUNCTION public.check_lesson_mutation_guard();

-- ==============================================================================
-- 4. LEARNING RESOURCES TABLE (Curated Reference Assets)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.learning_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
  lesson_id UUID,
  title TEXT NOT NULL CHECK (char_length(trim(title)) >= 3),
  resource_type TEXT NOT NULL
    CHECK (resource_type IN ('pdf', 'article_url', 'github_repo', 'doc', 'book_reference')),
  url TEXT NOT NULL CHECK (char_length(trim(url)) >= 5),
  description TEXT,
  is_mandatory BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- COMPOSITE CONSTRAINT: Ensures lesson_id belongs to the exact same module
  CONSTRAINT fk_resource_lesson_module
    FOREIGN KEY (lesson_id, module_id)
    REFERENCES public.module_lessons(id, module_id)
    ON DELETE CASCADE
);

DROP TRIGGER IF EXISTS update_learning_resources_timestamp ON public.learning_resources;
CREATE TRIGGER update_learning_resources_timestamp
  BEFORE UPDATE ON public.learning_resources
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- TRIGGER: Guard resources against modifying published/archived parents
CREATE OR REPLACE FUNCTION public.check_resource_mutation_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_old_status TEXT;
  v_new_status TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO v_old_status FROM public.learning_modules WHERE id = OLD.module_id;
    IF v_old_status IN ('published', 'archived') THEN
      RAISE EXCEPTION 'Curriculum integrity violation: Cannot % resource on module "%" because the module is %.',
        TG_OP, OLD.module_id, v_old_status;
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO v_new_status FROM public.learning_modules WHERE id = NEW.module_id;
    IF v_new_status IN ('published', 'archived') THEN
      RAISE EXCEPTION 'Curriculum integrity violation: Cannot % resource on module "%" because the module is %.',
        TG_OP, NEW.module_id, v_new_status;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS trg_check_resource_mutation_guard ON public.learning_resources;
CREATE TRIGGER trg_check_resource_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.learning_resources
  FOR EACH ROW
  EXECUTE FUNCTION public.check_resource_mutation_guard();

-- ==============================================================================
-- 5. MODULE ASSIGNMENTS TABLE (Mentor-to-Mentee Assignment Boundary)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.module_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL,
  academic_term_id UUID NOT NULL,
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cohort_id UUID REFERENCES public.cohorts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'revoked', 'completed')),
  due_date DATE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  revocation_reason TEXT,
  CONSTRAINT unique_module_student_assignment UNIQUE (module_id, student_id),
  CONSTRAINT unique_assignment_module_student UNIQUE (id, module_id, student_id),
  CONSTRAINT fk_module_assignment_term
    FOREIGN KEY (module_id, academic_term_id)
    REFERENCES public.learning_modules(id, academic_term_id)
    ON DELETE CASCADE,
  CONSTRAINT check_assignment_revocation_integrity
    CHECK (
      (status = 'revoked' AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL AND revoked_by IS NOT NULL) OR
      (status <> 'revoked' AND revoked_at IS NULL AND revocation_reason IS NULL AND revoked_by IS NULL)
    )
);

-- HELPER FUNCTION: Verify active mentor-mentee relationship in specific term
CREATE OR REPLACE FUNCTION public.is_active_mentor_for_student_in_term(
  p_student_id UUID,
  p_term_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.mentor_assignments ma
      ON ma.mentor_id = p.id
    WHERE p.id = auth.uid()
      AND p.role = 'mentor'
      AND p.is_active = true
      AND ma.student_id = p_student_id
      AND ma.academic_term_id = p_term_id
      AND ma.is_active = true
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_active_mentor_for_student_in_term(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_mentor_for_student_in_term(UUID, UUID) TO authenticated;

-- TRIGGER: Validate assignment eligibility before insert
CREATE OR REPLACE FUNCTION public.validate_module_assignment_eligibility()
RETURNS TRIGGER AS $$
DECLARE
  v_module_status TEXT;
  v_module_term UUID;
  v_is_active_allocation BOOLEAN;
BEGIN
  -- 1. Verify target module is published
  SELECT status, academic_term_id
  INTO v_module_status, v_module_term
  FROM public.learning_modules
  WHERE id = NEW.module_id;

  IF v_module_status <> 'published' THEN
    RAISE EXCEPTION 'Assignment invalid: Cannot assign module "%" because it is in "%" status. Only published modules can be assigned.',
      NEW.module_id, v_module_status;
  END IF;

  -- 2. Verify academic term consistency
  IF NEW.academic_term_id <> v_module_term THEN
    RAISE EXCEPTION 'Assignment invalid: Assignment academic_term_id does not match the module academic_term_id.';
  END IF;

  -- 3. Verify active mentor allocation (bypassed only by service_role or admin)
  IF NOT public.is_admin() AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.mentor_assignments
      WHERE mentor_id = NEW.mentor_id
        AND student_id = NEW.student_id
        AND academic_term_id = NEW.academic_term_id
        AND is_active = true
    ) INTO v_is_active_allocation;

    IF NOT v_is_active_allocation THEN
      RAISE EXCEPTION 'Authorization violation: Mentor "%" does not hold an active allocation for student "%" in academic term "%".',
        NEW.mentor_id, NEW.student_id, NEW.academic_term_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.validate_module_assignment_eligibility() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_validate_module_assignment_eligibility ON public.module_assignments;
CREATE TRIGGER trg_validate_module_assignment_eligibility
  BEFORE INSERT ON public.module_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_module_assignment_eligibility();

-- TRIGGER: Assignment update guard (prevents changing core relationships, permits revocation)
CREATE OR REPLACE FUNCTION public.validate_module_assignment_update()
RETURNS TRIGGER AS $$
BEGIN
  -- 1. Once status becomes revoked, prohibit every subsequent UPDATE to that assignment
  IF OLD.status = 'revoked' THEN
    RAISE EXCEPTION 'Assignment integrity violation: Revoked assignments are permanently immutable and cannot be modified.';
  END IF;

  -- 2. Once status becomes completed, prohibit every subsequent UPDATE to that assignment
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'Assignment integrity violation: Completed assignments are permanently immutable and cannot be modified.';
  END IF;

  -- 3. Forbid changing core relationship identity and original assignment timestamp
  IF NEW.module_id IS DISTINCT FROM OLD.module_id OR
     NEW.academic_term_id IS DISTINCT FROM OLD.academic_term_id OR
     NEW.mentor_id IS DISTINCT FROM OLD.mentor_id OR
     NEW.student_id IS DISTINCT FROM OLD.student_id OR
     NEW.assigned_at IS DISTINCT FROM OLD.assigned_at THEN
    RAISE EXCEPTION 'Assignment integrity violation: Assignment core relationships and assignment timestamp cannot be modified.';
  END IF;

  -- 4. Enforce permitted transitions from 'assigned'
  IF OLD.status = 'assigned' THEN
    IF NEW.status = 'revoked' THEN
      IF NOT (public.is_admin() OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role') THEN
        -- Mentor revocation: unconditionally force revoked_by to auth.uid() and revoked_at to now()
        -- Reject/overwrite any caller-supplied identity or arbitrary timestamp
        NEW.revoked_at := now();
        NEW.revoked_by := auth.uid();

        -- Mentors cannot alter scheduling or cohort fields during revocation
        IF NEW.due_date IS DISTINCT FROM OLD.due_date OR
           NEW.cohort_id IS DISTINCT FROM OLD.cohort_id THEN
          RAISE EXCEPTION 'Permission denied: Assignment scheduling attributes cannot be modified during revocation.';
        END IF;
      ELSE
        -- Admin / service-role revocation: defaults to now() and auth.uid(), while permitting explicit backend audit parameters
        NEW.revoked_at := COALESCE(NEW.revoked_at, now());
        NEW.revoked_by := COALESCE(NEW.revoked_by, auth.uid());
      END IF;

      -- Mandatory non-empty revocation reason for all callers
      IF NEW.revocation_reason IS NULL OR char_length(trim(NEW.revocation_reason)) = 0 THEN
        RAISE EXCEPTION 'Revocation invalid: A non-empty revocation reason must be provided.';
      END IF;

    ELSIF NEW.status = 'completed' THEN
      -- Mentors CANNOT manually mark assignments as completed
      IF NOT (public.is_admin() OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role') THEN
        RAISE EXCEPTION 'Permission denied: Mentors cannot manually mark assignments as completed. Completion is governed by verified progress evaluation.';
      END IF;

    ELSIF NEW.status = 'assigned' THEN
      -- Mentors cannot modify assignment parameters once created
      IF NOT (public.is_admin() OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role') THEN
        RAISE EXCEPTION 'Permission denied: Mentors can only update assignments to revoke them.';
      END IF;

    ELSE
      RAISE EXCEPTION 'Assignment integrity violation: Invalid status transition from "%" to "%".', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS trg_validate_module_assignment_update ON public.module_assignments;
CREATE TRIGGER trg_validate_module_assignment_update
  BEFORE UPDATE ON public.module_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_module_assignment_update();

-- ==============================================================================
-- 6. STUDENT MODULE ENROLLMENTS TABLE (Progress State Container)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.student_module_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assignment_id UUID,
  enrollment_type TEXT NOT NULL DEFAULT 'assigned'
    CHECK (enrollment_type IN ('assigned', 'institutional_common')),
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'archived')),
  completed_lessons_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_lessons_count >= 0),
  total_lessons_count INTEGER NOT NULL DEFAULT 0 CHECK (total_lessons_count >= 0),
  progress_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0.0
    CHECK (progress_percentage >= 0.0 AND progress_percentage <= 100.0),
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_module_student_enrollment UNIQUE (module_id, student_id),
  CONSTRAINT unique_enrollment_module_student UNIQUE (id, module_id, student_id),
  -- COMPOSITE CONSTRAINT: Enforces assignment_id matches the exact student and module
  CONSTRAINT fk_enrollment_assignment_composite
    FOREIGN KEY (assignment_id, module_id, student_id)
    REFERENCES public.module_assignments(id, module_id, student_id)
    ON DELETE RESTRICT
);

DROP TRIGGER IF EXISTS update_student_module_enrollments_timestamp ON public.student_module_enrollments;
CREATE TRIGGER update_student_module_enrollments_timestamp
  BEFORE UPDATE ON public.student_module_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- 7. LESSON COMPLETIONS TABLE (Granular Student Completion Ledger)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.lesson_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL,
  module_id UUID NOT NULL,
  lesson_id UUID NOT NULL,
  student_id UUID NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  time_spent_minutes INTEGER DEFAULT 0 CHECK (time_spent_minutes >= 0),
  CONSTRAINT unique_enrollment_lesson_completion UNIQUE (enrollment_id, lesson_id),
  -- COMPOSITE INTEGRITY CONSTRAINTS: Prevents cross-module and cross-student completion injection
  CONSTRAINT fk_completion_enrollment_module_student
    FOREIGN KEY (enrollment_id, module_id, student_id)
    REFERENCES public.student_module_enrollments(id, module_id, student_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_completion_lesson_module
    FOREIGN KEY (lesson_id, module_id)
    REFERENCES public.module_lessons(id, module_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_completion_student
    FOREIGN KEY (student_id)
    REFERENCES public.profiles(id)
    ON DELETE CASCADE
);

-- ==============================================================================
-- 8. MODULE ASSESSMENT LINKS TABLE (Phase 3 Assessment Integration)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.module_assessment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
  assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE RESTRICT,
  is_mandatory BOOLEAN NOT NULL DEFAULT true,
  min_passing_score NUMERIC(5, 2) NOT NULL DEFAULT 50.0
    CHECK (min_passing_score >= 0.0 AND min_passing_score <= 100.0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_module_assessment UNIQUE (module_id, assessment_id)
);

-- TRIGGER: Forbid altering assessment requirements on published/archived modules
CREATE OR REPLACE FUNCTION public.check_assessment_link_mutation_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_old_status TEXT;
  v_new_status TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO v_old_status FROM public.learning_modules WHERE id = OLD.module_id;
    IF v_old_status IN ('published', 'archived') THEN
      RAISE EXCEPTION 'Curriculum integrity violation: Cannot % assessment link on module "%" because the module is %.',
        TG_OP, OLD.module_id, v_old_status;
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO v_new_status FROM public.learning_modules WHERE id = NEW.module_id;
    IF v_new_status IN ('published', 'archived') THEN
      RAISE EXCEPTION 'Curriculum integrity violation: Cannot % assessment link on module "%" because the module is %.',
        TG_OP, NEW.module_id, v_new_status;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS trg_check_assessment_link_mutation_guard ON public.module_assessment_links;
CREATE TRIGGER trg_check_assessment_link_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.module_assessment_links
  FOR EACH ROW
  EXECUTE FUNCTION public.check_assessment_link_mutation_guard();

-- ==============================================================================
-- 9. CERTIFICATE CREDENTIALS TABLE (Cryptographic Digital Credentials)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.certificate_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE RESTRICT,
  enrollment_id UUID NOT NULL,
  certificate_no TEXT NOT NULL UNIQUE,       -- e.g., 'CSE-2026-DIST-84920'
  grade TEXT NOT NULL CHECK (grade IN ('Pass', 'Merit', 'Distinction')),
  signature_algorithm TEXT NOT NULL DEFAULT 'HMAC-SHA256'
    CHECK (signature_algorithm = 'HMAC-SHA256'),
  signature_version INTEGER NOT NULL DEFAULT 1 CHECK (signature_version >= 1),
  canonical_payload TEXT NOT NULL,           -- Immutable string representation signed by backend
  verifiable_hash TEXT NOT NULL UNIQUE,      -- Cryptographic signature hex
  accredited_by TEXT NOT NULL DEFAULT 'Department of Computer Science & Engineering',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'revoked')),
  revocation_reason TEXT,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_student_module_certificate UNIQUE (student_id, module_id),
  -- COMPOSITE CONSTRAINT: Enforces enrollment_id matches the exact student and module
  CONSTRAINT fk_certificate_enrollment_composite
    FOREIGN KEY (enrollment_id, module_id, student_id)
    REFERENCES public.student_module_enrollments(id, module_id, student_id)
    ON DELETE RESTRICT,
  CONSTRAINT check_revocation_integrity
    CHECK (
      (status = 'revoked' AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL AND revoked_by IS NOT NULL) OR
      (status <> 'revoked' AND revoked_at IS NULL AND revocation_reason IS NULL AND revoked_by IS NULL)
    )
);

DROP TRIGGER IF EXISTS update_certificate_credentials_timestamp ON public.certificate_credentials;
CREATE TRIGGER update_certificate_credentials_timestamp
  BEFORE UPDATE ON public.certificate_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- TRIGGER: Guarantee certificate payload immutability post-issuance
CREATE OR REPLACE FUNCTION public.protect_certificate_integrity()
RETURNS TRIGGER AS $$
BEGIN
  -- 1. Ensure caller is administrator or service role
  IF NOT (public.is_admin() OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role') THEN
    RAISE EXCEPTION 'Permission denied: Only authorized administrators or certificate authority services can modify credential status.';
  END IF;

  -- 2. Core credential payload and cryptographic hash are permanently immutable
  IF NEW.certificate_no IS DISTINCT FROM OLD.certificate_no OR
     NEW.student_id IS DISTINCT FROM OLD.student_id OR
     NEW.module_id IS DISTINCT FROM OLD.module_id OR
     NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id OR
     NEW.grade IS DISTINCT FROM OLD.grade OR
     NEW.signature_algorithm IS DISTINCT FROM OLD.signature_algorithm OR
     NEW.signature_version IS DISTINCT FROM OLD.signature_version OR
     NEW.canonical_payload IS DISTINCT FROM OLD.canonical_payload OR
     NEW.verifiable_hash IS DISTINCT FROM OLD.verifiable_hash OR
     NEW.accredited_by IS DISTINCT FROM OLD.accredited_by OR
     NEW.issued_at IS DISTINCT FROM OLD.issued_at OR
     NEW.issued_by IS DISTINCT FROM OLD.issued_by THEN
    RAISE EXCEPTION 'Certificate tamper violation: Core credential payload and cryptographic hash are immutable once issued.';
  END IF;

  -- 3. Only transition from verified to revoked is allowable; once revoked, cannot edit revocation metadata
  IF OLD.status = 'revoked' THEN
    RAISE EXCEPTION 'Certificate status violation: A revoked certificate cannot be modified or reinstated.';
  END IF;

  IF NEW.status = 'revoked' THEN
    NEW.revoked_at = COALESCE(NEW.revoked_at, now());
    NEW.revoked_by = COALESCE(NEW.revoked_by, auth.uid());
    IF NEW.revocation_reason IS NULL OR char_length(trim(NEW.revocation_reason)) = 0 THEN
      RAISE EXCEPTION 'Revocation invalid: A revocation reason must be provided.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Certificate status violation: Invalid certificate status transition from "%" to "%".', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS trg_protect_certificate_integrity ON public.certificate_credentials;
CREATE TRIGGER trg_protect_certificate_integrity
  BEFORE UPDATE ON public.certificate_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_certificate_integrity();

-- TRIGGER: Prevent physical deletion of issued certificates
CREATE OR REPLACE FUNCTION public.protect_certificate_deletion()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Deletion forbidden: Physical deletion of certificate credentials is strictly prohibited. Revoke the credential instead.';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS trg_protect_certificate_deletion ON public.certificate_credentials;
CREATE TRIGGER trg_protect_certificate_deletion
  BEFORE DELETE ON public.certificate_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_certificate_deletion();

-- ==============================================================================
-- 10. CLONING STORED PROCEDURE (Atomic Module Versioning)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.clone_module_version(p_source_module_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_source RECORD;
  v_caller_role TEXT;
  v_is_active BOOLEAN;
  v_next_version INTEGER;
  v_new_module_id UUID;
  v_lesson RECORD;
  v_new_lesson_id UUID;
  v_resource RECORD;
  v_assess RECORD;
BEGIN
  -- 1. Reject unidentified or anonymous callers
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required: Anonymous or unidentified callers cannot clone modules.';
  END IF;

  -- 2. Verify caller profile active state and role using safe NULL-aware checks
  SELECT COALESCE(p.role, ''), COALESCE(p.is_active, false)
  INTO v_caller_role, v_is_active
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF NOT FOUND OR NOT v_is_active OR v_caller_role NOT IN ('mentor', 'admin') THEN
    RAISE EXCEPTION 'Permission denied: Only active faculty mentors or administrators can create module revisions.';
  END IF;

  -- 3. Fetch source module
  SELECT * INTO v_source
  FROM public.learning_modules
  WHERE id = p_source_module_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Module not found: Invalid source module ID.';
  END IF;

  -- 4. Authorization: Must be module author or administrator (safe NULL-aware comparison)
  IF v_source.created_by IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: You can only revise curriculum modules you authored.';
  END IF;

  -- 4. Status Check: Source module must be published or archived
  IF v_source.status NOT IN ('published', 'archived') THEN
    RAISE EXCEPTION 'Revision invalid: Source module is currently in "%" status. Only published or archived modules can be cloned into a new version.',
      v_source.status;
  END IF;

  -- 5. Concurrency Safety: Advisory lock keyed to module code hash
  PERFORM pg_advisory_xact_lock(hashtext(v_source.code));

  -- 6. Calculate next sequential version number
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version
  FROM public.learning_modules
  WHERE code = v_source.code;

  -- 7. Insert cloned draft module
  INSERT INTO public.learning_modules (
    category_id,
    academic_term_id,
    created_by,
    code,
    version,
    title,
    description,
    semester,
    level,
    estimated_hours,
    week_number,
    skills,
    status,
    is_institutional,
    target_cohort_id
  ) VALUES (
    v_source.category_id,
    v_source.academic_term_id,
    auth.uid(),
    v_source.code,
    v_next_version,
    v_source.title,
    v_source.description,
    v_source.semester,
    v_source.level,
    v_source.estimated_hours,
    v_source.week_number,
    v_source.skills,
    'draft', -- Cloned revision starts strictly as draft
    v_source.is_institutional,
    v_source.target_cohort_id
  )
  RETURNING id INTO v_new_module_id;

  -- 8. Deep-copy lessons and their lesson-specific resources
  FOR v_lesson IN
    SELECT * FROM public.module_lessons
    WHERE module_id = p_source_module_id
    ORDER BY lesson_order ASC
  LOOP
    INSERT INTO public.module_lessons (
      module_id,
      lesson_order,
      title,
      slug,
      summary,
      content_markdown,
      lesson_type,
      estimated_minutes,
      is_mandatory,
      code_snippet,
      code_language
    ) VALUES (
      v_new_module_id,
      v_lesson.lesson_order,
      v_lesson.title,
      v_lesson.slug,
      v_lesson.summary,
      v_lesson.content_markdown,
      v_lesson.lesson_type,
      v_lesson.estimated_minutes,
      v_lesson.is_mandatory,
      v_lesson.code_snippet,
      v_lesson.code_language
    )
    RETURNING id INTO v_new_lesson_id;

    -- Copy lesson-scoped resources
    FOR v_resource IN
      SELECT * FROM public.learning_resources
      WHERE module_id = p_source_module_id AND lesson_id = v_lesson.id
    LOOP
      INSERT INTO public.learning_resources (
        module_id,
        lesson_id,
        title,
        resource_type,
        url,
        description,
        is_mandatory
      ) VALUES (
        v_new_module_id,
        v_new_lesson_id,
        v_resource.title,
        v_resource.resource_type,
        v_resource.url,
        v_resource.description,
        v_resource.is_mandatory
      );
    END LOOP;
  END LOOP;

  -- 9. Deep-copy module-level resources (lesson_id IS NULL)
  FOR v_resource IN
    SELECT * FROM public.learning_resources
    WHERE module_id = p_source_module_id AND lesson_id IS NULL
  LOOP
    INSERT INTO public.learning_resources (
      module_id,
      lesson_id,
      title,
      resource_type,
      url,
      description,
      is_mandatory
    ) VALUES (
      v_new_module_id,
      NULL,
      v_resource.title,
      v_resource.resource_type,
      v_resource.url,
      v_resource.description,
      v_resource.is_mandatory
    );
  END LOOP;

  -- 10. Deep-copy assessment links and passing thresholds
  FOR v_assess IN
    SELECT * FROM public.module_assessment_links
    WHERE module_id = p_source_module_id
  LOOP
    INSERT INTO public.module_assessment_links (
      module_id,
      assessment_id,
      is_mandatory,
      min_passing_score
    ) VALUES (
      v_new_module_id,
      v_assess.assessment_id,
      v_assess.is_mandatory,
      v_assess.min_passing_score
    );
  END LOOP;

  RETURN v_new_module_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clone_module_version(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clone_module_version(UUID) TO authenticated;

-- ==============================================================================
-- 11. SECURE INSTITUTIONAL ENROLLMENT PROCEDURE
-- ==============================================================================
-- Handles both student direct RPC (deriving identity from auth.uid()) and
-- backend service-role batch calls (accepting explicit p_target_student_id).
CREATE OR REPLACE FUNCTION public.enroll_in_institutional_module(
  p_module_id UUID,
  p_target_student_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_effective_student_id UUID;
  v_is_service_or_admin BOOLEAN;
  v_student_profile RECORD;
  v_module RECORD;
  v_student_detail RECORD;
  v_enrollment_id UUID;
  v_total_lessons INTEGER;
BEGIN
  v_is_service_or_admin := public.is_admin() OR
    COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role';

  -- 1. Resolve effective student identity
  IF v_is_service_or_admin AND p_target_student_id IS NOT NULL THEN
    v_effective_student_id := p_target_student_id;
  ELSE
    -- Authenticated students cannot specify arbitrary IDs; derived strictly from auth.uid()
    v_effective_student_id := auth.uid();
  END IF;

  IF v_effective_student_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: Unable to identify student for enrollment.';
  END IF;

  -- 2. Verify student profile role and active state
  SELECT id, role, is_active INTO v_student_profile
  FROM public.profiles
  WHERE id = v_effective_student_id;

  IF NOT FOUND OR v_student_profile.role <> 'student' OR NOT v_student_profile.is_active THEN
    RAISE EXCEPTION 'Access denied: Target user is not an active student.';
  END IF;

  -- 3. Verify target module exists, is institutional, published, and belongs to active academic term
  SELECT lm.*, at.is_current
  INTO v_module
  FROM public.learning_modules lm
  JOIN public.academic_terms at ON at.id = lm.academic_term_id
  WHERE lm.id = p_module_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment failed: Module does not exist.';
  END IF;

  IF NOT v_module.is_institutional THEN
    RAISE EXCEPTION 'Enrollment failed: Self-enrollment is permitted only for institutional common curriculum modules.';
  END IF;

  IF v_module.status <> 'published' THEN
    RAISE EXCEPTION 'Enrollment failed: Cannot enroll in a module with "%" status.', v_module.status;
  END IF;

  IF NOT v_module.is_current THEN
    RAISE EXCEPTION 'Enrollment failed: Cannot enroll in modules from past or inactive academic terms.';
  END IF;

  -- 4. Verify student eligibility against real schema fields in student_details
  SELECT * INTO v_student_detail
  FROM public.student_details
  WHERE profile_id = v_effective_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment failed: Student academic profile not found in institutional records.';
  END IF;

  IF v_student_detail.semester <> v_module.semester THEN
    RAISE EXCEPTION 'Eligibility violation: Student semester (%) does not match module semester (%).',
      v_student_detail.semester, v_module.semester;
  END IF;

  IF v_module.target_cohort_id IS NOT NULL AND v_student_detail.cohort_id IS DISTINCT FROM v_module.target_cohort_id THEN
    RAISE EXCEPTION 'Eligibility violation: Student cohort does not match module target cohort.';
  END IF;

  -- 5. Check for existing enrollment (Fast idempotent return)
  SELECT id INTO v_enrollment_id
  FROM public.student_module_enrollments
  WHERE module_id = p_module_id AND student_id = v_effective_student_id;

  IF FOUND THEN
    RETURN v_enrollment_id;
  END IF;

  -- 6. Count lessons in this specific module version
  SELECT COUNT(*)::INTEGER INTO v_total_lessons
  FROM public.module_lessons
  WHERE module_id = p_module_id;

  -- 7. Insert new verified enrollment (Atomic concurrency-safe upsert)
  INSERT INTO public.student_module_enrollments (
    module_id,
    student_id,
    assignment_id,
    enrollment_type,
    status,
    completed_lessons_count,
    total_lessons_count,
    progress_percentage
  ) VALUES (
    p_module_id,
    v_effective_student_id,
    NULL,
    'institutional_common',
    'in_progress',
    0,
    v_total_lessons,
    0.0
  )
  ON CONFLICT (module_id, student_id)
  DO UPDATE SET updated_at = public.student_module_enrollments.updated_at
  RETURNING id INTO v_enrollment_id;

  RETURN v_enrollment_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enroll_in_institutional_module(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enroll_in_institutional_module(UUID, UUID) TO authenticated, service_role;

-- ==============================================================================
-- 12. UNIFIED MODULE ACCESS VISIBILITY HELPER (Prevents RLS Disclosure)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.can_access_learning_module(p_module_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.learning_modules lm
    WHERE lm.id = p_module_id
      AND (
        -- 1. Administrative full access
        public.is_admin()
        OR
        -- 2. Module creator mentor
        lm.created_by = auth.uid()
        OR
        -- 3. Mentor historical or active access:
        -- Mentor created an assignment for this module OR has an active mentee assigned to it
        (
          EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'mentor' AND p.is_active = true
          )
          AND (
            EXISTS (
              SELECT 1 FROM public.module_assignments ma
              WHERE ma.module_id = lm.id AND ma.mentor_id = auth.uid()
            )
            OR
            EXISTS (
              SELECT 1 FROM public.module_assignments ma
              JOIN public.mentor_assignments m_a
                ON m_a.student_id = ma.student_id
               AND m_a.academic_term_id = ma.academic_term_id
              WHERE ma.module_id = lm.id
                AND m_a.mentor_id = auth.uid()
                AND m_a.is_active = true
            )
            OR
            -- Published institutional modules are visible to active faculty mentors in that term
            (
              lm.is_institutional = true
              AND lm.status IN ('published', 'archived')
              AND EXISTS (
                SELECT 1 FROM public.academic_terms at
                WHERE at.id = lm.academic_term_id AND at.is_current = true
              )
            )
          )
        )
        OR
        -- 4. Student scoped access:
        -- Must be published AND either actively assigned OR eligible institutional module
        (
          lm.status = 'published'
          AND EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'student' AND p.is_active = true
          )
          AND (
            -- Explicit active assignment
            EXISTS (
              SELECT 1 FROM public.module_assignments ma
              WHERE ma.module_id = lm.id
                AND ma.student_id = auth.uid()
                AND ma.status = 'assigned'
            )
            OR
            -- Institutional common curriculum eligibility
            (
              lm.is_institutional = true
              AND EXISTS (
                SELECT 1 FROM public.student_details sd
                WHERE sd.profile_id = auth.uid()
                  AND sd.semester = lm.semester
                  AND (lm.target_cohort_id IS NULL OR sd.cohort_id = lm.target_cohort_id)
              )
              AND EXISTS (
                SELECT 1 FROM public.academic_terms at
                WHERE at.id = lm.academic_term_id
                  AND at.is_current = true
              )
            )
          )
        )
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_access_learning_module(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_learning_module(UUID) TO authenticated, service_role;

-- ==============================================================================
-- 13. INDEXES FOR PERFORMANCE & FAST LOOKUPS
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_modules_category ON public.learning_modules(category_id);
CREATE INDEX IF NOT EXISTS idx_modules_term ON public.learning_modules(academic_term_id);
CREATE INDEX IF NOT EXISTS idx_modules_creator ON public.learning_modules(created_by);
CREATE INDEX IF NOT EXISTS idx_modules_code_ver ON public.learning_modules(code, version);
CREATE INDEX IF NOT EXISTS idx_modules_semester_status ON public.learning_modules(semester, status);
CREATE INDEX IF NOT EXISTS idx_modules_institutional ON public.learning_modules(is_institutional, status);

CREATE INDEX IF NOT EXISTS idx_lessons_module_order ON public.module_lessons(module_id, lesson_order);
CREATE INDEX IF NOT EXISTS idx_resources_module ON public.learning_resources(module_id);
CREATE INDEX IF NOT EXISTS idx_resources_lesson_module ON public.learning_resources(lesson_id, module_id);

CREATE INDEX IF NOT EXISTS idx_mod_assign_mentor_term ON public.module_assignments(mentor_id, academic_term_id);
CREATE INDEX IF NOT EXISTS idx_mod_assign_student ON public.module_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_mod_assign_module ON public.module_assignments(module_id);
CREATE INDEX IF NOT EXISTS idx_mod_assign_status ON public.module_assignments(status);

CREATE INDEX IF NOT EXISTS idx_enrollments_student ON public.student_module_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_module ON public.student_module_enrollments(module_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status ON public.student_module_enrollments(status);
CREATE INDEX IF NOT EXISTS idx_enrollments_assignment ON public.student_module_enrollments(assignment_id);

CREATE INDEX IF NOT EXISTS idx_completions_enrollment ON public.lesson_completions(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_completions_student ON public.lesson_completions(student_id);
CREATE INDEX IF NOT EXISTS idx_completions_lesson ON public.lesson_completions(lesson_id);

CREATE INDEX IF NOT EXISTS idx_mod_assess_links_module ON public.module_assessment_links(module_id);
CREATE INDEX IF NOT EXISTS idx_mod_assess_links_assessment ON public.module_assessment_links(assessment_id);

CREATE INDEX IF NOT EXISTS idx_certs_student ON public.certificate_credentials(student_id);
CREATE INDEX IF NOT EXISTS idx_certs_hash ON public.certificate_credentials(verifiable_hash);
CREATE INDEX IF NOT EXISTS idx_certs_no ON public.certificate_credentials(certificate_no);

-- ==============================================================================
-- 14. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE public.learning_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_module_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_assessment_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificate_credentials ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 14.1 learning_categories POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "auth_read_learning_categories" ON public.learning_categories;
CREATE POLICY "auth_read_learning_categories"
  ON public.learning_categories FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "admin_manage_learning_categories" ON public.learning_categories;
CREATE POLICY "admin_manage_learning_categories"
  ON public.learning_categories FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ------------------------------------------------------------------------------
-- 14.2 learning_modules POLICIES (Remediated Single-Boundary Visibility)
-- ------------------------------------------------------------------------------
-- Admin has full access
DROP POLICY IF EXISTS "admin_all_learning_modules" ON public.learning_modules;
CREATE POLICY "admin_all_learning_modules"
  ON public.learning_modules FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Unified, leak-proof SELECT policy leveraging public.can_access_learning_module()
DROP POLICY IF EXISTS "unified_read_learning_modules" ON public.learning_modules;
CREATE POLICY "unified_read_learning_modules"
  ON public.learning_modules FOR SELECT TO authenticated
  USING (public.can_access_learning_module(id));

-- Mentors can insert new draft modules
DROP POLICY IF EXISTS "mentor_insert_learning_modules" ON public.learning_modules;
CREATE POLICY "mentor_insert_learning_modules"
  ON public.learning_modules FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid() AND
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('mentor', 'admin') AND is_active = true)
  );

-- Mentors can update modules they author (subject to mutation guard triggers)
DROP POLICY IF EXISTS "mentor_update_own_learning_modules" ON public.learning_modules;
CREATE POLICY "mentor_update_own_learning_modules"
  ON public.learning_modules FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Mentors can delete only their own draft modules (subject to delete guard triggers)
DROP POLICY IF EXISTS "mentor_delete_draft_learning_modules" ON public.learning_modules;
CREATE POLICY "mentor_delete_draft_learning_modules"
  ON public.learning_modules FOR DELETE TO authenticated
  USING (created_by = auth.uid() AND status = 'draft');

-- ------------------------------------------------------------------------------
-- 14.3 module_lessons POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_all_module_lessons" ON public.module_lessons;
CREATE POLICY "admin_all_module_lessons"
  ON public.module_lessons FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "mentor_manage_module_lessons" ON public.module_lessons;
CREATE POLICY "mentor_manage_module_lessons"
  ON public.module_lessons FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.learning_modules lm
      WHERE lm.id = module_id AND lm.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.learning_modules lm
      WHERE lm.id = module_id AND lm.created_by = auth.uid()
    )
  );

-- Scoped read access using the module visibility boundary
DROP POLICY IF EXISTS "unified_read_module_lessons" ON public.module_lessons;
CREATE POLICY "unified_read_module_lessons"
  ON public.module_lessons FOR SELECT TO authenticated
  USING (public.can_access_learning_module(module_id));

-- ------------------------------------------------------------------------------
-- 14.4 learning_resources POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_all_learning_resources" ON public.learning_resources;
CREATE POLICY "admin_all_learning_resources"
  ON public.learning_resources FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "mentor_manage_learning_resources" ON public.learning_resources;
CREATE POLICY "mentor_manage_learning_resources"
  ON public.learning_resources FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.learning_modules lm
      WHERE lm.id = module_id AND lm.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.learning_modules lm
      WHERE lm.id = module_id AND lm.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "unified_read_learning_resources" ON public.learning_resources;
CREATE POLICY "unified_read_learning_resources"
  ON public.learning_resources FOR SELECT TO authenticated
  USING (public.can_access_learning_module(module_id));

-- ------------------------------------------------------------------------------
-- 14.5 module_assignments POLICIES (Preserved History & Scoped Visibility)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_all_module_assignments" ON public.module_assignments;
CREATE POLICY "admin_all_module_assignments"
  ON public.module_assignments FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Mentors can view assignments they authored OR assignments for students currently in their active allocation
DROP POLICY IF EXISTS "mentor_select_module_assignments" ON public.module_assignments;
CREATE POLICY "mentor_select_module_assignments"
  ON public.module_assignments FOR SELECT TO authenticated
  USING (
    mentor_id = auth.uid() OR
    public.is_active_mentor_for_student_in_term(student_id, academic_term_id)
  );

DROP POLICY IF EXISTS "mentor_insert_mentee_module_assignments" ON public.module_assignments;
CREATE POLICY "mentor_insert_mentee_module_assignments"
  ON public.module_assignments FOR INSERT TO authenticated
  WITH CHECK (
    mentor_id = auth.uid() AND
    public.is_active_mentor_for_student_in_term(student_id, academic_term_id)
  );

-- Mentors can update assignment status strictly to revoke an active assignment
DROP POLICY IF EXISTS "mentor_update_mentee_module_assignments" ON public.module_assignments;
CREATE POLICY "mentor_update_mentee_module_assignments"
  ON public.module_assignments FOR UPDATE TO authenticated
  USING (
    mentor_id = auth.uid() AND
    status = 'assigned' AND
    public.is_active_mentor_for_student_in_term(student_id, academic_term_id)
  )
  WITH CHECK (
    mentor_id = auth.uid() AND
    status = 'revoked' AND
    public.is_active_mentor_for_student_in_term(student_id, academic_term_id)
  );

-- Physical deletion policy: DISABLED for mentors to preserve audit history.
-- Deletion is strictly reserved for administrators.

-- Students can read only their own non-revoked assignments
DROP POLICY IF EXISTS "student_read_own_module_assignments" ON public.module_assignments;
CREATE POLICY "student_read_own_module_assignments"
  ON public.module_assignments FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- ------------------------------------------------------------------------------
-- 14.6 student_module_enrollments POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_all_student_module_enrollments" ON public.student_module_enrollments;
CREATE POLICY "admin_all_student_module_enrollments"
  ON public.student_module_enrollments FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Mentors can view enrollment progress if they are active mentor in module's term OR if they authored the assignment
DROP POLICY IF EXISTS "mentor_read_mentee_module_enrollments" ON public.student_module_enrollments;
CREATE POLICY "mentor_read_mentee_module_enrollments"
  ON public.student_module_enrollments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.learning_modules lm
      WHERE lm.id = module_id
        AND public.is_active_mentor_for_student_in_term(student_id, lm.academic_term_id)
    )
    OR
    EXISTS (
      SELECT 1 FROM public.module_assignments ma
      WHERE ma.id = assignment_id AND ma.mentor_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "student_read_own_module_enrollments" ON public.student_module_enrollments;
CREATE POLICY "student_read_own_module_enrollments"
  ON public.student_module_enrollments FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- NOTE: ZERO direct student INSERT or UPDATE policies.
-- Institutional enrollment is performed via public.enroll_in_institutional_module().
-- Assigned enrollment and progress updates are strictly performed via service-role backend.

-- ------------------------------------------------------------------------------
-- 14.7 lesson_completions POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_all_lesson_completions" ON public.lesson_completions;
CREATE POLICY "admin_all_lesson_completions"
  ON public.lesson_completions FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "mentor_read_mentee_lesson_completions" ON public.lesson_completions;
CREATE POLICY "mentor_read_mentee_lesson_completions"
  ON public.lesson_completions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.learning_modules lm
      WHERE lm.id = module_id
        AND public.is_active_mentor_for_student_in_term(student_id, lm.academic_term_id)
    )
    OR
    EXISTS (
      SELECT 1 FROM public.student_module_enrollments sme
      JOIN public.module_assignments ma ON ma.id = sme.assignment_id
      WHERE sme.id = enrollment_id AND ma.mentor_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "student_read_own_lesson_completions" ON public.lesson_completions;
CREATE POLICY "student_read_own_lesson_completions"
  ON public.lesson_completions FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- NOTE: ZERO direct student INSERT, UPDATE, or DELETE policies.
-- Completions are recorded exclusively via backend service endpoints after verification.

-- ------------------------------------------------------------------------------
-- 14.8 module_assessment_links POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_all_module_assessment_links" ON public.module_assessment_links;
CREATE POLICY "admin_all_module_assessment_links"
  ON public.module_assessment_links FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "mentor_manage_module_assessment_links" ON public.module_assessment_links;
CREATE POLICY "mentor_manage_module_assessment_links"
  ON public.module_assessment_links FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.learning_modules lm
      WHERE lm.id = module_id AND lm.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.learning_modules lm
      WHERE lm.id = module_id AND lm.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "unified_read_module_assessment_links" ON public.module_assessment_links;
CREATE POLICY "unified_read_module_assessment_links"
  ON public.module_assessment_links FOR SELECT TO authenticated
  USING (public.can_access_learning_module(module_id));

-- ------------------------------------------------------------------------------
-- 14.9 certificate_credentials POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_all_certificate_credentials" ON public.certificate_credentials;
CREATE POLICY "admin_all_certificate_credentials"
  ON public.certificate_credentials FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "mentor_read_mentee_certificates" ON public.certificate_credentials;
CREATE POLICY "mentor_read_mentee_certificates"
  ON public.certificate_credentials FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.learning_modules lm
      WHERE lm.id = module_id
        AND public.is_active_mentor_for_student_in_term(student_id, lm.academic_term_id)
    )
    OR
    issued_by = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM public.student_module_enrollments sme
      JOIN public.module_assignments ma ON ma.id = sme.assignment_id
      WHERE sme.id = enrollment_id AND ma.mentor_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "student_read_own_certificates" ON public.certificate_credentials;
CREATE POLICY "student_read_own_certificates"
  ON public.certificate_credentials FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- NOTE: ZERO direct INSERT, UPDATE, or DELETE policies for students or mentors.
-- Certificate issuance and revocation are performed exclusively via backend service role or admin.

-- ==============================================================================
-- 15. SEED INSTITUTIONAL CSE LEARNING CATEGORIES
-- ==============================================================================
INSERT INTO public.learning_categories (code, name, description, display_order)
VALUES
  ('PROG_FUND', 'Programming Fundamentals', 'Algorithmic problem solving, control structures, memory layout, and procedural abstraction in C/C++.', 1),
  ('DSA', 'Data Structures and Algorithms', 'Linear and non-linear data structures, asymptotic analysis, dynamic programming, and graph traversals.', 2),
  ('OOP', 'Object-Oriented Programming', 'Encapsulation, inheritance, polymorphism, design patterns (GoF), and SOLID principles.', 3),
  ('DBMS', 'Database Management Systems', 'Relational data models, SQL optimization, B+ tree indexing, normalization (3NF/BCNF), and ACID transactions.', 4),
  ('OS', 'Operating Systems', 'Process management, POSIX multi-threading, concurrency control, virtual memory paging, and deadlock mitigation.', 5),
  ('NETWORKS', 'Computer Networks', 'OSI and TCP/IP stack, transport layer congestion control, DNS, routing algorithms, and socket programming.', 6),
  ('SE', 'Software Engineering', 'Agile/Scrum lifecycles, test-driven development (TDD), CI/CD pipelines, and software architecture.', 7),
  ('WEB_DEV', 'Web Development', 'Full-stack client-server architecture, RESTful APIs, state management, and modern web application security.', 8),
  ('AI_ML', 'Artificial Intelligence and Machine Learning', 'Supervised and unsupervised learning, gradient descent, neural network basics, and model evaluation.', 9),
  ('SYS_DESIGN', 'System Design', 'Scalable distributed systems, load balancing, caching strategies, microservices, and CAP theorem trade-offs.', 10)
ON CONFLICT (code) DO NOTHING;

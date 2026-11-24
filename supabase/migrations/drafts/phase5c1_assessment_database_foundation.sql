-- ============================================================================
-- DRAFT ONLY — MentorBridge Phase 5C.1 Assessment Database Foundation
-- Complete SQL proposal; do not apply before reviewing the preflight checklist.
-- No SQL has been executed in preparing this draft.
-- Requires PostgreSQL 15+ for security_invoker views.
-- ============================================================================

BEGIN;

-- A. Backward-compatible assessment metadata. NULL passing_percentage preserves
--    legacy absolute passing_marks. No historical marks/results are rewritten.
ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS passing_percentage NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS origin_module_id UUID REFERENCES public.learning_modules(id) ON DELETE RESTRICT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assessments'::regclass AND conname='assessments_passing_percentage_range_check') THEN
    ALTER TABLE public.assessments ADD CONSTRAINT assessments_passing_percentage_range_check
      CHECK (passing_percentage IS NULL OR passing_percentage BETWEEN 0 AND 100) NOT VALID;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.assessment_required_marks(p_total NUMERIC, p_percent NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog
AS $$ SELECT CASE WHEN p_total IS NULL OR p_total < 0 OR p_percent IS NULL OR p_percent NOT BETWEEN 0 AND 100 THEN NULL
  ELSE ceil(p_total * p_percent) / 100 END $$;
REVOKE ALL ON FUNCTION public.assessment_required_marks(NUMERIC,NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assessment_required_marks(NUMERIC,NUMERIC) TO authenticated, service_role;

-- New module assessments originate from an editable draft module. Legacy rows
-- keep NULL. mentor_id cannot be changed to invalidate origin ownership.
CREATE OR REPLACE FUNCTION public.validate_assessment_origin_module()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE m public.learning_modules%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND NEW.origin_module_id IS DISTINCT FROM OLD.origin_module_id THEN
    RAISE EXCEPTION 'Assessment origin module is immutable.';
  END IF;
  IF NEW.origin_module_id IS NOT NULL THEN
    SELECT * INTO m FROM public.learning_modules WHERE id=NEW.origin_module_id;
    IF NOT FOUND OR m.created_by IS DISTINCT FROM NEW.mentor_id THEN
      RAISE EXCEPTION 'Assessment mentor must own its origin module.';
    END IF;
    IF TG_OP='INSERT' AND m.status <> 'draft' THEN
      RAISE EXCEPTION 'Module assessments must be created while their origin module is draft.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_validate_assessment_origin_module ON public.assessments;
CREATE TRIGGER trg_validate_assessment_origin_module BEFORE INSERT OR UPDATE OF origin_module_id, mentor_id
  ON public.assessments FOR EACH ROW EXECUTE FUNCTION public.validate_assessment_origin_module();

-- B. Replace precisely the implicit check declared by migration 000004.
ALTER TABLE public.assessment_questions DROP CONSTRAINT IF EXISTS assessment_questions_question_type_check;
ALTER TABLE public.assessment_questions ADD CONSTRAINT assessment_questions_type_check
  CHECK (question_type IN ('mcq','multiple_select','true_false','descriptive')) NOT VALID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assessment_questions'::regclass AND conname='assessment_questions_id_assessment_key') THEN
    ALTER TABLE public.assessment_questions ADD CONSTRAINT assessment_questions_id_assessment_key UNIQUE(id,assessment_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assessment_options'::regclass AND conname='assessment_options_id_question_key') THEN
    ALTER TABLE public.assessment_options ADD CONSTRAINT assessment_options_id_question_key UNIQUE(id,question_id);
  END IF;
END $$;

-- C. Preserve module_assessment_links and its existing module freeze trigger.
--    New assessment links are allowed only for draft modules. Existing linked
--    published assessments can be reused by clone_module_version.
CREATE OR REPLACE FUNCTION public.validate_module_assessment_link_draft()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE m public.learning_modules%ROWTYPE; a public.assessments%ROWTYPE;
BEGIN
  SELECT * INTO m FROM public.learning_modules WHERE id=NEW.module_id;
  IF NOT FOUND OR m.status <> 'draft' THEN RAISE EXCEPTION 'Assessment link requires a draft module.'; END IF;
  SELECT * INTO a FROM public.assessments WHERE id=NEW.assessment_id;
  IF NOT FOUND OR a.mentor_id IS DISTINCT FROM m.created_by THEN
    RAISE EXCEPTION 'Assessment and module must exist and have the same owner.';
  END IF;
  IF a.origin_module_id IS NOT NULL AND a.origin_module_id <> m.id AND NOT EXISTS (
    SELECT 1 FROM public.learning_modules origin WHERE origin.id=a.origin_module_id
      AND origin.code=m.code AND origin.created_by=m.created_by) THEN
    RAISE EXCEPTION 'Assessment can be linked only to its origin module or a cloned version.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_validate_module_assessment_link_draft ON public.module_assessment_links;
CREATE TRIGGER trg_validate_module_assessment_link_draft BEFORE INSERT OR UPDATE ON public.module_assessment_links
  FOR EACH ROW EXECUTE FUNCTION public.validate_module_assessment_link_draft();

-- D. Private upload metadata. File bytes stay in private Storage. Canonical
--    object path binds owner/module/assessment/document identity.
CREATE TABLE IF NOT EXISTS public.assessment_source_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL,
  assessment_id UUID NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  storage_bucket TEXT NOT NULL DEFAULT 'assessment-source-materials' CHECK(storage_bucket='assessment-source-materials'),
  storage_object_path TEXT NOT NULL,
  original_filename TEXT NOT NULL CHECK(char_length(trim(original_filename)) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL CHECK(mime_type IN ('application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain')),
  size_bytes BIGINT NOT NULL CHECK(size_bytes BETWEEN 1 AND 26214400),
  extraction_status TEXT NOT NULL DEFAULT 'pending' CHECK(extraction_status IN ('pending','processing','ready','rejected','failed')),
  extraction_error_code TEXT,
  page_count INTEGER CHECK(page_count IS NULL OR page_count>0),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(), extracted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assessment_source_documents_link_fk FOREIGN KEY(module_id,assessment_id)
    REFERENCES public.module_assessment_links(module_id,assessment_id) ON DELETE CASCADE,
  CONSTRAINT assessment_source_documents_object_unique UNIQUE(storage_bucket,storage_object_path),
  CONSTRAINT assessment_source_documents_id_assessment_key UNIQUE(id,assessment_id)
);

CREATE OR REPLACE FUNCTION public.validate_assessment_source_document()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE m public.learning_modules%ROWTYPE; a public.assessments%ROWTYPE;
BEGIN
  SELECT * INTO m FROM public.learning_modules WHERE id=NEW.module_id;
  SELECT * INTO a FROM public.assessments WHERE id=NEW.assessment_id;
  IF NOT FOUND OR m.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.module_assessment_links l WHERE l.module_id=NEW.module_id AND l.assessment_id=NEW.assessment_id) THEN
    RAISE EXCEPTION 'Source must belong to an assessment linked to its module.';
  END IF;
  IF m.created_by IS DISTINCT FROM a.mentor_id OR NEW.uploaded_by IS DISTINCT FROM a.mentor_id
     OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=NEW.uploaded_by AND p.role IN ('mentor','admin') AND p.is_active) THEN
    RAISE EXCEPTION 'Active uploader must own the module and assessment.';
  END IF;
  IF NEW.storage_bucket <> 'assessment-source-materials' OR NEW.storage_object_path <> format('%s/%s/%s/%s',NEW.uploaded_by,NEW.module_id,NEW.assessment_id,NEW.id) THEN
    RAISE EXCEPTION 'Storage path does not match canonical source identity.';
  END IF;
  IF TG_OP='INSERT' THEN
    IF m.status <> 'draft' OR a.status <> 'draft' THEN RAISE EXCEPTION 'Sources can be added only in draft workflows.'; END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by OR NEW.module_id IS DISTINCT FROM OLD.module_id OR NEW.assessment_id IS DISTINCT FROM OLD.assessment_id OR NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket OR NEW.storage_object_path IS DISTINCT FROM OLD.storage_object_path THEN
      RAISE EXCEPTION 'Uploader, module, assessment and Storage identity are immutable.';
    END IF;
    IF m.status <> 'draft' OR a.status <> 'draft' THEN RAISE EXCEPTION 'Metadata edits require draft module and assessment.'; END IF;
  END IF;
  NEW.updated_at:=now(); RETURN NEW;
END $$;
CREATE TRIGGER trg_validate_assessment_source_document BEFORE INSERT OR UPDATE ON public.assessment_source_documents
  FOR EACH ROW EXECUTE FUNCTION public.validate_assessment_source_document();

-- E. Question provenance. Composite FKs prevent cross-assessment references.
CREATE TABLE IF NOT EXISTS public.assessment_question_source_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), assessment_id UUID NOT NULL,
  question_id UUID NOT NULL, source_document_id UUID NOT NULL,
  location_kind TEXT NOT NULL CHECK(location_kind IN ('page','slide')),
  location_start INTEGER NOT NULL CHECK(location_start>0),
  location_end INTEGER NOT NULL CHECK(location_end>=location_start),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assessment_question_source_question_fk FOREIGN KEY(question_id,assessment_id)
    REFERENCES public.assessment_questions(id,assessment_id) ON DELETE CASCADE,
  CONSTRAINT assessment_question_source_document_fk FOREIGN KEY(source_document_id,assessment_id)
    REFERENCES public.assessment_source_documents(id,assessment_id) ON DELETE CASCADE,
  CONSTRAINT assessment_question_source_span_unique UNIQUE(question_id,source_document_id,location_kind,location_start,location_end)
);

CREATE OR REPLACE FUNCTION public.guard_assessment_question_source_reference()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_assessment UUID; v_doc UUID; v_a_status TEXT; v_m_status TEXT;
BEGIN
  v_assessment:=CASE WHEN TG_OP='DELETE' THEN OLD.assessment_id ELSE NEW.assessment_id END;
  v_doc:=CASE WHEN TG_OP='DELETE' THEN OLD.source_document_id ELSE NEW.source_document_id END;
  SELECT a.status,m.status INTO v_a_status,v_m_status FROM public.assessment_source_documents d
    JOIN public.assessments a ON a.id=d.assessment_id JOIN public.learning_modules m ON m.id=d.module_id
    WHERE d.id=v_doc AND d.assessment_id=v_assessment;
  -- Parent deletion cascades references after parent becomes invisible. Parent
  -- source-delete guard below independently prevents published source deletion.
  IF TG_OP='DELETE' AND NOT FOUND THEN RETURN OLD; END IF;
  IF NOT FOUND OR v_a_status<>'draft' OR v_m_status<>'draft' THEN
    RAISE EXCEPTION 'Provenance is immutable after assessment or module publication.';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_assessment_question_source_reference
  BEFORE INSERT OR UPDATE OR DELETE ON public.assessment_question_source_references
  FOR EACH ROW EXECUTE FUNCTION public.guard_assessment_question_source_reference();

-- Source deletion is intentionally denied after either linked object publishes,
-- including for administrators. No post-publication exception is proposed.
-- Draft owner/admin cleanup remains possible; FK cascade cleans draft provenance.
CREATE OR REPLACE FUNCTION public.guard_assessment_source_document_delete()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.assessments a JOIN public.learning_modules m ON m.id=OLD.module_id
    WHERE a.id=OLD.assessment_id AND (a.status<>'draft' OR m.status IN ('published','archived'))) THEN
    RAISE EXCEPTION 'Source documents cannot be deleted after assessment or module publication.';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_guard_assessment_source_document_delete BEFORE DELETE ON public.assessment_source_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_assessment_source_document_delete();

-- F. Correct-answer security and one canonical student eligibility predicate.
-- SECURITY DEFINER owner must bypass RLS or own every queried RLS table; the
-- fail-closed verification appears below after helper creation.
CREATE OR REPLACE FUNCTION public.can_student_access_assessment(p_assessment_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,auth,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.assessments a JOIN public.profiles p ON p.id=auth.uid()
    WHERE a.id=p_assessment_id AND p.role='student' AND p.is_active
      AND ((a.status='published' AND a.start_time<=now()
            AND (a.end_time>=now() OR EXISTS(SELECT 1 FROM public.assessment_attempts at
              WHERE at.assessment_id=a.id AND at.student_id=auth.uid() AND at.status='in_progress'))
            AND (EXISTS(SELECT 1 FROM public.assessment_attempts at
                   WHERE at.assessment_id=a.id AND at.student_id=auth.uid() AND at.status='in_progress')
              OR (SELECT count(*) FROM public.assessment_attempts at
                  WHERE at.assessment_id=a.id AND at.student_id=auth.uid())<a.allowed_attempts))
        OR (a.status='completed' AND a.is_results_published AND a.start_time<=now()
          AND EXISTS(SELECT 1 FROM public.assessment_attempts reviewed
            WHERE reviewed.assessment_id=a.id AND reviewed.student_id=auth.uid()
              AND reviewed.status IN('submitted','evaluated'))))
      AND (
        -- Module-linked assessments never fall back to a legacy assignment.
        EXISTS (SELECT 1 FROM public.module_assessment_links l
          JOIN public.learning_modules m ON m.id=l.module_id
          JOIN public.student_module_enrollments e ON e.module_id=m.id
          WHERE l.assessment_id=a.id AND m.status='published' AND e.student_id=auth.uid()
            AND e.enrollment_type='institutional_common' AND e.assignment_id IS NULL
            AND e.status IN ('in_progress','completed'))
        OR EXISTS (SELECT 1 FROM public.module_assessment_links l
          JOIN public.learning_modules m ON m.id=l.module_id
          JOIN public.student_module_enrollments e ON e.module_id=m.id
          JOIN public.module_assignments ma ON ma.id=e.assignment_id
            AND ma.module_id=e.module_id AND ma.student_id=e.student_id
          WHERE l.assessment_id=a.id AND m.status='published' AND e.student_id=auth.uid()
            AND e.enrollment_type='assigned'
            AND ((e.status='in_progress' AND ma.status='assigned')
              OR (e.status='completed' AND ma.status IN ('assigned','completed'))))
        OR (
          EXISTS (SELECT 1 FROM public.assessment_assignments aa
            WHERE aa.assessment_id=a.id AND aa.student_id=auth.uid()
              AND (aa.cohort_id IS NULL OR EXISTS (SELECT 1 FROM public.student_details sd
                WHERE sd.profile_id=auth.uid() AND sd.cohort_id=aa.cohort_id))))
        OR EXISTS (
          SELECT 1 FROM public.mentor_assignments ma
          WHERE ma.mentor_id=a.mentor_id AND ma.student_id=auth.uid() AND ma.is_active=true)
      )
  )
$$;
REVOKE ALL ON FUNCTION public.can_student_access_assessment(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_student_access_assessment(UUID) TO authenticated;

-- Do not drop or replace mentor_assessment_option_answer_keys: no original
-- migration creates it. Existing mentor answer access remains via guarded API.

-- G. Publication validation and content immutability. Every question must have
--    positive marks (also enforced by the original table CHECK). MCQ/true_false
--    require exactly one key, multiple_select at least one. Multi-select grading
--    is exact-set: full marks only for the complete correct set. Descriptive
--    questions remain valid without options. Total is set to sum(question marks).
CREATE OR REPLACE FUNCTION public.validate_assessment_questions_before_publish()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE q RECORD; n_options INTEGER; n_correct INTEGER; n_questions INTEGER; marks_sum NUMERIC; do_check BOOLEAN;
BEGIN
  do_check := NEW.status='published' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'published');
  IF do_check THEN
    IF NEW.origin_module_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.module_assessment_links l
      WHERE l.module_id=NEW.origin_module_id AND l.assessment_id=NEW.id) THEN
      RAISE EXCEPTION 'Module assessment must be linked to its origin module before publication.';
    END IF;
    SELECT count(*),coalesce(sum(marks),0) INTO n_questions,marks_sum FROM public.assessment_questions WHERE assessment_id=NEW.id;
    IF n_questions=0 OR marks_sum<=0 THEN RAISE EXCEPTION 'Cannot publish without positively marked questions.'; END IF;
    FOR q IN SELECT id,question_type,marks FROM public.assessment_questions WHERE assessment_id=NEW.id LOOP
      IF q.marks IS NULL OR q.marks<=0 THEN RAISE EXCEPTION 'Every question must have strictly positive marks.'; END IF;
      SELECT count(*),count(*) FILTER(WHERE is_correct) INTO n_options,n_correct
        FROM public.assessment_options WHERE question_id=q.id;
      IF q.question_type='descriptive' THEN CONTINUE; END IF;
      IF n_options<2 THEN RAISE EXCEPTION 'Objective questions need at least two options.'; END IF;
      IF q.question_type IN('mcq','true_false') AND n_correct<>1 THEN
        RAISE EXCEPTION 'MCQ and true/false need exactly one correct option.';
      END IF;
      IF q.question_type='multiple_select' AND n_correct<1 THEN
        RAISE EXCEPTION 'Multiple-select needs one or more correct options.';
      END IF;
      IF q.question_type='true_false' AND (n_options<>2
        OR (SELECT count(DISTINCT lower(trim(option_text))) FROM public.assessment_options WHERE question_id=q.id)<>2
        OR NOT EXISTS(SELECT 1 FROM public.assessment_options WHERE question_id=q.id AND lower(trim(option_text))='true')
        OR NOT EXISTS(SELECT 1 FROM public.assessment_options WHERE question_id=q.id AND lower(trim(option_text))='false')) THEN
        RAISE EXCEPTION 'True/false requires exactly True and False options.';
      END IF;
    END LOOP;
    NEW.total_marks:=marks_sum;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_validate_assessment_questions_before_publish ON public.assessments;
-- INSERT with status=published is rejected unless a complete valid assessment
-- already exists; this closes the direct-insert path beyond the app's draft API.
CREATE TRIGGER trg_validate_assessment_questions_before_publish BEFORE INSERT OR UPDATE OF status
  ON public.assessments FOR EACH ROW EXECUTE FUNCTION public.validate_assessment_questions_before_publish();

-- Once an assessment is published, or any linked module is published/archived,
-- freeze question and option structure. Legacy drafts remain editable.
CREATE OR REPLACE FUNCTION public.guard_linked_assessment_content_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE ids UUID[]; aid UUID; qid UUID; a_status TEXT;
BEGIN
  IF TG_TABLE_NAME='assessment_questions' THEN
    IF TG_OP='INSERT' THEN ids:=ARRAY[NEW.assessment_id];
    ELSIF TG_OP='DELETE' THEN ids:=ARRAY[OLD.assessment_id];
    ELSE ids:=ARRAY[OLD.assessment_id,NEW.assessment_id]; END IF;
  ELSE
    qid:=CASE WHEN TG_OP='DELETE' THEN OLD.question_id ELSE NEW.question_id END;
    SELECT assessment_id INTO aid FROM public.assessment_questions WHERE id=qid;
    IF TG_OP='DELETE' AND NOT FOUND THEN RETURN OLD; END IF;
    ids:=ARRAY[aid];
    IF TG_OP='UPDATE' AND NEW.question_id IS DISTINCT FROM OLD.question_id THEN
      SELECT assessment_id INTO aid FROM public.assessment_questions WHERE id=OLD.question_id;
      ids:=array_append(ids,aid);
    END IF;
  END IF;
  FOREACH aid IN ARRAY ids LOOP
    IF aid IS NULL THEN RAISE EXCEPTION 'Content must belong to an existing assessment.'; END IF;
    SELECT status INTO a_status FROM public.assessments WHERE id=aid;
    IF a_status<>'draft' OR EXISTS(SELECT 1 FROM public.module_assessment_links l
      JOIN public.learning_modules m ON m.id=l.module_id WHERE l.assessment_id=aid AND m.status IN('published','archived')) THEN
      RAISE EXCEPTION 'Question and option structure is frozen after publication.';
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_linked_assessment_question_mutation ON public.assessment_questions;
CREATE TRIGGER trg_guard_linked_assessment_question_mutation BEFORE INSERT OR UPDATE OR DELETE ON public.assessment_questions
  FOR EACH ROW EXECUTE FUNCTION public.guard_linked_assessment_content_mutation();
DROP TRIGGER IF EXISTS trg_guard_linked_assessment_option_mutation ON public.assessment_options;
CREATE TRIGGER trg_guard_linked_assessment_option_mutation BEFORE INSERT OR UPDATE OR DELETE ON public.assessment_options
  FOR EACH ROW EXECUTE FUNCTION public.guard_linked_assessment_content_mutation();

-- H. New-table RLS and explicit grants. Admins may manage draft records, but
--    triggers prohibit post-publication source deletion or provenance mutation.
ALTER TABLE public.assessment_source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_question_source_references ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all_assessment_source_documents" ON public.assessment_source_documents;
CREATE POLICY "admin_all_assessment_source_documents" ON public.assessment_source_documents FOR ALL TO authenticated
  USING(public.is_admin()) WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS "mentor_read_own_assessment_source_documents" ON public.assessment_source_documents;
CREATE POLICY "mentor_read_own_assessment_source_documents" ON public.assessment_source_documents FOR SELECT TO authenticated
  USING(uploaded_by=auth.uid() AND EXISTS(SELECT 1 FROM public.assessments a JOIN public.learning_modules m ON m.id=module_id
    WHERE a.id=assessment_id AND a.mentor_id=auth.uid() AND m.created_by=auth.uid()));
DROP POLICY IF EXISTS "mentor_insert_draft_assessment_source_documents" ON public.assessment_source_documents;
CREATE POLICY "mentor_insert_draft_assessment_source_documents" ON public.assessment_source_documents FOR INSERT TO authenticated
  WITH CHECK(uploaded_by=auth.uid() AND EXISTS(SELECT 1 FROM public.assessments a JOIN public.learning_modules m ON m.id=module_id
    JOIN public.profiles p ON p.id=auth.uid() WHERE a.id=assessment_id AND a.mentor_id=auth.uid() AND a.status='draft'
      AND m.created_by=auth.uid() AND m.status='draft' AND p.role IN('mentor','admin') AND p.is_active));
DROP POLICY IF EXISTS "mentor_update_own_assessment_source_documents" ON public.assessment_source_documents;
CREATE POLICY "mentor_update_own_assessment_source_documents" ON public.assessment_source_documents FOR UPDATE TO authenticated
  USING(uploaded_by=auth.uid() AND EXISTS(SELECT 1 FROM public.assessments a JOIN public.learning_modules m ON m.id=module_id
    JOIN public.profiles p ON p.id=auth.uid() WHERE a.id=assessment_id AND a.mentor_id=auth.uid() AND a.status='draft'
      AND m.created_by=auth.uid() AND m.status='draft' AND p.role IN('mentor','admin') AND p.is_active))
  WITH CHECK(uploaded_by=auth.uid() AND EXISTS(SELECT 1 FROM public.assessments a JOIN public.learning_modules m ON m.id=module_id
    JOIN public.profiles p ON p.id=auth.uid() WHERE a.id=assessment_id AND a.mentor_id=auth.uid() AND a.status='draft'
      AND m.created_by=auth.uid() AND m.status='draft' AND p.role IN('mentor','admin') AND p.is_active));
DROP POLICY IF EXISTS "mentor_delete_own_assessment_source_documents" ON public.assessment_source_documents;
CREATE POLICY "mentor_delete_own_assessment_source_documents" ON public.assessment_source_documents FOR DELETE TO authenticated
  USING(uploaded_by=auth.uid() AND EXISTS(SELECT 1 FROM public.assessments a JOIN public.learning_modules m ON m.id=module_id
    JOIN public.profiles p ON p.id=auth.uid() WHERE a.id=assessment_id AND a.mentor_id=auth.uid()
      AND m.created_by=auth.uid() AND p.role='mentor' AND p.is_active));

DROP POLICY IF EXISTS "admin_all_assessment_question_source_references" ON public.assessment_question_source_references;
CREATE POLICY "admin_all_assessment_question_source_references" ON public.assessment_question_source_references FOR ALL TO authenticated
  USING(public.is_admin()) WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS "mentor_manage_own_assessment_question_source_references" ON public.assessment_question_source_references;
CREATE POLICY "mentor_read_own_assessment_question_source_references" ON public.assessment_question_source_references FOR SELECT TO authenticated
  USING(EXISTS(SELECT 1 FROM public.assessments a WHERE a.id=assessment_id AND a.mentor_id=auth.uid()));
CREATE POLICY "mentor_insert_draft_assessment_question_source_references" ON public.assessment_question_source_references FOR INSERT TO authenticated
  WITH CHECK(EXISTS(SELECT 1 FROM public.assessments a JOIN public.assessment_source_documents d ON d.id=source_document_id AND d.assessment_id=a.id
    JOIN public.learning_modules m ON m.id=d.module_id JOIN public.profiles p ON p.id=auth.uid()
    WHERE a.id=assessment_id AND a.mentor_id=auth.uid() AND a.status='draft' AND m.created_by=auth.uid() AND m.status='draft'
      AND p.role='mentor' AND p.is_active));
CREATE POLICY "mentor_update_draft_assessment_question_source_references" ON public.assessment_question_source_references FOR UPDATE TO authenticated
  USING(EXISTS(SELECT 1 FROM public.assessments a JOIN public.assessment_source_documents d ON d.id=source_document_id AND d.assessment_id=a.id
    JOIN public.learning_modules m ON m.id=d.module_id JOIN public.profiles p ON p.id=auth.uid()
    WHERE a.id=assessment_id AND a.mentor_id=auth.uid() AND a.status='draft' AND m.created_by=auth.uid() AND m.status='draft'
      AND p.role='mentor' AND p.is_active))
  WITH CHECK(EXISTS(SELECT 1 FROM public.assessments a JOIN public.assessment_source_documents d ON d.id=source_document_id AND d.assessment_id=a.id
    JOIN public.learning_modules m ON m.id=d.module_id JOIN public.profiles p ON p.id=auth.uid()
    WHERE a.id=assessment_id AND a.mentor_id=auth.uid() AND a.status='draft' AND m.created_by=auth.uid() AND m.status='draft'
      AND p.role='mentor' AND p.is_active));
CREATE POLICY "mentor_delete_draft_assessment_question_source_references" ON public.assessment_question_source_references FOR DELETE TO authenticated
  USING(EXISTS(SELECT 1 FROM public.assessments a JOIN public.assessment_source_documents d ON d.id=source_document_id AND d.assessment_id=a.id
    JOIN public.learning_modules m ON m.id=d.module_id JOIN public.profiles p ON p.id=auth.uid()
    WHERE a.id=assessment_id AND a.mentor_id=auth.uid() AND a.status='draft' AND m.created_by=auth.uid() AND m.status='draft'
      AND p.role='mentor' AND p.is_active));

REVOKE ALL ON public.assessment_source_documents,public.assessment_question_source_references FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.assessment_source_documents,public.assessment_question_source_references TO authenticated;
GRANT ALL ON public.assessment_source_documents,public.assessment_question_source_references TO service_role;
CREATE INDEX IF NOT EXISTS idx_assessment_source_documents_workflow ON public.assessment_source_documents(module_id,assessment_id,uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessment_question_source_refs_question ON public.assessment_question_source_references(assessment_id,question_id);
CREATE INDEX IF NOT EXISTS idx_assessment_question_source_refs_document ON public.assessment_question_source_references(source_document_id);

-- I. Verify SECURITY DEFINER owner against EVERY queried RLS table, not only
--    assessments. Tables queried: assessments, profiles, attempts, module links,
--    modules, enrollments, module assignments, legacy assessment assignments,
--    and student_details. A BYPASSRLS owner satisfies the check globally.
DO $$
DECLARE fn_owner OID; bypasses BOOLEAN; rel regclass; rel_owner OID; rls BOOLEAN; force_rls BOOLEAN;
BEGIN
  SELECT proowner INTO fn_owner FROM pg_proc WHERE oid='public.can_student_access_assessment(uuid)'::regprocedure;
  SELECT rolbypassrls INTO bypasses FROM pg_roles WHERE oid=fn_owner;
  FOREACH rel IN ARRAY ARRAY[
    'public.assessments'::regclass,'public.profiles'::regclass,'public.assessment_attempts'::regclass,
    'public.module_assessment_links'::regclass,'public.learning_modules'::regclass,
    'public.student_module_enrollments'::regclass,'public.module_assignments'::regclass,
    'public.assessment_assignments'::regclass,'public.student_details'::regclass
  ] LOOP
    SELECT relowner,relrowsecurity,relforcerowsecurity INTO rel_owner,rls,force_rls
      FROM pg_class WHERE oid=rel;
    IF NOT has_table_privilege(fn_owner,rel,'SELECT') THEN
      RAISE EXCEPTION 'can_student_access_assessment owner lacks SELECT on queried table %.',rel;
    END IF;
    IF rls AND NOT coalesce(bypasses,false)
       AND (force_rls OR fn_owner IS DISTINCT FROM rel_owner) THEN
      RAISE EXCEPTION 'can_student_access_assessment owner cannot bypass RLS on queried table % (FORCE RLS or non-owner).',rel::regclass;
    END IF;
  END LOOP;
END $$;

-- J. Reconcile permissive SELECT policies from migration 000005. PostgreSQL
--    combines permissive policies with OR, so replacing only the options view is
--    insufficient. Drop/replace the exact student policies; leave mentor/admin
--    policies (and all write policies) untouched.
--    Inspected names: student_view_assigned_assessments,
--    student_view_assessment_questions, student_view_assessment_options.
DROP POLICY IF EXISTS "student_view_assigned_assessments" ON public.assessments;
CREATE POLICY "student_view_assigned_assessments" ON public.assessments FOR SELECT TO authenticated
  USING(public.can_student_access_assessment(id));
DROP POLICY IF EXISTS "student_view_assessment_questions" ON public.assessment_questions;
CREATE POLICY "student_view_assessment_questions" ON public.assessment_questions FOR SELECT TO authenticated
  USING(public.can_student_access_assessment(assessment_id));
DROP POLICY IF EXISTS "student_view_assessment_options" ON public.assessment_options;
CREATE POLICY "student_view_assessment_options" ON public.assessment_options FOR SELECT TO authenticated
  USING(EXISTS(SELECT 1 FROM public.assessment_questions q WHERE q.id=question_id
    AND public.can_student_access_assessment(q.assessment_id)));

-- PostgreSQL 15+ invoker view uses caller privileges and RLS. security_barrier
-- prevents predicate pushdown. The owner is not an authorization boundary.
CREATE OR REPLACE VIEW public.student_assessment_options
  WITH(security_barrier=true,security_invoker=true) AS
SELECT o.id,o.question_id,o.option_order,o.option_text,o.created_at
FROM public.assessment_options o JOIN public.assessment_questions q ON q.id=o.question_id
WHERE public.can_student_access_assessment(q.assessment_id);
REVOKE ALL ON public.student_assessment_options FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.student_assessment_options TO authenticated;
-- Explicitly verify security options/owner metadata; no owner is assumed.
DO $$
DECLARE view_owner OID; options TEXT[];
BEGIN
  SELECT relowner,reloptions INTO view_owner,options FROM pg_class WHERE oid='public.student_assessment_options'::regclass;
  IF view_owner IS NULL OR NOT coalesce(options @> ARRAY['security_invoker=true','security_barrier=true'],false) THEN
    RAISE EXCEPTION 'Student options view lacks required invoker/barrier security settings.';
  END IF;
  RAISE NOTICE 'Student options view owner OID for deployment review: %',view_owner;
END $$;

-- New-object grants are explicit. RLS limits authenticated source/provenance
-- writes; service_role remains backend-only. No authenticated Storage policies.
-- Revoke all answer-option table SELECT, then grant only non-secret columns.
REVOKE SELECT ON public.assessment_options FROM PUBLIC,anon,authenticated;
REVOKE SELECT(is_correct) ON public.assessment_options FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,question_id,option_order,option_text,created_at) ON public.assessment_options TO authenticated;
GRANT SELECT ON public.assessment_options TO service_role;
REVOKE ALL ON public.assessment_source_documents,public.assessment_question_source_references FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.assessment_source_documents,public.assessment_question_source_references TO authenticated;
GRANT ALL ON public.assessment_source_documents,public.assessment_question_source_references TO service_role;

-- K. Private Storage bucket: create when absent; verify exact settings if present.
DO $$
DECLARE b storage.buckets%ROWTYPE; allowed_mimes TEXT[] := ARRAY[
  'application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain']::TEXT[];
BEGIN
  SELECT * INTO b FROM storage.buckets WHERE id='assessment-source-materials';
  IF NOT FOUND THEN
    INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      VALUES('assessment-source-materials','assessment-source-materials',false,26214400,allowed_mimes);
  ELSIF b.public IS DISTINCT FROM false OR b.file_size_limit IS DISTINCT FROM 26214400
    OR b.allowed_mime_types IS NULL OR cardinality(b.allowed_mime_types)<>cardinality(allowed_mimes)
    OR NOT(b.allowed_mime_types @> allowed_mimes AND b.allowed_mime_types <@ allowed_mimes) THEN
    RAISE EXCEPTION 'Existing source bucket privacy, size, or MIME configuration is incompatible.';
  END IF;
END $$;

-- L. PRE-FLIGHT before promotion to an executable migration:
-- 1) PostgreSQL >=15; confirm migration role and can_student_access_assessment
--    owner satisfy the per-RLS-table ownership/BYPASSRLS assertion above.
-- 2) Inspect live question_type constraint name/definition and values; validate
--    assessment_questions_type_check only after checking existing rows.
-- 3) Audit assessment_assignments student_id/cohort_id pairs against
--    student_details.cohort_id; preserve NULL cohort individual assignments.
-- 4) Audit assigned enrollments for matching module_assignments(id,module_id,
--    student_id), and inspect assigned/revoked/completed lifecycle states.
-- 5) Reconfirm exact existing student/mentor/admin policies and any additional
--    permissive student SELECT policies before applying these replacements.
-- 6) Review source-document records/object paths and any published source data;
--    this draft never deletes existing records. No admin post-publication delete.
-- 7) Verify Storage bucket exists/configuration, project size caps, and that
--    service_role is backend-only; backend must authorize every object operation.
-- 8) Confirm no incompatible existing student_assessment_options view/grants.
-- 9) Validate new NOT VALID constraints after clean data review. No existing
--    attempts, scores, answers, total marks, or passing_marks are rewritten.

COMMIT;


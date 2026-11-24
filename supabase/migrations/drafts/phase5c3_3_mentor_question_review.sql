-- DRAFT ONLY — Phase 5C.3.3 mentor review, approval and question history.
-- Do not execute automatically. Existing question and provenance rows are retained.
BEGIN;

-- Executable preflight: requires the reviewed Phase 5C.3.2 generation schema.
DO $$
BEGIN
 IF to_regclass('public.assessment_question_generation_jobs') IS NULL OR
    to_regclass('public.assessment_question_source_references') IS NULL OR
    to_regclass('public.assessment_source_document_extractions') IS NULL OR
    to_regclass('public.module_assessment_links') IS NULL THEN
   RAISE EXCEPTION 'Apply/review the Phase 5C.1–5C.3.2 foundation drafts before this migration.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assessment_questions' AND column_name='generation_job_id') THEN
   RAISE EXCEPTION 'assessment_questions.generation_job_id is required.';
 END IF;
 IF to_regprocedure('public.assessment_student_is_eligible(uuid,uuid)') IS NULL THEN
   RAISE EXCEPTION 'Phase 5C.2 public.assessment_student_is_eligible(uuid,uuid) is required.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role' AND rolbypassrls) THEN
   RAISE EXCEPTION 'service_role must bypass RLS for the server-only review RPCs.';
 END IF;
END $$;

ALTER TABLE public.assessment_questions
  ADD COLUMN IF NOT EXISTS mentor_edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS removed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS removal_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_regeneration_job_id UUID;

CREATE TABLE IF NOT EXISTS public.assessment_question_regenerations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), question_id UUID NOT NULL REFERENCES public.assessment_questions(id) ON DELETE RESTRICT,
  assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE RESTRICT,
  module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE RESTRICT,
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  idempotency_key UUID NOT NULL, lease_token UUID NOT NULL DEFAULT gen_random_uuid(),
  question_updated_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('processing','completed','failed')),
  selected_sources JSONB NOT NULL, request_metadata JSONB NOT NULL,
  actual_model TEXT, candidate JSONB, error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),completed_at TIMESTAMPTZ,
  UNIQUE(question_id,idempotency_key)
);
ALTER TABLE public.assessment_question_regenerations ADD COLUMN IF NOT EXISTS question_updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS assessment_question_regeneration_history_idx ON public.assessment_question_regenerations(question_id,created_at DESC);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.assessment_questions'::regclass AND conname='assessment_questions_last_regeneration_fk') THEN
  ALTER TABLE public.assessment_questions ADD CONSTRAINT assessment_questions_last_regeneration_fk
    FOREIGN KEY(last_regeneration_job_id) REFERENCES public.assessment_question_regenerations(id) ON DELETE RESTRICT;
 END IF;
END $$;
ALTER TABLE public.assessment_question_regenerations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_question_regenerations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assessment_question_regenerations_service_only ON public.assessment_question_regenerations;
CREATE POLICY assessment_question_regenerations_service_only ON public.assessment_question_regenerations FOR ALL TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON public.assessment_question_regenerations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.assessment_question_regenerations TO service_role;

CREATE TABLE IF NOT EXISTS public.assessment_question_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.assessment_questions(id) ON DELETE RESTRICT,
  assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE RESTRICT,
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN ('edited','regenerated','approved','rejected')),
  revision JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assessment_question_revisions_history_idx
  ON public.assessment_question_revisions(question_id,created_at DESC);
CREATE INDEX IF NOT EXISTS assessment_questions_active_approval_idx
  ON public.assessment_questions(assessment_id,is_approved) WHERE removed_at IS NULL AND generation_job_id IS NOT NULL;

-- Keep soft-rejected questions out of backend student content reads.
CREATE OR REPLACE FUNCTION public.student_assessment_content_for_backend(p_assessment_id UUID,p_student_id UUID)
RETURNS TABLE(question_id UUID,question_order INTEGER,question_type TEXT,question_text TEXT,marks NUMERIC,
  option_id UUID,option_order INTEGER,option_text TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,auth,pg_temp AS $$
 SELECT q.id,q.question_order,q.question_type,q.question_text,q.marks,o.id,o.option_order,o.option_text
 FROM public.assessment_questions q LEFT JOIN public.assessment_options o ON o.question_id=q.id
 WHERE q.assessment_id=p_assessment_id AND q.removed_at IS NULL
   AND public.assessment_student_is_eligible(p_assessment_id,p_student_id)
 ORDER BY q.question_order,o.option_order NULLS FIRST
$$;
REVOKE ALL ON FUNCTION public.student_assessment_content_for_backend(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.student_assessment_content_for_backend(UUID,UUID) TO service_role;

ALTER TABLE public.assessment_question_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_question_revisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assessment_question_revisions_service_only ON public.assessment_question_revisions;
CREATE POLICY assessment_question_revisions_service_only ON public.assessment_question_revisions
  FOR ALL TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON public.assessment_question_revisions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.assessment_question_revisions TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.assessment_questions TO service_role;
-- All question mutations now pass through the authenticated backend so approval,
-- provenance and audit fields cannot be changed through a direct client grant.
REVOKE INSERT,UPDATE,DELETE ON public.assessment_questions,public.assessment_options FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.guard_ai_question_review_fields()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE a public.assessments%ROWTYPE; m public.learning_modules%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.assessments WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.assessment_id ELSE NEW.assessment_id END FOR UPDATE;
  IF a.id IS NULL AND TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT lm.* INTO m FROM public.learning_modules lm JOIN public.module_assessment_links l ON l.module_id=lm.id WHERE l.assessment_id=a.id FOR UPDATE OF lm;
  IF a.status<>'draft' OR m.id IS NULL OR m.status<>'draft' OR m.created_by<>a.mentor_id OR (SELECT count(*) FROM public.module_assessment_links WHERE assessment_id=a.id)<>1 THEN RAISE EXCEPTION 'Question content is immutable outside a linked draft workflow.'; END IF;
  IF m.id IS NULL OR m.created_by<>a.mentor_id THEN RAISE EXCEPTION 'Assessment and module ownership must match.'; END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.generation_job_id IS NOT NULL THEN RAISE EXCEPTION 'AI-generated questions must use the audited rejection workflow.'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.removed_at IS NOT NULL AND NEW.removed_at IS NULL THEN
    RAISE EXCEPTION 'A removed question cannot be restored through a direct update; use a separate explicitly authorized and audited restore workflow.';
  END IF;
  IF TG_OP='UPDATE' AND OLD.generation_job_id IS NOT NULL AND
     (NEW.question_text IS DISTINCT FROM OLD.question_text OR NEW.question_type IS DISTINCT FROM OLD.question_type OR
      NEW.marks IS DISTINCT FROM OLD.marks OR NEW.explanation IS DISTINCT FROM OLD.explanation OR
      NEW.evaluation_guidance IS DISTINCT FROM OLD.evaluation_guidance OR
      NEW.generation_difficulty IS DISTINCT FROM OLD.generation_difficulty OR
      NEW.generation_cognitive_level IS DISTINCT FROM OLD.generation_cognitive_level OR
      NEW.generation_topic IS DISTINCT FROM OLD.generation_topic) THEN
    NEW.is_approved:=false; NEW.approved_by:=NULL; NEW.approved_at:=NULL;
    NEW.mentor_edited_at:=now();
  END IF;
  IF NEW.is_approved AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL) THEN
    RAISE EXCEPTION 'AI question approval requires an approver and timestamp.';
  END IF;
  IF NEW.removed_at IS NULL AND (NEW.removed_by IS NOT NULL OR NEW.removal_reason IS NOT NULL) THEN
    RAISE EXCEPTION 'Question removal metadata must be complete.';
  END IF;
  IF NEW.removed_at IS NOT NULL AND NEW.removed_by IS NULL THEN
    RAISE EXCEPTION 'Question removal requires an actor.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_ai_question_review_fields ON public.assessment_questions;
CREATE TRIGGER trg_guard_ai_question_review_fields BEFORE INSERT OR UPDATE OR DELETE ON public.assessment_questions
  FOR EACH ROW EXECUTE FUNCTION public.guard_ai_question_review_fields();

-- Option edits independently invalidate approval (options live in a child table).
CREATE OR REPLACE FUNCTION public.invalidate_ai_question_approval_on_option_change()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE qid UUID; q public.assessment_questions%ROWTYPE;
BEGIN
  qid:=CASE WHEN TG_OP='DELETE' THEN OLD.question_id ELSE NEW.question_id END;
  SELECT * INTO q FROM public.assessment_questions WHERE id=qid FOR UPDATE;
  IF FOUND AND EXISTS(SELECT 1 FROM public.assessments a WHERE a.id=q.assessment_id) THEN
    IF q.generation_job_id IS NOT NULL THEN
      UPDATE public.assessment_questions SET is_approved=false,approved_by=NULL,approved_at=NULL,mentor_edited_at=now(),updated_at=now() WHERE id=qid;
    ELSE
      UPDATE public.assessment_questions SET updated_at=now() WHERE id=qid;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_invalidate_ai_approval_option_change ON public.assessment_options;
CREATE TRIGGER trg_invalidate_ai_approval_option_change AFTER INSERT OR UPDATE OF option_order,option_text,is_correct OR DELETE
  ON public.assessment_options FOR EACH ROW EXECUTE FUNCTION public.invalidate_ai_question_approval_on_option_change();

CREATE OR REPLACE FUNCTION public.guard_assessment_option_draft()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE q public.assessment_questions%ROWTYPE; a public.assessments%ROWTYPE; m public.learning_modules%ROWTYPE; qid UUID;
BEGIN
 qid:=CASE WHEN TG_OP='DELETE' THEN OLD.question_id ELSE NEW.question_id END;
 SELECT * INTO q FROM public.assessment_questions WHERE id=qid FOR UPDATE;
 IF q.id IS NULL AND TG_OP='DELETE' THEN RETURN OLD; END IF;
 SELECT * INTO a FROM public.assessments WHERE id=q.assessment_id FOR UPDATE;
 IF a.id IS NULL AND TG_OP='DELETE' THEN RETURN OLD; END IF;
 SELECT lm.* INTO m FROM public.learning_modules lm JOIN public.module_assessment_links l ON l.module_id=lm.id WHERE l.assessment_id=q.assessment_id FOR UPDATE OF lm;
 IF a.status<>'draft' OR m.id IS NULL OR m.status<>'draft' OR m.created_by<>a.mentor_id OR (SELECT count(*) FROM public.module_assessment_links WHERE assessment_id=a.id)<>1 THEN RAISE EXCEPTION 'Question options are immutable outside a linked draft workflow.'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_assessment_option_draft ON public.assessment_options;
CREATE TRIGGER trg_guard_assessment_option_draft BEFORE INSERT OR UPDATE OR DELETE ON public.assessment_options
 FOR EACH ROW EXECUTE FUNCTION public.guard_assessment_option_draft();

-- Snapshot all pedagogically relevant fields, answer flags, source locations and
-- generation-job metadata. Storage paths and extracted source content are excluded.
CREATE OR REPLACE FUNCTION public.assessment_question_review_snapshot(p_question_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('question',to_jsonb(q)-'created_at'-'updated_at',
   'options',coalesce((SELECT jsonb_agg(jsonb_build_object('optionOrder',o.option_order,'optionText',o.option_text,'isCorrect',o.is_correct) ORDER BY o.option_order) FROM public.assessment_options o WHERE o.question_id=q.id),'[]'::jsonb),
   'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('documentId',r.source_document_id,'kind',r.location_kind,'start',r.location_start,'end',r.location_end)) FROM public.assessment_question_source_references r WHERE r.question_id=q.id),'[]'::jsonb),
   'generation',to_jsonb(j)-'selected_sources')
 FROM public.assessment_questions q LEFT JOIN public.assessment_question_generation_jobs j ON j.id=q.generation_job_id
 WHERE q.id=p_question_id
$$;

CREATE OR REPLACE FUNCTION public.assessment_question_answers_valid(p_question_id UUID,p_type TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN p_type='descriptive' THEN true ELSE
   (SELECT count(*) BETWEEN 2 AND 6 AND count(*) FILTER(WHERE is_correct)>=1
     AND (p_type NOT IN ('mcq','true_false') OR count(*) FILTER(WHERE is_correct)=1)
     AND (p_type<>'true_false' OR (count(*)=2 AND count(*) FILTER(WHERE lower(btrim(option_text))='true')=1 AND count(*) FILTER(WHERE lower(btrim(option_text))='false')=1))
    FROM public.assessment_options WHERE question_id=p_question_id) END
$$;

CREATE OR REPLACE FUNCTION public.assessment_review_actor_allowed(p_actor_id UUID,p_owner_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(p_actor_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_actor_id AND p.is_active
   AND ((p.role='mentor' AND p.id=p_owner_id) OR p.role='admin')),false)
$$;

CREATE OR REPLACE FUNCTION public.approve_assessment_question(p_assessment_id UUID,p_question_id UUID,p_actor_id UUID)
RETURNS TABLE(changed BOOLEAN, approved_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE a public.assessments%ROWTYPE; m public.learning_modules%ROWTYPE; q public.assessment_questions%ROWTYPE; stamp TIMESTAMPTZ:=now(); snap JSONB;
BEGIN
 IF auth.uid() IS NOT NULL OR current_user<>'service_role' THEN RAISE EXCEPTION 'Backend service role required.'; END IF;
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'Actor identity is required.'; END IF;
 PERFORM 1 FROM public.assessment_options WHERE question_id=p_question_id ORDER BY id FOR UPDATE;
 SELECT * INTO q FROM public.assessment_questions WHERE id=p_question_id AND assessment_id=p_assessment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Question not found.'; END IF;
 SELECT * INTO a FROM public.assessments WHERE id=p_assessment_id FOR UPDATE;
 SELECT lm.* INTO m FROM public.learning_modules lm JOIN public.module_assessment_links l ON l.module_id=lm.id WHERE l.assessment_id=p_assessment_id FOR UPDATE OF lm;
 IF p_actor_id IS NULL OR NOT public.assessment_review_actor_allowed(p_actor_id,a.mentor_id) THEN RAISE EXCEPTION 'Active assessment owner or admin required.'; END IF;
 IF a.status<>'draft' OR m.id IS NULL OR m.status<>'draft' OR (SELECT count(*) FROM public.module_assessment_links WHERE assessment_id=a.id)<>1 THEN RAISE EXCEPTION 'Draft ownership required.'; END IF;
 IF m.id IS NULL OR m.created_by<>a.mentor_id THEN RAISE EXCEPTION 'Assessment and module ownership must match.'; END IF;
 IF q.generation_job_id IS NULL OR q.removed_at IS NOT NULL THEN RAISE EXCEPTION 'Active AI-generated question required.'; END IF;
 IF q.question_type NOT IN ('mcq','multiple_select','true_false') OR char_length(btrim(q.question_text)) NOT BETWEEN 10 AND 600 OR q.marks<=0 THEN
   RAISE EXCEPTION 'Question text, type, or marks are invalid.'; END IF;
 IF q.is_approved THEN RETURN QUERY SELECT false,q.approved_at; RETURN; END IF;
 IF q.question_type IN ('mcq','multiple_select','true_false') AND NOT public.assessment_question_answers_valid(q.id,q.question_type) THEN RAISE EXCEPTION 'Question answer options are invalid.'; END IF;
 snap:=public.assessment_question_review_snapshot(q.id);
 UPDATE public.assessment_questions SET is_approved=true,approved_by=p_actor_id,approved_at=stamp WHERE id=q.id;
 INSERT INTO public.assessment_question_revisions(question_id,assessment_id,actor_id,action,revision) VALUES(q.id,p_assessment_id,p_actor_id,'approved',snap);
 RETURN QUERY SELECT true,stamp;
END $$;

CREATE OR REPLACE FUNCTION public.reject_assessment_question(p_assessment_id UUID,p_question_id UUID,p_actor_id UUID,p_reason TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE a public.assessments%ROWTYPE; m public.learning_modules%ROWTYPE; q public.assessment_questions%ROWTYPE; snap JSONB;
BEGIN
 IF auth.uid() IS NOT NULL OR current_user<>'service_role' THEN RAISE EXCEPTION 'Backend service role required.'; END IF;
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'Actor identity is required.'; END IF;
 PERFORM 1 FROM public.assessment_options WHERE question_id=p_question_id ORDER BY id FOR UPDATE;
 SELECT * INTO q FROM public.assessment_questions WHERE id=p_question_id AND assessment_id=p_assessment_id FOR UPDATE;
 IF NOT FOUND OR q.generation_job_id IS NULL THEN RAISE EXCEPTION 'Active AI-generated question required.'; END IF;
 SELECT * INTO a FROM public.assessments WHERE id=p_assessment_id FOR UPDATE;
 SELECT lm.* INTO m FROM public.learning_modules lm JOIN public.module_assessment_links l ON l.module_id=lm.id WHERE l.assessment_id=p_assessment_id FOR UPDATE OF lm;
 IF p_actor_id IS NULL OR NOT public.assessment_review_actor_allowed(p_actor_id,a.mentor_id) THEN RAISE EXCEPTION 'Active assessment owner or admin required.'; END IF;
 IF a.status<>'draft' OR m.id IS NULL OR m.status<>'draft' OR (SELECT count(*) FROM public.module_assessment_links WHERE assessment_id=a.id)<>1 THEN RAISE EXCEPTION 'Draft ownership required.'; END IF;
 IF m.id IS NULL OR m.created_by<>a.mentor_id THEN RAISE EXCEPTION 'Assessment and module ownership must match.'; END IF;
 IF q.removed_at IS NOT NULL THEN RETURN false; END IF;
 snap:=public.assessment_question_review_snapshot(q.id);
 UPDATE public.assessment_questions SET removed_at=now(),removed_by=p_actor_id,removal_reason=left(p_reason,500),is_approved=false,approved_by=NULL,approved_at=NULL WHERE id=q.id;
 INSERT INTO public.assessment_question_revisions(question_id,assessment_id,actor_id,action,revision) VALUES(q.id,p_assessment_id,p_actor_id,'rejected',snap||jsonb_build_object('reason',left(p_reason,500)));
 UPDATE public.assessments SET total_marks=(SELECT coalesce(sum(marks),0) FROM public.assessment_questions WHERE assessment_id=p_assessment_id AND removed_at IS NULL) WHERE id=p_assessment_id;
 RETURN true;
END $$;

-- Global lock order: child option rows by ID, question row(s) by ID, assessment,
-- module, then regeneration/history rows. Mutation RPCs prelock child rows before
-- question rows, matching the child-row triggers below.
CREATE OR REPLACE FUNCTION public.save_reviewed_assessment_question(
 p_assessment_id UUID,p_question_id UUID,p_actor_id UUID,p_type TEXT,p_text TEXT,p_marks NUMERIC,
 p_explanation TEXT,p_guidance TEXT,p_difficulty TEXT,p_cognitive TEXT,p_topic TEXT,p_options JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE q public.assessment_questions%ROWTYPE; a public.assessments%ROWTYPE; m public.learning_modules%ROWTYPE; opt JSONB;
BEGIN
 IF auth.uid() IS NOT NULL OR current_user<>'service_role' THEN RAISE EXCEPTION 'Backend service role required.'; END IF;
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'Actor identity is required.'; END IF;
 PERFORM 1 FROM public.assessment_options WHERE question_id=p_question_id ORDER BY id FOR UPDATE;
 SELECT * INTO q FROM public.assessment_questions WHERE id=p_question_id AND assessment_id=p_assessment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Question not found.'; END IF;
 SELECT * INTO a FROM public.assessments WHERE id=p_assessment_id FOR UPDATE;
 SELECT lm.* INTO m FROM public.learning_modules lm JOIN public.module_assessment_links l ON l.module_id=lm.id WHERE l.assessment_id=p_assessment_id FOR UPDATE OF lm;
 IF p_actor_id IS NULL OR NOT public.assessment_review_actor_allowed(p_actor_id,a.mentor_id) THEN RAISE EXCEPTION 'Active assessment owner or admin required.'; END IF;
 IF a.status<>'draft' OR m.id IS NULL OR m.status<>'draft' OR m.created_by<>a.mentor_id OR (SELECT count(*) FROM public.module_assessment_links WHERE assessment_id=a.id)<>1 THEN RAISE EXCEPTION 'Linked assessment and module must be owned drafts.'; END IF;
 IF q.removed_at IS NOT NULL THEN RAISE EXCEPTION 'Removed questions cannot be edited.'; END IF;
 IF p_type NOT IN ('mcq','multiple_select','true_false','descriptive') OR p_text IS NULL OR btrim(p_text)='' OR char_length(p_text)>600 OR p_marks IS NULL OR p_marks<=0 OR p_marks>999.99 THEN RAISE EXCEPTION 'Question fields are invalid.'; END IF;
 IF p_difficulty IS NOT NULL AND p_difficulty NOT IN ('easy','medium','hard') THEN RAISE EXCEPTION 'Difficulty is invalid.'; END IF;
 IF p_cognitive IS NOT NULL AND p_cognitive NOT IN ('remember','understand','apply','analyze','evaluate','create') THEN RAISE EXCEPTION 'Cognitive level is invalid.'; END IF;
 IF p_topic IS NOT NULL AND char_length(p_topic)>120 THEN RAISE EXCEPTION 'Topic is too long.'; END IF;
 IF jsonb_typeof(p_options) IS DISTINCT FROM 'array' OR jsonb_array_length(p_options)>6 THEN RAISE EXCEPTION 'Question options are invalid.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_options) WITH ORDINALITY item(value,ord)
   WHERE jsonb_typeof(value) IS DISTINCT FROM 'object' OR jsonb_typeof(value->'optionText') IS DISTINCT FROM 'string'
     OR jsonb_typeof(value->'isCorrect') IS DISTINCT FROM 'boolean' OR jsonb_typeof(value->'optionOrder') IS DISTINCT FROM 'number'
     OR (value->>'optionOrder') !~ '^[0-9]+$' OR (value->>'optionOrder')::int<>ord OR btrim(value->>'optionText')='') THEN
   RAISE EXCEPTION 'Option text, ordering and correct-answer flags are invalid.'; END IF;
 IF q.generation_job_id IS NOT NULL THEN
   INSERT INTO public.assessment_question_revisions(question_id,assessment_id,actor_id,action,revision)
     VALUES(q.id,p_assessment_id,p_actor_id,'edited',public.assessment_question_review_snapshot(q.id));
 END IF;
 UPDATE public.assessment_questions SET question_type=p_type,question_text=btrim(p_text),marks=p_marks,explanation=p_explanation,
   evaluation_guidance=p_guidance,generation_difficulty=p_difficulty,generation_cognitive_level=p_cognitive,generation_topic=p_topic,updated_at=now()
   WHERE id=q.id;
 DELETE FROM public.assessment_options WHERE question_id=q.id;
 FOR opt IN SELECT value FROM jsonb_array_elements(p_options) LOOP
   IF jsonb_typeof(opt)<>'object' OR jsonb_typeof(opt->'optionText')<>'string' OR jsonb_typeof(opt->'isCorrect')<>'boolean' THEN RAISE EXCEPTION 'Option fields are invalid.'; END IF;
   INSERT INTO public.assessment_options(question_id,option_order,option_text,is_correct)
     VALUES(q.id,(opt->>'optionOrder')::int,btrim(opt->>'optionText'),(opt->>'isCorrect')::boolean);
 END LOOP;
 IF p_type='descriptive' AND jsonb_array_length(p_options)<>0 THEN RAISE EXCEPTION 'Descriptive questions cannot include options.'; END IF;
 IF p_type='mcq' AND (jsonb_array_length(p_options)<2 OR (SELECT count(*) FROM jsonb_array_elements(p_options) x WHERE (x->>'isCorrect')::boolean)<>1) THEN RAISE EXCEPTION 'MCQ requires exactly one correct option.'; END IF;
 IF p_type='multiple_select' AND (jsonb_array_length(p_options)<2 OR (SELECT count(*) FROM jsonb_array_elements(p_options) x WHERE (x->>'isCorrect')::boolean)<1) THEN RAISE EXCEPTION 'Multiple select requires a correct option.'; END IF;
 IF p_type='true_false' AND (jsonb_array_length(p_options)<>2 OR (SELECT count(*) FROM jsonb_array_elements(p_options) x WHERE lower(btrim(x->>'optionText'))='true')<>1
   OR (SELECT count(*) FROM jsonb_array_elements(p_options) x WHERE lower(btrim(x->>'optionText'))='false')<>1
   OR (SELECT count(*) FROM jsonb_array_elements(p_options) x WHERE (x->>'isCorrect')::boolean)<>1) THEN RAISE EXCEPTION 'True/false options are invalid.'; END IF;
 UPDATE public.assessments SET total_marks=(SELECT coalesce(sum(marks),0) FROM public.assessment_questions WHERE assessment_id=p_assessment_id AND removed_at IS NULL) WHERE id=p_assessment_id;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.reorder_review_assessment_questions(p_assessment_id UUID,p_actor_id UUID,p_question_ids UUID[])
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE a public.assessments%ROWTYPE; m public.learning_modules%ROWTYPE; active_count INTEGER;
BEGIN
 IF auth.uid() IS NOT NULL OR current_user<>'service_role' THEN RAISE EXCEPTION 'Backend service role required.'; END IF;
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'Actor identity is required.'; END IF;
 PERFORM 1 FROM public.assessment_questions WHERE assessment_id=p_assessment_id AND removed_at IS NULL ORDER BY id FOR UPDATE;
 SELECT * INTO a FROM public.assessments WHERE id=p_assessment_id FOR UPDATE;
 SELECT lm.* INTO m FROM public.learning_modules lm JOIN public.module_assessment_links l ON l.module_id=lm.id WHERE l.assessment_id=p_assessment_id FOR UPDATE OF lm;
 IF p_actor_id IS NULL OR NOT public.assessment_review_actor_allowed(p_actor_id,a.mentor_id) THEN RAISE EXCEPTION 'Active assessment owner or admin required.'; END IF;
 IF a.status<>'draft' OR m.id IS NULL OR m.status<>'draft' OR m.created_by<>a.mentor_id OR (SELECT count(*) FROM public.module_assessment_links WHERE assessment_id=a.id)<>1 THEN RAISE EXCEPTION 'Linked assessment and module must be owned drafts.'; END IF;
 SELECT count(*) INTO active_count FROM public.assessment_questions WHERE assessment_id=p_assessment_id AND removed_at IS NULL;
 IF coalesce(cardinality(p_question_ids),0)<>active_count OR (SELECT count(DISTINCT id) FROM unnest(p_question_ids) id)<>active_count
   OR EXISTS(SELECT 1 FROM public.assessment_questions q WHERE q.assessment_id=p_assessment_id AND q.removed_at IS NULL AND NOT(q.id=ANY(p_question_ids)))
   OR EXISTS(SELECT 1 FROM unnest(p_question_ids) requested(id) WHERE NOT EXISTS(SELECT 1 FROM public.assessment_questions q WHERE q.id=requested.id AND q.assessment_id=p_assessment_id AND q.removed_at IS NULL))
   THEN RAISE EXCEPTION 'Question order must contain every active question exactly once.'; END IF;
 UPDATE public.assessment_questions q SET question_order=ordered.ordinality,updated_at=now()
  FROM unnest(p_question_ids) WITH ORDINALITY ordered(id,ordinality) WHERE q.id=ordered.id;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.delete_manual_assessment_question(p_assessment_id UUID,p_question_id UUID,p_actor_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE q public.assessment_questions%ROWTYPE; a public.assessments%ROWTYPE; m public.learning_modules%ROWTYPE;
BEGIN
 IF auth.uid() IS NOT NULL OR current_user<>'service_role' THEN RAISE EXCEPTION 'Backend service role required.'; END IF;
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'Actor identity is required.'; END IF;
 PERFORM 1 FROM public.assessment_options WHERE question_id=p_question_id ORDER BY id FOR UPDATE;
 SELECT * INTO q FROM public.assessment_questions WHERE id=p_question_id AND assessment_id=p_assessment_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF q.generation_job_id IS NOT NULL THEN RAISE EXCEPTION 'AI-generated questions must use the audited rejection workflow.'; END IF;
 SELECT * INTO a FROM public.assessments WHERE id=p_assessment_id FOR UPDATE;
 SELECT lm.* INTO m FROM public.learning_modules lm JOIN public.module_assessment_links l ON l.module_id=lm.id WHERE l.assessment_id=p_assessment_id FOR UPDATE OF lm;
 IF p_actor_id IS NULL OR NOT public.assessment_review_actor_allowed(p_actor_id,a.mentor_id) THEN RAISE EXCEPTION 'Active assessment owner or admin required.'; END IF;
 IF a.status<>'draft' OR m.id IS NULL OR m.status<>'draft' OR m.created_by<>a.mentor_id OR (SELECT count(*) FROM public.module_assessment_links WHERE assessment_id=a.id)<>1 THEN RAISE EXCEPTION 'Linked assessment and module must be owned drafts.'; END IF;
 DELETE FROM public.assessment_questions WHERE id=q.id;
 UPDATE public.assessments SET total_marks=(SELECT coalesce(sum(marks),0) FROM public.assessment_questions WHERE assessment_id=p_assessment_id AND removed_at IS NULL) WHERE id=p_assessment_id;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.begin_assessment_question_regeneration(p_assessment_id UUID,p_question_id UUID,p_actor_id UUID,p_key UUID)
RETURNS TABLE(job_id UUID,lease_token UUID,selected_sources JSONB,request_metadata JSONB)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE q public.assessment_questions%ROWTYPE; a public.assessments%ROWTYPE; m public.learning_modules%ROWTYPE; j public.assessment_question_regenerations%ROWTYPE; src JSONB; meta JSONB; jid UUID:=gen_random_uuid(); lease UUID:=gen_random_uuid();
BEGIN
 IF auth.uid() IS NOT NULL OR current_user<>'service_role' THEN RAISE EXCEPTION 'Backend service role required.'; END IF;
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'Actor identity is required.'; END IF;
 PERFORM 1 FROM public.assessment_options WHERE question_id=p_question_id ORDER BY id FOR UPDATE;
 SELECT * INTO q FROM public.assessment_questions WHERE id=p_question_id AND assessment_id=p_assessment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Question not found.'; END IF;
 SELECT * INTO a FROM public.assessments WHERE id=p_assessment_id FOR UPDATE;
 SELECT lm.* INTO m FROM public.learning_modules lm JOIN public.module_assessment_links l ON l.module_id=lm.id WHERE l.assessment_id=p_assessment_id FOR UPDATE OF lm;
 IF p_actor_id IS NULL OR NOT public.assessment_review_actor_allowed(p_actor_id,a.mentor_id) THEN RAISE EXCEPTION 'Active assessment owner or admin required.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_question_id::text||':'||p_key::text,0));
 SELECT * INTO j FROM public.assessment_question_regenerations WHERE question_id=p_question_id AND idempotency_key=p_key FOR UPDATE;
 IF m.id IS NULL OR m.created_by<>a.mentor_id OR (SELECT count(*) FROM public.module_assessment_links WHERE assessment_id=a.id)<>1 THEN RAISE EXCEPTION 'Assessment and module ownership must match.'; END IF;
 IF j.id IS NOT NULL AND j.status='completed' THEN RETURN QUERY SELECT j.id,j.lease_token,j.selected_sources,j.request_metadata; RETURN; END IF;
 IF q.id IS NULL OR q.generation_job_id IS NULL OR q.removed_at IS NOT NULL OR a.status<>'draft' OR m.id IS NULL OR m.status<>'draft'
   OR (SELECT count(*) FROM public.module_assessment_links WHERE assessment_id=a.id)<>1
   THEN RAISE EXCEPTION 'Draft AI question workflow is not authorized.'; END IF;
 IF j.id IS NOT NULL AND j.status='processing' AND j.updated_at>now()-interval '5 minutes' THEN RAISE EXCEPTION 'regeneration_in_progress'; END IF;
 SELECT selected_sources,request_metadata INTO src,meta FROM public.assessment_question_generation_jobs WHERE id=q.generation_job_id AND assessment_id=p_assessment_id;
 IF src IS NULL OR meta IS NULL THEN RAISE EXCEPTION 'Original generation constraints are unavailable.'; END IF;
 IF j.id IS NULL THEN INSERT INTO public.assessment_question_regenerations(id,question_id,assessment_id,module_id,actor_id,idempotency_key,lease_token,question_updated_at,status,selected_sources,request_metadata)
   VALUES(jid,p_question_id,p_assessment_id,m.id,p_actor_id,p_key,lease,q.updated_at,'processing',src,meta) RETURNING * INTO j;
 ELSE UPDATE public.assessment_question_regenerations SET actor_id=p_actor_id,lease_token=lease,question_updated_at=q.updated_at,status='processing',candidate=NULL,error_code=NULL,updated_at=now() WHERE id=j.id RETURNING * INTO j; END IF;
 RETURN QUERY SELECT j.id,j.lease_token,j.selected_sources,j.request_metadata;
END $$;

CREATE OR REPLACE FUNCTION public.fail_assessment_question_regeneration(p_job_id UUID,p_lease UUID,p_actor_id UUID,p_error TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE j public.assessment_question_regenerations%ROWTYPE; owner_id UUID;
BEGIN
 IF auth.uid() IS NOT NULL OR current_user<>'service_role' THEN RAISE EXCEPTION 'Backend service role required.'; END IF;
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'Actor identity is required.'; END IF;
 SELECT * INTO j FROM public.assessment_question_regenerations WHERE id=p_job_id;
 SELECT mentor_id INTO owner_id FROM public.assessments WHERE id=j.assessment_id;
 IF p_actor_id IS NULL OR j.actor_id IS DISTINCT FROM p_actor_id OR NOT public.assessment_review_actor_allowed(p_actor_id,owner_id) THEN RAISE EXCEPTION 'Active regeneration actor required.'; END IF;
 UPDATE public.assessment_question_regenerations SET status='failed',error_code=left(p_error,80),updated_at=now()
 WHERE id=p_job_id AND lease_token=p_lease AND status='processing'; RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.complete_assessment_question_regeneration(p_job_id UUID,p_lease UUID,p_candidate JSONB,p_model TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE j public.assessment_question_regenerations%ROWTYPE; q public.assessment_questions%ROWTYPE; a public.assessments%ROWTYPE; m public.learning_modules%ROWTYPE; opt JSONB; ref JSONB; snap JSONB;
BEGIN
 IF auth.uid() IS NOT NULL OR current_user<>'service_role' OR p_model IS NULL OR NOT (p_model IN ('openrouter/free','openai/gpt-oss-120b','openai/gpt-oss-20b') OR p_model ~ '^[^/[:space:]]+/[^[:space:]]+:free$') THEN RAISE EXCEPTION 'Regeneration service or model is invalid.'; END IF;
 SELECT * INTO j FROM public.assessment_question_regenerations WHERE id=p_job_id;
 IF j.id IS NULL THEN RAISE EXCEPTION 'Regeneration job not found.'; END IF;
 PERFORM 1 FROM public.assessment_options WHERE question_id=j.question_id ORDER BY id FOR UPDATE;
 SELECT * INTO q FROM public.assessment_questions WHERE id=j.question_id AND assessment_id=j.assessment_id FOR UPDATE;
 SELECT * INTO a FROM public.assessments WHERE id=j.assessment_id FOR UPDATE;
 SELECT * INTO m FROM public.learning_modules WHERE id=j.module_id FOR UPDATE;
 SELECT * INTO j FROM public.assessment_question_regenerations WHERE id=p_job_id FOR UPDATE;
 IF j.id IS NULL OR j.status<>'processing' OR j.lease_token<>p_lease THEN RAISE EXCEPTION 'Regeneration lease is no longer current.'; END IF;
 IF j.actor_id IS NULL OR NOT public.assessment_review_actor_allowed(j.actor_id,a.mentor_id) THEN RAISE EXCEPTION 'Active assessment owner or admin required.'; END IF;
 IF a.status<>'draft' OR m.status<>'draft' OR m.created_by<>a.mentor_id OR q.removed_at IS NOT NULL OR q.generation_job_id IS NULL
   OR q.updated_at IS DISTINCT FROM j.question_updated_at OR (SELECT count(*) FROM public.module_assessment_links WHERE assessment_id=a.id)<>1
   OR NOT EXISTS(SELECT 1 FROM public.module_assessment_links WHERE assessment_id=a.id AND module_id=m.id AND module_id=j.module_id) THEN
   RAISE EXCEPTION 'Draft question changed or workflow became stale during regeneration.'; END IF;
 IF jsonb_typeof(p_candidate)<>'object' OR p_candidate - ARRAY['questionType','questionText','options','explanation','marks','difficulty','cognitiveLevel','topic','sourceReferences'] <> '{}'::jsonb
   OR p_candidate->>'questionType' NOT IN ('mcq','multiple_select','true_false') OR jsonb_typeof(p_candidate->'options')<>'array'
   OR jsonb_typeof(p_candidate->'sourceReferences')<>'array' OR jsonb_typeof(p_candidate->'questionText')<>'string'
   OR char_length(btrim(p_candidate->>'questionText')) NOT BETWEEN 10 AND 600 OR jsonb_typeof(p_candidate->'marks')<>'number'
   OR (p_candidate->>'marks')::numeric<=0 OR (p_candidate->>'marks')::numeric>100 THEN RAISE EXCEPTION 'Regenerated candidate shape is invalid.'; END IF;
 IF jsonb_array_length(p_candidate->'options') NOT BETWEEN 2 AND 6
   OR (SELECT count(*) FILTER(WHERE (x->>'isCorrect')::boolean)<1 FROM jsonb_array_elements(p_candidate->'options') x)
   OR (p_candidate->>'questionType' IN ('mcq','true_false') AND (SELECT count(*) FILTER(WHERE (x->>'isCorrect')::boolean)<>1 FROM jsonb_array_elements(p_candidate->'options') x))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_candidate->'options') x WHERE jsonb_typeof(x)<>'object' OR jsonb_typeof(x->'text')<>'string' OR jsonb_typeof(x->'isCorrect')<>'boolean' OR char_length(btrim(x->>'text'))=0) THEN
   RAISE EXCEPTION 'Regenerated candidate options are invalid.'; END IF;
 IF p_candidate->>'difficulty' NOT IN ('easy','medium','hard') OR p_candidate->>'cognitiveLevel' NOT IN ('remember','understand','apply','analyze','evaluate','create')
   OR char_length(btrim(coalesce(p_candidate->>'topic',''))) NOT BETWEEN 1 AND 120
   OR (p_candidate->>'questionType'='true_false' AND ((SELECT count(*) FROM jsonb_array_elements(p_candidate->'options') x WHERE lower(btrim(x->>'text'))='true')<>1
     OR (SELECT count(*) FROM jsonb_array_elements(p_candidate->'options') x WHERE lower(btrim(x->>'text'))='false')<>1)) THEN RAISE EXCEPTION 'Regenerated question metadata is invalid.'; END IF;
 snap:=public.assessment_question_review_snapshot(q.id);
 INSERT INTO public.assessment_question_revisions(question_id,assessment_id,actor_id,action,revision)
   VALUES(q.id,j.assessment_id,j.actor_id,'regenerated',snap||jsonb_build_object('regenerationJobId',j.id));
 UPDATE public.assessment_questions SET question_type=p_candidate->>'questionType',question_text=btrim(p_candidate->>'questionText'),marks=(p_candidate->>'marks')::numeric,
   explanation=p_candidate->>'explanation',generation_difficulty=p_candidate->>'difficulty',generation_cognitive_level=p_candidate->>'cognitiveLevel',generation_topic=p_candidate->>'topic',
   is_approved=false,approved_by=NULL,approved_at=NULL,last_regeneration_job_id=j.id,mentor_edited_at=NULL WHERE id=q.id;
 DELETE FROM public.assessment_options WHERE question_id=q.id;
 FOR opt IN SELECT value FROM jsonb_array_elements(p_candidate->'options') LOOP
   INSERT INTO public.assessment_options(question_id,option_order,option_text,is_correct) VALUES(q.id,(SELECT count(*)+1 FROM public.assessment_options WHERE question_id=q.id),btrim(opt->>'text'),(opt->>'isCorrect')::boolean);
 END LOOP;
 DELETE FROM public.assessment_question_source_references WHERE question_id=q.id;
 FOR ref IN SELECT value FROM jsonb_array_elements(p_candidate->'sourceReferences') LOOP
   IF jsonb_typeof(ref)<>'object' OR jsonb_typeof(ref->'documentId')<>'string' OR ref->>'rangeKind' NOT IN ('page','slide','paragraph','line')
     OR jsonb_typeof(ref->'locationStart')<>'number' OR jsonb_typeof(ref->'locationEnd')<>'number'
     OR (ref->>'locationStart') !~ '^[0-9]+$' OR (ref->>'locationEnd') !~ '^[0-9]+$'
     OR (ref->>'locationStart')::int<1 OR (ref->>'locationEnd')::int<(ref->>'locationStart')::int
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(j.selected_sources) s WHERE s->>'documentId'=ref->>'documentId' AND s->>'rangeKind'=ref->>'rangeKind'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(s->'ranges') r WHERE (ref->>'locationStart')::int >= (r->>'start')::int AND (ref->>'locationEnd')::int <= (r->>'end')::int))
      OR NOT EXISTS(SELECT 1 FROM public.assessment_source_documents d JOIN public.assessment_source_document_extractions e ON e.source_document_id=d.id
        WHERE d.id=(ref->>'documentId')::uuid AND d.assessment_id=j.assessment_id AND d.module_id=j.module_id AND d.uploaded_by=a.mentor_id AND d.extraction_status='ready'
          AND e.extraction_range_kind=ref->>'rangeKind' AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.extraction_units) u WHERE (u->>'number')::int=(ref->>'locationStart')::int)
          AND (SELECT count(*) FROM jsonb_array_elements(e.extraction_units) u WHERE (u->>'number')::int BETWEEN (ref->>'locationStart')::int AND (ref->>'locationEnd')::int)=(ref->>'locationEnd')::int-(ref->>'locationStart')::int+1))
      THEN RAISE EXCEPTION 'Regenerated source reference is outside the original selected, available source scope.'; END IF;
   INSERT INTO public.assessment_question_source_references(assessment_id,question_id,source_document_id,location_kind,location_start,location_end)
    VALUES(j.assessment_id,q.id,(ref->>'documentId')::uuid,ref->>'rangeKind',(ref->>'locationStart')::int,(ref->>'locationEnd')::int);
 END LOOP;
 INSERT INTO public.assessment_question_revisions(question_id,assessment_id,actor_id,action,revision)
   VALUES(q.id,j.assessment_id,j.actor_id,'regenerated',public.assessment_question_review_snapshot(q.id)||jsonb_build_object('generationJobId',j.generation_job_id));
 UPDATE public.assessment_question_regenerations SET status='completed',candidate=p_candidate,actual_model=p_model,completed_at=now(),updated_at=now() WHERE id=j.id;
 UPDATE public.assessments SET total_marks=(SELECT coalesce(sum(marks),0) FROM public.assessment_questions WHERE assessment_id=j.assessment_id AND removed_at IS NULL) WHERE id=j.assessment_id;
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.assessment_question_review_snapshot(UUID),public.assessment_question_answers_valid(UUID,TEXT),public.assessment_review_actor_allowed(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assessment_question_review_snapshot(UUID),public.assessment_question_answers_valid(UUID,TEXT),public.assessment_review_actor_allowed(UUID,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.approve_assessment_question(UUID,UUID,UUID),public.reject_assessment_question(UUID,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.approve_assessment_question(UUID,UUID,UUID),public.reject_assessment_question(UUID,UUID,UUID,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.save_reviewed_assessment_question(UUID,UUID,UUID,TEXT,TEXT,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB),public.reorder_review_assessment_questions(UUID,UUID,UUID[]),public.delete_manual_assessment_question(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_reviewed_assessment_question(UUID,UUID,UUID,TEXT,TEXT,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB),public.reorder_review_assessment_questions(UUID,UUID,UUID[]),public.delete_manual_assessment_question(UUID,UUID,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.begin_assessment_question_regeneration(UUID,UUID,UUID,UUID),public.fail_assessment_question_regeneration(UUID,UUID,UUID,TEXT),public.complete_assessment_question_regeneration(UUID,UUID,JSONB,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_assessment_question_regeneration(UUID,UUID,UUID,UUID),public.fail_assessment_question_regeneration(UUID,UUID,UUID,TEXT),public.complete_assessment_question_regeneration(UUID,UUID,JSONB,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_assessment_question_publication()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE m public.learning_modules%ROWTYPE;
BEGIN
  IF NEW.status='published' AND OLD.status IS DISTINCT FROM 'published' THEN
    SELECT lm.* INTO m FROM public.learning_modules lm JOIN public.module_assessment_links l ON l.module_id=lm.id WHERE l.assessment_id=NEW.id FOR UPDATE OF lm;
    IF m.id IS NULL OR m.status<>'draft' OR m.created_by<>NEW.mentor_id OR (SELECT count(*) FROM public.module_assessment_links WHERE assessment_id=NEW.id)<>1 THEN
      RAISE EXCEPTION 'Assessment publication requires a linked draft module owned by the assessment mentor.';
    END IF;
  END IF;
  IF NEW.status='published' AND OLD.status IS DISTINCT FROM 'published' AND EXISTS(
    SELECT 1 FROM public.assessment_questions q WHERE q.assessment_id=NEW.id
      AND q.generation_job_id IS NOT NULL AND q.removed_at IS NULL
      AND (NOT q.is_approved OR q.approved_by IS NULL OR q.approved_at IS NULL)
  ) THEN RAISE EXCEPTION 'All active AI-generated questions must be approved before publication.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_assessment_question_publication ON public.assessments;
CREATE TRIGGER trg_guard_assessment_question_publication BEFORE UPDATE OF status ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.guard_assessment_question_publication();

-- Executable post-migration verification result sets.
SELECT count(*) AS generated_pending_approval FROM public.assessment_questions
 WHERE generation_job_id IS NOT NULL AND removed_at IS NULL AND NOT is_approved;
SELECT action,count(*) AS revisions FROM public.assessment_question_revisions GROUP BY action ORDER BY action;
SELECT tgname FROM pg_trigger WHERE tgrelid='public.assessment_options'::regclass AND NOT tgisinternal
 AND tgname IN ('trg_invalidate_ai_approval_option_change','trg_guard_assessment_option_draft');
COMMIT;

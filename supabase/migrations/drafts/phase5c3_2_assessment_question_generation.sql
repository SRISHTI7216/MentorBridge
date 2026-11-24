-- DRAFT ONLY — Phase 5C.3.2 atomic AI question generation persistence.
-- Review and reconcile with Phase 5C.1/5C.3.1 before promotion. Never run from this draft.
-- Assumes the reviewed Phase 5C.1 and 5C.3.1 drafts have been applied.
BEGIN;

-- Fail closed if the known Phase 5C.1 provenance span constraint differs.
DO $$
DECLARE definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
   WHERE conrelid='public.assessment_question_source_references'::regclass
     AND conname='assessment_question_source_references_location_kind_check';
  IF definition IS NULL OR definition NOT ILIKE '%page%' OR definition NOT ILIKE '%slide%'
     OR definition NOT ILIKE '%location_kind%' THEN
    RAISE EXCEPTION 'Expected Phase 5C.1 page/slide location_kind check is missing or incompatible.';
  END IF;
  ALTER TABLE public.assessment_question_source_references
    DROP CONSTRAINT assessment_question_source_references_location_kind_check;
  ALTER TABLE public.assessment_question_source_references
    ADD CONSTRAINT assessment_question_source_references_location_kind_check
    CHECK(location_kind IN ('page','slide','paragraph','line')) NOT VALID;
END $$;

CREATE TABLE public.assessment_question_generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL,
  module_id UUID NOT NULL,
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  idempotency_key UUID NOT NULL,
  request_metadata JSONB NOT NULL CHECK(jsonb_typeof(request_metadata)='object'),
  selected_sources JSONB NOT NULL CHECK(jsonb_typeof(selected_sources)='array'),
  status TEXT NOT NULL CHECK(status IN ('processing','failed','validation_failed','completed')),
  lease_token UUID NOT NULL,
  actual_model TEXT,
  prompt_tokens INTEGER CHECK(prompt_tokens IS NULL OR prompt_tokens>=0),
  completion_tokens INTEGER CHECK(completion_tokens IS NULL OR completion_tokens>=0),
  latency_ms INTEGER CHECK(latency_ms IS NULL OR latency_ms>=0),
  question_count INTEGER CHECK(question_count IS NULL OR question_count>=0),
  validation_outcome TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT assessment_question_generation_idempotency UNIQUE(assessment_id,mentor_id,idempotency_key),
  CONSTRAINT assessment_question_generation_link_fk FOREIGN KEY(module_id,assessment_id)
    REFERENCES public.module_assessment_links(module_id,assessment_id) ON DELETE RESTRICT,
  CONSTRAINT assessment_question_generation_identity_key UNIQUE(id,assessment_id)
);
CREATE INDEX assessment_question_generation_owner_idx ON public.assessment_question_generation_jobs(mentor_id,created_at DESC);
ALTER TABLE public.assessment_questions
  ADD COLUMN generation_job_id UUID,
  ADD COLUMN generation_difficulty TEXT,
  ADD COLUMN generation_cognitive_level TEXT,
  ADD COLUMN generation_topic TEXT;
ALTER TABLE public.assessment_questions ADD CONSTRAINT assessment_questions_generation_job_fk
  FOREIGN KEY(generation_job_id,assessment_id)
  REFERENCES public.assessment_question_generation_jobs(id,assessment_id) ON DELETE RESTRICT;
CREATE INDEX assessment_questions_generation_job_idx ON public.assessment_questions(generation_job_id) WHERE generation_job_id IS NOT NULL;

ALTER TABLE public.assessment_question_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_question_generation_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY assessment_question_generation_service_only ON public.assessment_question_generation_jobs
  FOR ALL TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON public.assessment_question_generation_jobs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.assessment_question_generation_jobs TO service_role;

-- Backend calls these as service_role only. SECURITY INVOKER preserves the
-- caller identity; deployment preflight below verifies BYPASSRLS and privileges.
CREATE OR REPLACE FUNCTION public.begin_assessment_question_generation(
  p_assessment_id UUID,p_module_id UUID,p_mentor_id UUID,p_idempotency_key UUID,
  p_request_metadata JSONB,p_selected_sources JSONB
) RETURNS TABLE(job_id UUID,lease_token UUID,status TEXT,acquired BOOLEAN)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE a public.assessments%ROWTYPE; m public.learning_modules%ROWTYPE; existing public.assessment_question_generation_jobs%ROWTYPE;
        new_lease UUID:=gen_random_uuid(); src JSONB; selected_range JSONB; doc public.assessment_source_documents%ROWTYPE; cache public.assessment_source_document_extractions%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL OR current_user<>'service_role' THEN RAISE EXCEPTION 'Backend service role required.'; END IF;
  -- Lock order is coordinated with persist(): idempotency advisory lock, then
  -- existing job (when present), assessment, module. No assessment row is
  -- locked before looking up/locking the job.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_assessment_id::text||':'||p_mentor_id::text||':'||p_idempotency_key::text,0));
  SELECT * INTO existing FROM public.assessment_question_generation_jobs j
    WHERE j.assessment_id=p_assessment_id AND j.mentor_id=p_mentor_id AND j.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND AND (existing.module_id<>p_module_id OR existing.request_metadata<>p_request_metadata OR existing.selected_sources<>p_selected_sources) THEN
    RAISE EXCEPTION 'Idempotency key was already used with a different request.';
  END IF;
  SELECT * INTO a FROM public.assessments WHERE id=p_assessment_id FOR UPDATE;
  SELECT * INTO m FROM public.learning_modules WHERE id=p_module_id FOR UPDATE;
  IF a.id IS NULL OR m.id IS NULL OR a.mentor_id<>p_mentor_id OR m.created_by<>p_mentor_id
     OR NOT EXISTS(SELECT 1 FROM public.module_assessment_links l WHERE l.assessment_id=p_assessment_id AND l.module_id=p_module_id)
     OR (a.origin_module_id IS NOT NULL AND a.origin_module_id<>p_module_id) THEN
    RAISE EXCEPTION 'Assessment generation is not authorized for this module workflow.';
  END IF;
  -- A completed retry returns the same job even after publication. Non-complete
  -- jobs still require an editable draft and are protected by the row locks.
  IF existing.id IS NOT NULL AND existing.status='completed' THEN
    RETURN QUERY SELECT existing.id,existing.lease_token,existing.status,false; RETURN;
  END IF;
  IF a.status<>'draft' OR m.status<>'draft'
     OR EXISTS(SELECT 1 FROM public.assessment_attempts att WHERE att.assessment_id=p_assessment_id)
     OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_mentor_id AND p.role='mentor' AND p.is_active) THEN
    RAISE EXCEPTION 'Assessment generation is not authorized for this draft workflow.';
  END IF;
  IF jsonb_typeof(p_selected_sources)<>'array' OR jsonb_array_length(p_selected_sources) NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Invalid selected source set.'; END IF;
  FOR src IN SELECT value FROM jsonb_array_elements(p_selected_sources) LOOP
    SELECT * INTO doc FROM public.assessment_source_documents d WHERE d.id=(src->>'documentId')::uuid
      AND d.assessment_id=p_assessment_id AND d.module_id=p_module_id AND d.uploaded_by=p_mentor_id AND d.extraction_status='ready';
    IF NOT FOUND THEN RAISE EXCEPTION 'Selected source is not ready or does not belong to this workflow.'; END IF;
    SELECT * INTO cache FROM public.assessment_source_document_extractions e WHERE e.source_document_id=doc.id;
    IF NOT FOUND OR cache.extraction_range_kind<>src->>'rangeKind' THEN RAISE EXCEPTION 'Selected source extraction metadata is incompatible.'; END IF;
    IF jsonb_typeof(src->'ranges')<>'array' OR jsonb_array_length(src->'ranges') NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Selected source ranges are invalid.'; END IF;
    FOR selected_range IN SELECT value FROM jsonb_array_elements(src->'ranges') LOOP
      IF (selected_range->>'start')::integer<1 OR (selected_range->>'end')::integer<(selected_range->>'start')::integer
        OR (SELECT count(*) FROM jsonb_array_elements(cache.extraction_units) u
          WHERE (u->>'number')::integer BETWEEN (selected_range->>'start')::integer AND (selected_range->>'end')::integer)
          <> (selected_range->>'end')::integer-(selected_range->>'start')::integer+1 THEN
        RAISE EXCEPTION 'Selected source range is outside extracted units.';
      END IF;
    END LOOP;
  END LOOP;
  IF existing.id IS NOT NULL THEN
    IF existing.status='processing' AND existing.updated_at>now()-interval '5 minutes' THEN
      RETURN QUERY SELECT existing.id,existing.lease_token,existing.status,false; RETURN;
    END IF;
    UPDATE public.assessment_question_generation_jobs j SET status='processing',lease_token=new_lease,error_code=NULL,updated_at=now()
      WHERE j.id=existing.id RETURNING j.* INTO existing;
  ELSE
    INSERT INTO public.assessment_question_generation_jobs(assessment_id,module_id,mentor_id,idempotency_key,request_metadata,selected_sources,status,lease_token)
    VALUES(p_assessment_id,p_module_id,p_mentor_id,p_idempotency_key,p_request_metadata,p_selected_sources,'processing',new_lease)
    RETURNING * INTO existing;
  END IF;
  RETURN QUERY SELECT existing.id,existing.lease_token,existing.status,true;
END $$;

CREATE OR REPLACE FUNCTION public.persist_assessment_question_generation(
  p_job_id UUID,p_lease_token UUID,p_assessment_id UUID,p_questions JSONB,p_actual_model TEXT,
  p_prompt_tokens INTEGER,p_completion_tokens INTEGER,p_latency_ms INTEGER
) RETURNS TABLE(status TEXT)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE job public.assessment_question_generation_jobs%ROWTYPE; q JSONB; opt JSONB; ref JSONB; qid UUID; ord INTEGER; assessment_row public.assessments%ROWTYPE;
        qtype TEXT; option_count INTEGER; correct_count INTEGER; max_order INTEGER; generated_count INTEGER:=0;
        mcq_count INTEGER:=0; multiple_select_count INTEGER:=0; true_false_count INTEGER:=0;
        easy_count INTEGER:=0; medium_count INTEGER:=0; hard_count INTEGER:=0; expected_count INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL OR current_user<>'service_role' THEN RAISE EXCEPTION 'Backend service role required.'; END IF;
  SELECT * INTO job FROM public.assessment_question_generation_jobs WHERE id=p_job_id AND assessment_id=p_assessment_id FOR UPDATE;
  IF NOT FOUND OR job.status<>'processing' OR job.lease_token<>p_lease_token THEN RAISE EXCEPTION 'Generation lease is invalid.'; END IF;
  SELECT * INTO assessment_row FROM public.assessments WHERE id=p_assessment_id FOR UPDATE;
  PERFORM 1 FROM public.learning_modules WHERE id=job.module_id FOR UPDATE;
  IF jsonb_typeof(p_questions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_questions) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Invalid generated question payload.'; END IF;
  IF p_actual_model IS NULL OR NOT (p_actual_model IN ('openrouter/free','openai/gpt-oss-120b','openai/gpt-oss-20b') OR p_actual_model ~ '^[^/[:space:]]+/[^[:space:]]+:free$') THEN
    RAISE EXCEPTION 'Generated response model identifier is not an approved assessment model.';
  END IF;
  IF jsonb_typeof(job.request_metadata->'questionCounts') IS DISTINCT FROM 'object'
     OR jsonb_typeof(job.request_metadata->'difficultyDistribution') IS DISTINCT FROM 'object'
     OR jsonb_typeof(job.request_metadata->'cognitiveLevels') IS DISTINCT FROM 'array'
     OR jsonb_typeof(job.request_metadata->'topicCoverage') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Stored generation request metadata is malformed.';
  END IF;
  IF job.request_metadata->'questionCounts' - ARRAY['mcq','multiple_select','true_false'] <> '{}'::jsonb
     OR job.request_metadata->'difficultyDistribution' - ARRAY['easy','medium','hard'] <> '{}'::jsonb
     OR NOT (job.request_metadata->'questionCounts' ?& ARRAY['mcq','multiple_select','true_false'])
     OR NOT (job.request_metadata->'difficultyDistribution' ?& ARRAY['easy','medium','hard'])
     OR EXISTS(SELECT 1 FROM jsonb_each(job.request_metadata->'questionCounts') c WHERE jsonb_typeof(c.value)<>'number' OR c.value::text !~ '^[0-9]+$')
     OR EXISTS(SELECT 1 FROM jsonb_each(job.request_metadata->'difficultyDistribution') c WHERE jsonb_typeof(c.value)<>'number' OR c.value::text !~ '^[0-9]+$') THEN
    RAISE EXCEPTION 'Stored generation count metadata is malformed.';
  END IF;
  expected_count:=coalesce((job.request_metadata->'questionCounts'->>'mcq')::integer,-1)
    +coalesce((job.request_metadata->'questionCounts'->>'multiple_select')::integer,-1)
    +coalesce((job.request_metadata->'questionCounts'->>'true_false')::integer,-1);
  IF expected_count NOT BETWEEN 1 AND 20 OR jsonb_array_length(p_questions)<>expected_count THEN
    RAISE EXCEPTION 'Persisted question count differs from the generation request.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.assessments a JOIN public.learning_modules m ON m.created_by=a.mentor_id
      JOIN public.module_assessment_links l ON l.assessment_id=a.id AND l.module_id=m.id
      WHERE a.id=p_assessment_id AND a.mentor_id=job.mentor_id AND a.status='draft' AND m.id=job.module_id AND m.status='draft') THEN
    RAISE EXCEPTION 'Draft assessment workflow is no longer editable.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.assessment_attempts att WHERE att.assessment_id=p_assessment_id) THEN
    RAISE EXCEPTION 'Assessment with existing attempts cannot receive generated questions.';
  END IF;
  SELECT coalesce(max(question_order),0) INTO max_order FROM public.assessment_questions WHERE assessment_id=p_assessment_id;
  ord:=max_order;
  FOR q IN SELECT value FROM jsonb_array_elements(p_questions) LOOP
    IF jsonb_typeof(q) IS DISTINCT FROM 'object' OR
       q - ARRAY['questionType','questionText','options','explanation','marks','difficulty','cognitiveLevel','topic','sourceReferences'] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Generated question has unexpected fields.';
    END IF;
    qtype:=q->>'questionType';
    IF jsonb_typeof(q->'options') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Generated options must be an array.'; END IF;
    option_count:=jsonb_array_length(q->'options');
    SELECT count(*) INTO correct_count FROM jsonb_array_elements(q->'options') x WHERE (x->>'isCorrect')::boolean;
    IF qtype IS NULL OR qtype NOT IN ('mcq','multiple_select','true_false')
       OR jsonb_typeof(q->'questionText') IS DISTINCT FROM 'string' OR char_length(btrim(q->>'questionText')) NOT BETWEEN 10 AND 600 OR char_length(q->>'questionText')>600
       OR jsonb_typeof(q->'explanation') IS DISTINCT FROM 'string' OR char_length(btrim(q->>'explanation')) NOT BETWEEN 10 AND 1200 OR char_length(q->>'explanation')>1200
       OR jsonb_typeof(q->'marks') IS DISTINCT FROM 'number' OR (q->>'marks')::numeric<=0 OR (q->>'marks')::numeric>100
       OR (q->>'marks')::numeric<>round((q->>'marks')::numeric,2)
       OR q->>'difficulty' IS NULL OR q->>'difficulty' NOT IN ('easy','medium','hard')
       OR q->>'cognitiveLevel' IS NULL OR q->>'cognitiveLevel' NOT IN ('remember','understand','apply','analyze','evaluate','create')
       OR NOT ((job.request_metadata->'cognitiveLevels') ? (q->>'cognitiveLevel'))
       OR jsonb_typeof(q->'topic') IS DISTINCT FROM 'string' OR char_length(btrim(q->>'topic')) NOT BETWEEN 1 AND 120 OR char_length(q->>'topic')>120
       OR (jsonb_array_length(job.request_metadata->'topicCoverage')>0 AND NOT EXISTS(
          SELECT 1 FROM jsonb_array_elements_text(job.request_metadata->'topicCoverage') t(value)
          WHERE lower(btrim(t.value))=lower(btrim(q->>'topic'))))
       OR (SELECT count(*) FROM jsonb_array_elements(p_questions) z(value)
          WHERE lower(regexp_replace(z.value->>'questionText','[^A-Za-z0-9_]+',' ','g'))=
                lower(regexp_replace(q->>'questionText','[^A-Za-z0-9_]+',' ','g')))<>1
       OR jsonb_typeof(q->'sourceReferences') IS DISTINCT FROM 'array'
       OR jsonb_array_length(q->'sourceReferences') NOT BETWEEN 1 AND 4 THEN
      RAISE EXCEPTION 'Generated question fields or metadata failed database validation.';
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(q->'options') x
      WHERE jsonb_typeof(x) IS DISTINCT FROM 'object'
        OR x - ARRAY['text','isCorrect'] <> '{}'::jsonb
        OR jsonb_typeof(x->'text') IS DISTINCT FROM 'string'
        OR char_length(btrim(x->>'text')) NOT BETWEEN 1 AND 400 OR char_length(x->>'text')>400
        OR jsonb_typeof(x->'isCorrect') IS DISTINCT FROM 'boolean')
       OR (SELECT count(*) FROM jsonb_array_elements(q->'options') x
          WHERE lower(btrim(x->>'text')) IN (SELECT lower(btrim(y->>'text')) FROM jsonb_array_elements(q->'options') y GROUP BY lower(btrim(y->>'text')) HAVING count(*)>1))>0 THEN
      RAISE EXCEPTION 'Generated option text or correctness fields are invalid or duplicated.';
    END IF;
    IF qtype NOT IN ('mcq','multiple_select','true_false') OR jsonb_typeof(q->'options')<>'array'
       OR option_count NOT BETWEEN 2 AND 6 OR correct_count<1 OR (qtype IN ('mcq','true_false') AND correct_count<>1)
       OR (qtype='true_false' AND (option_count<>2 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(q->'options') x WHERE lower(btrim(x->>'text'))='true')
         OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(q->'options') x WHERE lower(btrim(x->>'text'))='false'))) THEN
      RAISE EXCEPTION 'Generated question answer cardinality is invalid.';
    END IF;
    IF qtype='mcq' THEN mcq_count:=mcq_count+1; ELSIF qtype='multiple_select' THEN multiple_select_count:=multiple_select_count+1; ELSE true_false_count:=true_false_count+1; END IF;
    IF q->>'difficulty'='easy' THEN easy_count:=easy_count+1; ELSIF q->>'difficulty'='medium' THEN medium_count:=medium_count+1; ELSE hard_count:=hard_count+1; END IF;
    generated_count:=generated_count+1;
    ord:=ord+1; qid:=gen_random_uuid();
    INSERT INTO public.assessment_questions(id,assessment_id,question_order,question_type,question_text,marks,explanation,generation_job_id,generation_difficulty,generation_cognitive_level,generation_topic)
      VALUES(qid,p_assessment_id,ord,qtype,btrim(q->>'questionText'),(q->>'marks')::numeric,btrim(q->>'explanation'),p_job_id,q->>'difficulty',q->>'cognitiveLevel',btrim(q->>'topic'));
    FOR opt IN SELECT value FROM jsonb_array_elements(q->'options') LOOP
      INSERT INTO public.assessment_options(question_id,option_order,option_text,is_correct)
        VALUES(qid,(SELECT count(*)+1 FROM public.assessment_options WHERE question_id=qid),btrim(opt->>'text'),(opt->>'isCorrect')::boolean);
    END LOOP;
    FOR ref IN SELECT value FROM jsonb_array_elements(q->'sourceReferences') LOOP
      IF jsonb_typeof(ref) IS DISTINCT FROM 'object' OR
         ref - ARRAY['documentId','rangeKind','locationStart','locationEnd'] <> '{}'::jsonb
         OR jsonb_typeof(ref->'documentId') IS DISTINCT FROM 'string'
         OR ref->>'rangeKind' IS NULL OR ref->>'rangeKind' NOT IN ('page','slide','paragraph','line')
         OR jsonb_typeof(ref->'locationStart') IS DISTINCT FROM 'number'
         OR jsonb_typeof(ref->'locationEnd') IS DISTINCT FROM 'number'
         OR (ref->>'locationStart') !~ '^[0-9]+$' OR (ref->>'locationEnd') !~ '^[0-9]+$'
         OR (ref->>'locationStart')::integer<1 OR (ref->>'locationEnd')::integer<(ref->>'locationStart')::integer
         OR (ref->>'locationEnd')::integer-(ref->>'locationStart')::integer>19 THEN
        RAISE EXCEPTION 'Generated source reference fields or bounds are invalid.';
      END IF;
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(job.selected_sources) s
        WHERE s->>'documentId'=ref->>'documentId' AND s->>'rangeKind'=ref->>'rangeKind'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(s->'ranges') r
            WHERE (ref->>'locationStart')::integer >= (r->>'start')::integer AND (ref->>'locationEnd')::integer <= (r->>'end')::integer)) THEN
        RAISE EXCEPTION 'Generated question cited an unselected source range.';
      END IF;
      IF NOT EXISTS(SELECT 1 FROM public.assessment_source_documents d
        JOIN public.assessment_source_document_extractions e ON e.source_document_id=d.id
        WHERE d.id=(ref->>'documentId')::uuid AND d.assessment_id=p_assessment_id AND d.module_id=job.module_id
          AND d.uploaded_by=job.mentor_id AND d.extraction_status='ready' AND e.extraction_range_kind=ref->>'rangeKind'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.extraction_units) u WHERE (u->>'number')::integer=(ref->>'locationStart')::integer)
          AND (SELECT count(*) FROM jsonb_array_elements(e.extraction_units) u
            WHERE (u->>'number')::integer BETWEEN (ref->>'locationStart')::integer AND (ref->>'locationEnd')::integer)
            =(ref->>'locationEnd')::integer-(ref->>'locationStart')::integer+1) THEN
        RAISE EXCEPTION 'Generated source is no longer available in this workflow.';
      END IF;
      INSERT INTO public.assessment_question_source_references(assessment_id,question_id,source_document_id,location_kind,location_start,location_end)
        VALUES(p_assessment_id,qid,(ref->>'documentId')::uuid,ref->>'rangeKind',(ref->>'locationStart')::integer,(ref->>'locationEnd')::integer);
    END LOOP;
  END LOOP;
  IF generated_count<>expected_count
     OR mcq_count<>(job.request_metadata->'questionCounts'->>'mcq')::integer
     OR multiple_select_count<>(job.request_metadata->'questionCounts'->>'multiple_select')::integer
     OR true_false_count<>(job.request_metadata->'questionCounts'->>'true_false')::integer
     OR easy_count<>(job.request_metadata->'difficultyDistribution'->>'easy')::integer
     OR medium_count<>(job.request_metadata->'difficultyDistribution'->>'medium')::integer
     OR hard_count<>(job.request_metadata->'difficultyDistribution'->>'hard')::integer THEN
    RAISE EXCEPTION 'Generated type or difficulty counts differ from the stored request.';
  END IF;
  UPDATE public.assessments SET total_marks=(SELECT coalesce(sum(marks),0) FROM public.assessment_questions WHERE assessment_id=p_assessment_id) WHERE id=p_assessment_id;
  UPDATE public.assessment_question_generation_jobs SET status='completed',actual_model=p_actual_model,prompt_tokens=p_prompt_tokens,
    completion_tokens=p_completion_tokens,latency_ms=p_latency_ms,question_count=jsonb_array_length(p_questions),
    validation_outcome='backend_validated',completed_at=now(),updated_at=now() WHERE id=p_job_id;
  RETURN QUERY SELECT 'completed'::text;
END $$;

CREATE OR REPLACE FUNCTION public.fail_assessment_question_generation(p_job_id UUID,p_lease_token UUID,p_error_code TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,auth,pg_temp AS $$
BEGIN
  IF auth.uid() IS NOT NULL OR current_user<>'service_role' THEN RAISE EXCEPTION 'Backend service role required.'; END IF;
  UPDATE public.assessment_question_generation_jobs SET status=CASE WHEN p_error_code='output_validation_failed' THEN 'validation_failed' ELSE 'failed' END,
    error_code=left(p_error_code,80),updated_at=now() WHERE id=p_job_id AND lease_token=p_lease_token AND status='processing';
END $$;

REVOKE ALL ON FUNCTION public.begin_assessment_question_generation(UUID,UUID,UUID,UUID,JSONB,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.persist_assessment_question_generation(UUID,UUID,UUID,JSONB,TEXT,INTEGER,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fail_assessment_question_generation(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_assessment_question_generation(UUID,UUID,UUID,UUID,JSONB,JSONB),
  public.persist_assessment_question_generation(UUID,UUID,UUID,JSONB,TEXT,INTEGER,INTEGER,INTEGER),
  public.fail_assessment_question_generation(UUID,UUID,TEXT) TO service_role;

-- Deployment preflight, executed manually before promotion, not by this draft.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'service_role must exist and BYPASSRLS for backend RPCs and forced-RLS extraction cache.';
  END IF;
  IF NOT has_table_privilege('service_role','public.assessment_source_document_extractions','SELECT') OR
     NOT has_table_privilege('service_role','public.assessment_source_documents','SELECT') OR
     NOT has_table_privilege('service_role','public.assessments','SELECT,UPDATE') OR
     NOT has_table_privilege('service_role','public.learning_modules','SELECT') OR
     NOT has_table_privilege('service_role','public.module_assessment_links','SELECT') OR
     NOT has_table_privilege('service_role','public.assessment_attempts','SELECT') OR
     NOT has_table_privilege('service_role','public.profiles','SELECT') OR
     NOT has_table_privilege('service_role','public.assessment_questions','SELECT,INSERT') OR
     NOT has_table_privilege('service_role','public.assessment_options','SELECT,INSERT') OR
     NOT has_table_privilege('service_role','public.assessment_question_source_references','INSERT') OR
     NOT has_table_privilege('service_role','public.assessment_question_generation_jobs','SELECT,INSERT,UPDATE') THEN
    RAISE EXCEPTION 'service_role lacks required assessment generation table privileges.';
  END IF;
  IF NOT has_function_privilege('service_role','public.begin_assessment_question_generation(uuid,uuid,uuid,uuid,jsonb,jsonb)','EXECUTE') OR
     NOT has_function_privilege('service_role','public.persist_assessment_question_generation(uuid,uuid,uuid,jsonb,text,integer,integer,integer)','EXECUTE') OR
     NOT has_function_privilege('service_role','public.fail_assessment_question_generation(uuid,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'service_role lacks assessment generation RPC execution privileges.';
  END IF;
END $$;

COMMIT;

-- Draft forward correction for databases that already applied the Phase 5C.3.2 and 5C.3.3 RPCs.
-- Review and apply through the normal migration process; this file has not been executed.
-- Allows audited Groq assessment models while retaining legacy OpenRouter free-model records.

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

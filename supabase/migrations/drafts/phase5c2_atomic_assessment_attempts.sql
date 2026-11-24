-- DRAFT ONLY: Phase 5C.2 transaction boundaries required by the backend.
-- Review alongside the applied Phase 5C.1 schema. Do not execute as part of code review.
-- These SECURITY DEFINER functions are intentionally callable only by service_role;
-- callers must authenticate the user in the backend and pass that verified UUID.
-- No live SQL has been executed.

BEGIN;

-- The legacy answer column remains authoritative for single choice. This additive
-- array stores the complete selection for multiple_select without rewriting history.
ALTER TABLE public.assessment_answers
  ADD COLUMN IF NOT EXISTS selected_option_ids UUID[] NOT NULL DEFAULT '{}';
UPDATE public.assessment_answers SET selected_option_ids=ARRAY[selected_option_id]
  WHERE selected_option_id IS NOT NULL AND cardinality(selected_option_ids)=0;

CREATE OR REPLACE FUNCTION public.assessment_student_is_eligible(p_assessment_id UUID, p_student_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.assessments a
    JOIN public.profiles p ON p.id=p_student_id AND p.role='student' AND p.is_active
    WHERE a.id=p_assessment_id
      AND ((a.status='published' AND a.start_time<=now()
          AND (a.end_time>=now() OR EXISTS (SELECT 1 FROM public.assessment_attempts at
            WHERE at.assessment_id=a.id AND at.student_id=p_student_id AND at.status='in_progress'))
          AND (EXISTS (SELECT 1 FROM public.assessment_attempts at WHERE at.assessment_id=a.id
                AND at.student_id=p_student_id AND at.status='in_progress')
            OR (SELECT count(*) FROM public.assessment_attempts at WHERE at.assessment_id=a.id
                AND at.student_id=p_student_id)<a.allowed_attempts))
        OR (a.status='completed' AND a.is_results_published AND a.start_time<=now()
          AND EXISTS (SELECT 1 FROM public.assessment_attempts at WHERE at.assessment_id=a.id
            AND at.student_id=p_student_id AND at.status IN ('submitted','evaluated'))))
      AND (
        EXISTS (SELECT 1 FROM public.module_assessment_links l
          JOIN public.learning_modules m ON m.id=l.module_id AND m.status='published'
          JOIN public.student_module_enrollments e ON e.module_id=m.id AND e.student_id=p_student_id
          WHERE l.assessment_id=a.id AND e.enrollment_type='institutional_common'
            AND e.assignment_id IS NULL AND e.status IN ('in_progress','completed'))
        OR EXISTS (SELECT 1 FROM public.module_assessment_links l
          JOIN public.learning_modules m ON m.id=l.module_id AND m.status='published'
          JOIN public.student_module_enrollments e ON e.module_id=m.id AND e.student_id=p_student_id
          JOIN public.module_assignments ma ON ma.id=e.assignment_id AND ma.module_id=e.module_id
            AND ma.student_id=e.student_id
          WHERE l.assessment_id=a.id AND e.enrollment_type='assigned'
            AND ((e.status='in_progress' AND ma.status='assigned')
              OR (e.status='completed' AND ma.status IN ('assigned','completed'))))
        OR (
          EXISTS (SELECT 1 FROM public.assessment_assignments aa WHERE aa.assessment_id=a.id
            AND aa.student_id=p_student_id AND (aa.cohort_id IS NULL OR EXISTS (
              SELECT 1 FROM public.student_details sd WHERE sd.profile_id=p_student_id AND sd.cohort_id=aa.cohort_id))))
        OR EXISTS (
          SELECT 1 FROM public.mentor_assignments ma
          WHERE ma.mentor_id=a.mentor_id AND ma.student_id=p_student_id AND ma.is_active=true)
      )
  )
$$;

-- Service-role-only alternative to calling the auth.uid()-based Phase 5C.1
-- helper through a service client. It returns safe question and option fields
-- in one statement so revocation cannot race between eligibility and content reads.
CREATE OR REPLACE FUNCTION public.student_assessment_content_for_backend(p_assessment_id UUID,p_student_id UUID)
RETURNS TABLE(question_id UUID,question_order INTEGER,question_type TEXT,question_text TEXT,marks NUMERIC,
  option_id UUID,option_order INTEGER,option_text TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,auth,pg_temp AS $$
  SELECT q.id,q.question_order,q.question_type,q.question_text,q.marks,o.id,o.option_order,o.option_text
  FROM public.assessment_questions q LEFT JOIN public.assessment_options o ON o.question_id=q.id
  WHERE q.assessment_id=p_assessment_id
    AND public.assessment_student_is_eligible(p_assessment_id,p_student_id)
  ORDER BY q.question_order,o.option_order NULLS FIRST
$$;

CREATE OR REPLACE FUNCTION public.start_assessment_attempt(p_assessment_id UUID,p_student_id UUID)
RETURNS public.assessment_attempts LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE v_assessment public.assessments%ROWTYPE; v_attempt public.assessment_attempts%ROWTYPE; v_next INTEGER;
BEGIN
  -- Serialize concurrent start requests for a student/assessment pair.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_assessment_id::text||':'||p_student_id::text,0));
  SELECT * INTO v_assessment FROM public.assessments WHERE id=p_assessment_id FOR UPDATE;
  IF NOT FOUND OR v_assessment.status<>'published' OR NOT public.assessment_student_is_eligible(p_assessment_id,p_student_id) THEN
    RAISE EXCEPTION 'Assessment is not available to this student.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_attempt FROM public.assessment_attempts WHERE assessment_id=p_assessment_id
    AND student_id=p_student_id AND status='in_progress' ORDER BY attempt_number DESC LIMIT 1;
  IF FOUND THEN RETURN v_attempt; END IF;
  IF now()<v_assessment.start_time OR now()>v_assessment.end_time THEN
    RAISE EXCEPTION 'Assessment is outside its availability window.' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(max(attempt_number),0)+1 INTO v_next FROM public.assessment_attempts
    WHERE assessment_id=p_assessment_id AND student_id=p_student_id;
  IF v_next>v_assessment.allowed_attempts THEN RAISE EXCEPTION 'Attempt limit reached.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.assessment_attempts(assessment_id,student_id,attempt_number,status,started_at)
    VALUES(p_assessment_id,p_student_id,v_next,'in_progress',now()) RETURNING * INTO v_attempt;
  RETURN v_attempt;
END $$;

CREATE OR REPLACE FUNCTION public.save_assessment_attempt_answer(
  p_attempt_id UUID,p_question_id UUID,p_selected_option_ids UUID[],p_descriptive_answer TEXT
) RETURNS public.assessment_answers LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE v_attempt public.assessment_attempts%ROWTYPE; v_assessment public.assessments%ROWTYPE;
  v_question public.assessment_questions%ROWTYPE; v_answer public.assessment_answers%ROWTYPE;
  v_ids UUID[]:=coalesce(p_selected_option_ids,'{}'); v_single UUID;
BEGIN
  SELECT * INTO v_attempt FROM public.assessment_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.status<>'in_progress' OR NOT public.assessment_student_is_eligible(v_attempt.assessment_id,v_attempt.student_id) THEN
    RAISE EXCEPTION 'Attempt is not writable.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_assessment FROM public.assessments WHERE id=v_attempt.assessment_id;
  IF now()>v_attempt.started_at+(v_assessment.duration_minutes*interval '1 minute')+interval '30 seconds'
    OR now()>v_assessment.end_time THEN RAISE EXCEPTION 'Attempt has expired.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_question FROM public.assessment_questions WHERE id=p_question_id AND assessment_id=v_attempt.assessment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question does not belong to this assessment.' USING ERRCODE='23503'; END IF;
  IF cardinality(v_ids)<>(SELECT count(DISTINCT x) FROM unnest(v_ids) x)
    OR EXISTS(SELECT 1 FROM unnest(v_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.assessment_options o WHERE o.id=x AND o.question_id=p_question_id)) THEN
    RAISE EXCEPTION 'Selected options are invalid.' USING ERRCODE='23503';
  END IF;
  IF v_question.question_type='descriptive' AND cardinality(v_ids)>0 THEN RAISE EXCEPTION 'Descriptive answers cannot select options.'; END IF;
  IF v_question.question_type<>'descriptive' AND p_descriptive_answer IS NOT NULL THEN RAISE EXCEPTION 'Objective answers cannot include descriptive text.'; END IF;
  IF v_question.question_type IN ('mcq','true_false') AND cardinality(v_ids)>1 THEN RAISE EXCEPTION 'This question accepts one option.'; END IF;
  IF cardinality(v_ids)=1 THEN v_single:=v_ids[1]; ELSE v_single:=NULL; END IF;
  INSERT INTO public.assessment_answers(attempt_id,question_id,selected_option_id,selected_option_ids,descriptive_answer,is_correct,marks_obtained)
    VALUES(p_attempt_id,p_question_id,v_single,v_ids,p_descriptive_answer,NULL,0)
  ON CONFLICT(attempt_id,question_id) DO UPDATE SET selected_option_id=EXCLUDED.selected_option_id,
    selected_option_ids=EXCLUDED.selected_option_ids,descriptive_answer=EXCLUDED.descriptive_answer,
    is_correct=NULL,marks_obtained=0,updated_at=now()
  RETURNING * INTO v_answer;
  RETURN v_answer;
END $$;

CREATE OR REPLACE FUNCTION public.submit_assessment_attempt(p_attempt_id UUID)
RETURNS public.assessment_attempts LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE v_attempt public.assessment_attempts%ROWTYPE; v_assessment public.assessments%ROWTYPE;
  v_mcq NUMERIC(6,2); v_has_descriptive BOOLEAN; v_now TIMESTAMPTZ:=now();
BEGIN
  SELECT * INTO v_attempt FROM public.assessment_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_attempt.status IN ('submitted','evaluated') THEN RETURN v_attempt; END IF;
  IF v_attempt.status<>'in_progress' THEN RAISE EXCEPTION 'Attempt cannot be submitted.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_assessment FROM public.assessments WHERE id=v_attempt.assessment_id;
  IF v_now>v_assessment.end_time OR v_now>v_attempt.started_at+(v_assessment.duration_minutes*interval '1 minute')+interval '30 seconds' THEN
    -- Submission is still allowed after expiry; no further answer writes are allowed.
    NULL;
  END IF;
  UPDATE public.assessment_answers ans SET
    is_correct=CASE WHEN q.question_type='descriptive' THEN NULL ELSE
      ((SELECT array_agg(o.id ORDER BY o.id) FROM public.assessment_options o WHERE o.question_id=q.id AND o.is_correct)
        IS NOT DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(coalesce(ans.selected_option_ids,'{}')) x)) END,
    marks_obtained=CASE WHEN q.question_type<>'descriptive' AND
      (SELECT array_agg(o.id ORDER BY o.id) FROM public.assessment_options o WHERE o.question_id=q.id AND o.is_correct)
        IS NOT DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(coalesce(ans.selected_option_ids,'{}')) x)
      THEN q.marks ELSE 0 END,
    updated_at=v_now
  FROM public.assessment_questions q WHERE ans.attempt_id=p_attempt_id AND ans.question_id=q.id;
  SELECT coalesce(sum(ans.marks_obtained),0) INTO v_mcq FROM public.assessment_answers ans
    JOIN public.assessment_questions q ON q.id=ans.question_id WHERE ans.attempt_id=p_attempt_id AND q.question_type<>'descriptive';
  SELECT EXISTS(SELECT 1 FROM public.assessment_questions q WHERE q.assessment_id=v_attempt.assessment_id AND q.question_type='descriptive') INTO v_has_descriptive;
  UPDATE public.assessment_attempts SET submitted_at=v_now,mcq_score=v_mcq,total_score=v_mcq,
    is_evaluated=NOT v_has_descriptive,status=CASE WHEN v_has_descriptive THEN 'submitted' ELSE 'evaluated' END,
    evaluated_at=CASE WHEN v_has_descriptive THEN NULL ELSE v_now END,updated_at=v_now
    WHERE id=p_attempt_id RETURNING * INTO v_attempt;
  RETURN v_attempt;
END $$;

CREATE OR REPLACE FUNCTION public.evaluate_assessment_attempt(
  p_attempt_id UUID,p_evaluator_id UUID,p_is_admin BOOLEAN,p_evaluations JSONB,p_general_feedback TEXT
) RETURNS public.assessment_attempts LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE v_attempt public.assessment_attempts%ROWTYPE; v_assessment public.assessments%ROWTYPE;
  v_item JSONB; v_question_id UUID; v_marks NUMERIC; v_max NUMERIC;
  v_descriptive NUMERIC(6,2); v_now TIMESTAMPTZ:=now();
BEGIN
  SELECT * INTO v_attempt FROM public.assessment_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_assessment FROM public.assessments WHERE id=v_attempt.assessment_id;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_evaluator_id AND p.is_active
      AND ((p_is_admin AND p.role='admin') OR (NOT p_is_admin AND p.role='mentor' AND v_assessment.mentor_id=p.id))) THEN
    RAISE EXCEPTION 'Evaluator is not authorized for this assessment.' USING ERRCODE='42501';
  END IF;
  IF v_assessment.is_results_published THEN RAISE EXCEPTION 'Published results are immutable.' USING ERRCODE='22023'; END IF;
  IF v_attempt.status NOT IN ('submitted','evaluated') THEN RAISE EXCEPTION 'Only submitted attempts can be evaluated.' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_evaluations) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Evaluations must be a JSON array.' USING ERRCODE='22023'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_evaluations) LOOP
    v_question_id:=(v_item->>'questionId')::UUID;
    v_marks:=(v_item->>'marksObtained')::NUMERIC;
    SELECT marks INTO v_max FROM public.assessment_questions
      WHERE id=v_question_id AND assessment_id=v_attempt.assessment_id AND question_type='descriptive';
    IF NOT FOUND OR v_marks IS NULL OR v_marks<0 OR v_marks>v_max THEN RAISE EXCEPTION 'Evaluation question or marks are invalid.' USING ERRCODE='22023'; END IF;
    UPDATE public.assessment_answers SET marks_obtained=v_marks,mentor_feedback=nullif(v_item->>'mentorFeedback',''),
      evaluated_at=v_now,updated_at=v_now WHERE attempt_id=p_attempt_id AND question_id=v_question_id;
  END LOOP;
  SELECT coalesce(sum(ans.marks_obtained),0) INTO v_descriptive FROM public.assessment_answers ans
    JOIN public.assessment_questions q ON q.id=ans.question_id
    WHERE ans.attempt_id=p_attempt_id AND q.question_type='descriptive';
  UPDATE public.assessment_attempts SET descriptive_score=v_descriptive,
    total_score=coalesce(mcq_score,0)+v_descriptive,is_evaluated=true,status='evaluated',
    evaluated_by=p_evaluator_id,evaluated_at=v_now,general_feedback=p_general_feedback,updated_at=v_now
    WHERE id=p_attempt_id RETURNING * INTO v_attempt;
  RETURN v_attempt;
END $$;

-- Validate every SECURITY DEFINER function independently. Function ownership
-- is not inherited from another helper: each proowner needs its own grants and
-- must bypass RLS or own each RLS-enabled table without FORCE ROW LEVEL SECURITY.
DO $$
DECLARE
  v_fn REGPROCEDURE;
  v_owner OID;
  v_is_security_definer BOOLEAN;
  v_owner_name NAME;
  v_bypass BOOLEAN;
  v_rel REGCLASS;
  v_privilege TEXT;
  v_owner_oid OID;
  v_force BOOLEAN;
  v_rls BOOLEAN;
BEGIN
  FOR v_fn IN
    SELECT fn FROM (VALUES
      ('public.assessment_student_is_eligible(uuid,uuid)'::regprocedure),
      ('public.student_assessment_content_for_backend(uuid,uuid)'::regprocedure),
      ('public.start_assessment_attempt(uuid,uuid)'::regprocedure),
      ('public.save_assessment_attempt_answer(uuid,uuid,uuid[],text)'::regprocedure),
      ('public.submit_assessment_attempt(uuid)'::regprocedure),
      ('public.evaluate_assessment_attempt(uuid,uuid,boolean,jsonb,text)'::regprocedure)
    ) AS functions(fn)
  LOOP
    SELECT p.proowner,p.prosecdef INTO v_owner,v_is_security_definer FROM pg_proc p WHERE p.oid=v_fn::oid;
    IF NOT FOUND OR v_owner IS NULL THEN
      RAISE EXCEPTION 'Phase 5C.2 preflight cannot resolve owner for SECURITY DEFINER function %.',v_fn;
    END IF;
    IF NOT coalesce(v_is_security_definer,false) THEN
      RAISE EXCEPTION 'Phase 5C.2 function % is not SECURITY DEFINER.',v_fn;
    END IF;
    SELECT r.rolname,r.rolbypassrls INTO v_owner_name,v_bypass
      FROM pg_roles r WHERE r.oid=v_owner;
    IF NOT FOUND OR v_owner_name IS NULL THEN
      RAISE EXCEPTION 'Phase 5C.2 preflight owner role is missing for SECURITY DEFINER function % (owner OID %).',v_fn,v_owner;
    END IF;

    FOR v_rel,v_privilege IN
      SELECT required.table_name,required.privilege
      FROM (VALUES
        -- Eligibility helper: reads all assignment, profile, module and attempt facts.
        ('public.assessment_student_is_eligible(uuid,uuid)'::regprocedure,'public.assessments'::regclass,'SELECT'::text),
        ('public.assessment_student_is_eligible(uuid,uuid)'::regprocedure,'public.profiles'::regclass,'SELECT'::text),
        ('public.assessment_student_is_eligible(uuid,uuid)'::regprocedure,'public.assessment_attempts'::regclass,'SELECT'::text),
        ('public.assessment_student_is_eligible(uuid,uuid)'::regprocedure,'public.module_assessment_links'::regclass,'SELECT'::text),
        ('public.assessment_student_is_eligible(uuid,uuid)'::regprocedure,'public.learning_modules'::regclass,'SELECT'::text),
        ('public.assessment_student_is_eligible(uuid,uuid)'::regprocedure,'public.student_module_enrollments'::regclass,'SELECT'::text),
        ('public.assessment_student_is_eligible(uuid,uuid)'::regprocedure,'public.module_assignments'::regclass,'SELECT'::text),
        ('public.assessment_student_is_eligible(uuid,uuid)'::regprocedure,'public.assessment_assignments'::regclass,'SELECT'::text),
        ('public.assessment_student_is_eligible(uuid,uuid)'::regprocedure,'public.student_details'::regclass,'SELECT'::text),

        -- Safe content function and the eligibility function it calls.
        ('public.student_assessment_content_for_backend(uuid,uuid)'::regprocedure,'public.assessment_questions'::regclass,'SELECT'::text),
        ('public.student_assessment_content_for_backend(uuid,uuid)'::regprocedure,'public.assessment_options'::regclass,'SELECT'::text),

        -- Start: SELECT FOR UPDATE also requires UPDATE privilege on each locked table.
        ('public.start_assessment_attempt(uuid,uuid)'::regprocedure,'public.assessments'::regclass,'SELECT'::text),
        ('public.start_assessment_attempt(uuid,uuid)'::regprocedure,'public.assessments'::regclass,'UPDATE'::text),
        ('public.start_assessment_attempt(uuid,uuid)'::regprocedure,'public.assessment_attempts'::regclass,'SELECT'::text),
        ('public.start_assessment_attempt(uuid,uuid)'::regprocedure,'public.assessment_attempts'::regclass,'UPDATE'::text),
        ('public.start_assessment_attempt(uuid,uuid)'::regprocedure,'public.assessment_attempts'::regclass,'INSERT'::text),

        -- Save: locks attempt, reads assessment/question/options, and upserts answer.
        ('public.save_assessment_attempt_answer(uuid,uuid,uuid[],text)'::regprocedure,'public.assessment_attempts'::regclass,'SELECT'::text),
        ('public.save_assessment_attempt_answer(uuid,uuid,uuid[],text)'::regprocedure,'public.assessment_attempts'::regclass,'UPDATE'::text),
        ('public.save_assessment_attempt_answer(uuid,uuid,uuid[],text)'::regprocedure,'public.assessments'::regclass,'SELECT'::text),
        ('public.save_assessment_attempt_answer(uuid,uuid,uuid[],text)'::regprocedure,'public.assessment_questions'::regclass,'SELECT'::text),
        ('public.save_assessment_attempt_answer(uuid,uuid,uuid[],text)'::regprocedure,'public.assessment_options'::regclass,'SELECT'::text),
        ('public.save_assessment_attempt_answer(uuid,uuid,uuid[],text)'::regprocedure,'public.assessment_answers'::regclass,'SELECT'::text),
        ('public.save_assessment_attempt_answer(uuid,uuid,uuid[],text)'::regprocedure,'public.assessment_answers'::regclass,'INSERT'::text),
        ('public.save_assessment_attempt_answer(uuid,uuid,uuid[],text)'::regprocedure,'public.assessment_answers'::regclass,'UPDATE'::text),

        -- Submit: locks and updates attempt, grades answers against question options.
        ('public.submit_assessment_attempt(uuid)'::regprocedure,'public.assessment_attempts'::regclass,'SELECT'::text),
        ('public.submit_assessment_attempt(uuid)'::regprocedure,'public.assessment_attempts'::regclass,'UPDATE'::text),
        ('public.submit_assessment_attempt(uuid)'::regprocedure,'public.assessments'::regclass,'SELECT'::text),
        ('public.submit_assessment_attempt(uuid)'::regprocedure,'public.assessment_answers'::regclass,'SELECT'::text),
        ('public.submit_assessment_attempt(uuid)'::regprocedure,'public.assessment_answers'::regclass,'UPDATE'::text),
        ('public.submit_assessment_attempt(uuid)'::regprocedure,'public.assessment_questions'::regclass,'SELECT'::text),
        ('public.submit_assessment_attempt(uuid)'::regprocedure,'public.assessment_options'::regclass,'SELECT'::text),

        -- Evaluation: reads attempt/assessment/profile/questions and updates answers/attempt.
        ('public.evaluate_assessment_attempt(uuid,uuid,boolean,jsonb,text)'::regprocedure,'public.assessment_attempts'::regclass,'SELECT'::text),
        ('public.evaluate_assessment_attempt(uuid,uuid,boolean,jsonb,text)'::regprocedure,'public.assessment_attempts'::regclass,'UPDATE'::text),
        ('public.evaluate_assessment_attempt(uuid,uuid,boolean,jsonb,text)'::regprocedure,'public.assessments'::regclass,'SELECT'::text),
        ('public.evaluate_assessment_attempt(uuid,uuid,boolean,jsonb,text)'::regprocedure,'public.profiles'::regclass,'SELECT'::text),
        ('public.evaluate_assessment_attempt(uuid,uuid,boolean,jsonb,text)'::regprocedure,'public.assessment_questions'::regclass,'SELECT'::text),
        ('public.evaluate_assessment_attempt(uuid,uuid,boolean,jsonb,text)'::regprocedure,'public.assessment_answers'::regclass,'SELECT'::text),
        ('public.evaluate_assessment_attempt(uuid,uuid,boolean,jsonb,text)'::regprocedure,'public.assessment_answers'::regclass,'UPDATE'::text)
      ) AS required(function_name,table_name,privilege)
      WHERE required.function_name=v_fn
    LOOP
      IF NOT has_table_privilege(v_owner,v_rel,v_privilege) THEN
        RAISE EXCEPTION 'Phase 5C.2 SECURITY DEFINER function % owner % lacks % privilege on table %.',
          v_fn,v_owner_name,v_privilege,v_rel;
      END IF;
      SELECT c.relowner,c.relrowsecurity,c.relforcerowsecurity
        INTO v_owner_oid,v_rls,v_force FROM pg_class c WHERE c.oid=v_rel;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Phase 5C.2 preflight cannot inspect RLS metadata for function % table %.',v_fn,v_rel;
      END IF;
      IF v_rls AND NOT coalesce(v_bypass,false) AND (v_owner_oid<>v_owner OR v_force) THEN
        RAISE EXCEPTION 'Phase 5C.2 SECURITY DEFINER function % owner % is subject to RLS on table % (relrowsecurity %, relforcerowsecurity %).',
          v_fn,v_owner_name,v_rel,v_rls,v_force;
      END IF;
    END LOOP;

    IF v_fn IN (
      'public.student_assessment_content_for_backend(uuid,uuid)'::regprocedure,
      'public.start_assessment_attempt(uuid,uuid)'::regprocedure,
      'public.save_assessment_attempt_answer(uuid,uuid,uuid[],text)'::regprocedure
    ) AND NOT has_function_privilege(v_owner,'public.assessment_student_is_eligible(uuid,uuid)'::regprocedure,'EXECUTE') THEN
      RAISE EXCEPTION 'Phase 5C.2 SECURITY DEFINER function % owner % lacks EXECUTE on helper public.assessment_student_is_eligible(uuid,uuid).',
        v_fn,v_owner_name;
    END IF;
  END LOOP;
END $$;


REVOKE ALL ON FUNCTION public.assessment_student_is_eligible(UUID,UUID),
  public.student_assessment_content_for_backend(UUID,UUID),
  public.start_assessment_attempt(UUID,UUID),
  public.save_assessment_attempt_answer(UUID,UUID,UUID[],TEXT),
  public.submit_assessment_attempt(UUID),
  public.evaluate_assessment_attempt(UUID,UUID,BOOLEAN,JSONB,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_assessment_attempt(UUID,UUID),
  public.assessment_student_is_eligible(UUID,UUID),
  public.student_assessment_content_for_backend(UUID,UUID),
  public.save_assessment_attempt_answer(UUID,UUID,UUID[],TEXT),
  public.submit_assessment_attempt(UUID),
  public.evaluate_assessment_attempt(UUID,UUID,BOOLEAN,JSONB,TEXT) TO service_role;

COMMIT;

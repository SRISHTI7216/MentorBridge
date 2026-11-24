-- DRAFT ONLY — Phase 5C.7 publication guard correction.
-- Keep the existing publication state machine and module/AI-review trigger.
-- The Phase 5C.1 trigger must ignore soft-removed questions exactly as the
-- application store does; otherwise a removed invalid question blocks publish.
-- Do not apply without reviewing the prerequisite Phase 5C.1/5C.3.3 drafts.

BEGIN;

CREATE OR REPLACE FUNCTION public.validate_assessment_questions_before_publish()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE q RECORD; n_options INTEGER; n_correct INTEGER; n_questions INTEGER; marks_sum NUMERIC; do_check BOOLEAN;
BEGIN
  do_check := NEW.status='published' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'published');
  IF NOT do_check THEN RETURN NEW; END IF;

  IF NEW.title IS NULL OR btrim(NEW.title)='' OR NEW.subject IS NULL OR btrim(NEW.subject)=''
    OR NEW.topic IS NULL OR btrim(NEW.topic)='' OR NEW.duration_minutes<=0 OR NEW.allowed_attempts<=0
    OR NEW.start_time IS NULL OR NEW.end_time IS NULL OR NEW.end_time<=NEW.start_time THEN
    RAISE EXCEPTION 'Assessment title, configuration, and availability window must be valid before publication.';
  END IF;
  IF NEW.origin_module_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.module_assessment_links l
    WHERE l.module_id=NEW.origin_module_id AND l.assessment_id=NEW.id) THEN
    RAISE EXCEPTION 'Module assessment must be linked to its origin module before publication.';
  END IF;

  SELECT count(*),coalesce(sum(marks),0) INTO n_questions,marks_sum FROM public.assessment_questions
    WHERE assessment_id=NEW.id AND removed_at IS NULL;
  IF n_questions=0 OR marks_sum<=0 THEN RAISE EXCEPTION 'Cannot publish without positively marked active questions.'; END IF;
  IF NEW.passing_percentage IS NULL AND (NEW.passing_marks<0 OR NEW.passing_marks>marks_sum) THEN
    RAISE EXCEPTION 'Passing marks must be between zero and total marks.';
  END IF;
  IF NEW.passing_percentage IS NOT NULL AND NEW.passing_percentage NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'Passing percentage must be between zero and one hundred.';
  END IF;

  FOR q IN SELECT id,question_type,question_text,marks FROM public.assessment_questions
    WHERE assessment_id=NEW.id AND removed_at IS NULL LOOP
    IF q.question_type NOT IN ('mcq','multiple_select','true_false','descriptive') OR btrim(coalesce(q.question_text,''))=''
      OR q.marks IS NULL OR q.marks<=0 THEN RAISE EXCEPTION 'Every active question needs supported type, text, and positive marks.'; END IF;
    SELECT count(*),count(*) FILTER(WHERE is_correct) INTO n_options,n_correct
      FROM public.assessment_options WHERE question_id=q.id;
    IF q.question_type='descriptive' THEN
      IF n_options<>0 THEN RAISE EXCEPTION 'Descriptive questions cannot have options.'; END IF;
      CONTINUE;
    END IF;
    IF n_options<2 OR EXISTS(SELECT 1 FROM public.assessment_options WHERE question_id=q.id AND btrim(option_text)='') THEN
      RAISE EXCEPTION 'Objective questions require at least two non-empty options.';
    END IF;
    IF q.question_type IN ('mcq','true_false') AND n_correct<>1 THEN RAISE EXCEPTION 'MCQ and true/false need exactly one correct option.'; END IF;
    IF q.question_type='multiple_select' AND n_correct<1 THEN RAISE EXCEPTION 'Multiple-select needs one or more correct options.'; END IF;
    IF q.question_type='true_false' AND (n_options<>2
      OR (SELECT count(DISTINCT lower(trim(option_text))) FROM public.assessment_options WHERE question_id=q.id)<>2
      OR NOT EXISTS(SELECT 1 FROM public.assessment_options WHERE question_id=q.id AND lower(trim(option_text))='true')
      OR NOT EXISTS(SELECT 1 FROM public.assessment_options WHERE question_id=q.id AND lower(trim(option_text))='false')) THEN
      RAISE EXCEPTION 'True/false requires exactly True and False options.';
    END IF;
  END LOOP;
  NEW.total_marks:=marks_sum;
  IF NEW.passing_percentage IS NOT NULL THEN
    NEW.passing_marks:=public.assessment_required_marks(marks_sum,NEW.passing_percentage);
  END IF;
  RETURN NEW;
END $$;

COMMIT;

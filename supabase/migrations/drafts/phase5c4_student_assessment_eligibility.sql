-- DRAFT ONLY: Phase 5C.4 keeps module enrollment eligibility independent from
-- assessment timing, attempt limits, and result release. Do not execute here.
-- start_assessment_attempt remains responsible for atomically enforcing those
-- start-time constraints. Every student read/write continues to call this
-- predicate so a revoked assignment or inactive enrollment immediately blocks
-- further access, including history and result review.

BEGIN;

DO $$
DECLARE
  v_fn OID;
  v_owner OID;
  v_start_owner OID;
  v_is_security_definer BOOLEAN;
  v_client_execute_grants TEXT[];
  v_anon_can_execute BOOLEAN;
  v_authenticated_can_execute BOOLEAN;
BEGIN
  v_fn := to_regprocedure('public.assessment_student_is_eligible(uuid,uuid)');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'Phase 5C.2 public.assessment_student_is_eligible(uuid,uuid) is required.';
  END IF;
  SELECT proowner, prosecdef INTO v_owner, v_is_security_definer FROM pg_proc WHERE oid=v_fn;
  v_start_owner := (SELECT proowner FROM pg_proc WHERE oid=to_regprocedure('public.start_assessment_attempt(uuid,uuid)'));
  IF v_start_owner IS NULL THEN
    RAISE EXCEPTION 'Phase 5C.2 public.start_assessment_attempt(uuid,uuid) is required.';
  END IF;
  IF NOT v_is_security_definer OR v_owner<>v_start_owner THEN
    RAISE EXCEPTION 'Eligibility function must remain SECURITY DEFINER and share the reviewed start RPC owner. Eligibility owner: %, start RPC owner: %, SECURITY DEFINER: %.',
      pg_get_userbyid(v_owner), pg_get_userbyid(v_start_owner), v_is_security_definer;
  END IF;
  IF NOT has_function_privilege('service_role',v_fn,'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must already have EXECUTE on the Phase 5C.2 eligibility function.';
  END IF;
  v_anon_can_execute := has_function_privilege('anon',v_fn,'EXECUTE');
  v_authenticated_can_execute := has_function_privilege('authenticated',v_fn,'EXECUTE');
  SELECT array_agg(DISTINCT CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname::TEXT END ORDER BY CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname::TEXT END)
    INTO v_client_execute_grants
  FROM pg_proc p
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) x
  LEFT JOIN pg_roles grantee ON grantee.oid=x.grantee
  WHERE p.oid=v_fn AND x.privilege_type='EXECUTE'
    AND (x.grantee=0 OR grantee.rolname IN ('anon','authenticated'));
  RAISE NOTICE 'Eligibility function preflight: owner %, SECURITY DEFINER %, service_role EXECUTE true, ACL client grants %, effective anon EXECUTE %, effective authenticated EXECUTE %. Client grants will be revoked by this draft.',
    pg_get_userbyid(v_owner), v_is_security_definer, COALESCE(v_client_execute_grants,ARRAY[]::TEXT[]), v_anon_can_execute, v_authenticated_can_execute;
  IF to_regclass('public.student_module_enrollments') IS NULL
    OR to_regclass('public.module_assignments') IS NULL
    OR to_regclass('public.module_assessment_links') IS NULL THEN
    RAISE EXCEPTION 'Phase 5B learning enrollment and assessment link tables are required.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.assessment_student_is_eligible(p_assessment_id UUID, p_student_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.assessments a
    JOIN public.profiles p ON p.id=p_student_id AND p.role='student' AND p.is_active
    WHERE a.id=p_assessment_id
      AND (
        EXISTS (
          SELECT 1 FROM public.module_assessment_links l
          JOIN public.learning_modules m ON m.id=l.module_id AND m.status='published'
          JOIN public.student_module_enrollments e ON e.module_id=m.id AND e.student_id=p_student_id
          WHERE l.assessment_id=a.id AND e.enrollment_type='institutional_common'
            AND e.assignment_id IS NULL AND e.status IN ('in_progress','completed')
        )
        OR EXISTS (
          SELECT 1 FROM public.module_assessment_links l
          JOIN public.learning_modules m ON m.id=l.module_id AND m.status='published'
          JOIN public.student_module_enrollments e ON e.module_id=m.id AND e.student_id=p_student_id
          JOIN public.module_assignments ma ON ma.id=e.assignment_id AND ma.module_id=e.module_id
            AND ma.student_id=e.student_id
          WHERE l.assessment_id=a.id AND e.enrollment_type='assigned'
            AND ((e.status='in_progress' AND ma.status='assigned')
              OR (e.status='completed' AND ma.status IN ('assigned','completed')))
        )
        OR (
          EXISTS (
            SELECT 1 FROM public.assessment_assignments aa WHERE aa.assessment_id=a.id
              AND aa.student_id=p_student_id AND (aa.cohort_id IS NULL OR EXISTS (
                SELECT 1 FROM public.student_details sd WHERE sd.profile_id=p_student_id AND sd.cohort_id=aa.cohort_id
              ))
          )
        )
        OR EXISTS (
          SELECT 1 FROM public.mentor_assignments ma
          WHERE ma.mentor_id=a.mentor_id AND ma.student_id=p_student_id AND ma.is_active=true
        )
      )
  )
$$;

-- This helper accepts an arbitrary student UUID and is called only from
-- service-role backend RPCs. The RLS policies use the separate auth.uid()-based
-- public.can_student_access_assessment(UUID) predicate, so no client role needs
-- direct execution of this service predicate.
REVOKE ALL ON FUNCTION public.assessment_student_is_eligible(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assessment_student_is_eligible(UUID,UUID) TO service_role;

DO $$
BEGIN
  IF has_function_privilege('anon','public.assessment_student_is_eligible(uuid,uuid)'::regprocedure,'EXECUTE')
    OR has_function_privilege('authenticated','public.assessment_student_is_eligible(uuid,uuid)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION 'Client roles retain effective EXECUTE on the service-only assessment eligibility predicate; inspect inherited role grants.';
  END IF;
  IF NOT has_function_privilege('service_role','public.assessment_student_is_eligible(uuid,uuid)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must retain EXECUTE on the assessment eligibility predicate.';
  END IF;
END $$;

COMMIT;

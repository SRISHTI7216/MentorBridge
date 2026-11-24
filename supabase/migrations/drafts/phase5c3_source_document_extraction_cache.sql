-- Review-only proposal for Phase 5C.3.1. Do not execute until reviewed.
-- Extracted teaching content is isolated from the broadly readable metadata table.
-- The existing assessment_source_documents grants and RLS policies are untouched.

-- Preflight: run manually before considering this proposal. Reports ownership,
-- RLS, effective table privileges, policies and current source-document rows.
SELECT c.oid::regclass AS table_name, pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
       has_table_privilege('authenticated', c.oid, 'INSERT') AS authenticated_insert,
       has_table_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_update,
       has_table_privilege('service_role', c.oid, 'SELECT') AS service_select,
       has_table_privilege('service_role', c.oid, 'INSERT') AS service_insert,
       has_table_privilege('service_role', c.oid, 'UPDATE') AS service_update
FROM pg_class c
WHERE c.oid IN ('public.assessment_source_documents'::regclass,
                to_regclass('public.assessment_source_document_extractions'));
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND tablename IN
  ('assessment_source_documents','assessment_source_document_extractions')
ORDER BY tablename, policyname;
SELECT count(*) AS source_documents,
       count(*) FILTER (WHERE extraction_status='ready') AS ready_documents,
       count(*) FILTER (WHERE extraction_status='processing') AS processing_documents
FROM public.assessment_source_documents;
SELECT id, module_id, assessment_id, uploaded_by, mime_type, size_bytes,
       extraction_status, page_count, uploaded_at, extracted_at
FROM public.assessment_source_documents ORDER BY uploaded_at DESC LIMIT 1000;

-- PostgreSQL CHECK constraints cannot contain subqueries. Define an immutable
-- validator so JSON shape/count/numbering/text-size checks remain enforceable.
CREATE OR REPLACE FUNCTION public.valid_assessment_source_extraction(
  units JSONB, chars INTEGER, range_kind TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE item JSONB; idx INTEGER:=0; previous_number INTEGER:=0; current_number INTEGER; total INTEGER:=0;
BEGIN
  IF jsonb_typeof(units)<>'array' OR jsonb_array_length(units) NOT BETWEEN 1 AND 500
     OR chars NOT BETWEEN 1 AND 2000000
     OR range_kind NOT IN ('page','slide','paragraph','line')
     OR octet_length(units::text)>12000000 THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(units) LOOP
    idx:=idx+1;
    IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'number')<>'number'
       OR jsonb_typeof(item->'text')<>'string'
       OR (item - 'number' - 'text') <> '{}'::jsonb
       OR (item->>'number') !~ '^[0-9]+$'
       THEN RETURN false; END IF;
    current_number:=(item->>'number')::integer;
    IF current_number<=previous_number THEN RETURN false; END IF;
    previous_number:=current_number;
    total:=total+char_length(item->>'text');
    IF total>2000000 THEN RETURN false; END IF;
  END LOOP;
  RETURN total=chars;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.valid_assessment_source_extraction(JSONB,INTEGER,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.valid_assessment_source_extraction(JSONB,INTEGER,TEXT) TO service_role;

CREATE TABLE IF NOT EXISTS public.assessment_source_document_extractions (
  source_document_id UUID PRIMARY KEY
    REFERENCES public.assessment_source_documents(id) ON DELETE CASCADE,
  extraction_units JSONB NOT NULL,
  extraction_character_count INTEGER NOT NULL,
  extraction_range_kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assessment_source_document_extractions'::regclass
                 AND conname='assessment_source_extractions_valid_check') THEN
    ALTER TABLE public.assessment_source_document_extractions
      ADD CONSTRAINT assessment_source_extractions_valid_check
      CHECK (public.valid_assessment_source_extraction(
        extraction_units, extraction_character_count, extraction_range_kind
      )) NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_assessment_source_extraction()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE doc public.assessment_source_documents%ROWTYPE; expected_kind TEXT; assessment_status TEXT; module_status TEXT;
BEGIN
  IF TG_OP='DELETE' THEN
    SELECT * INTO doc FROM public.assessment_source_documents WHERE id=OLD.source_document_id;
    -- Phase 5C.1's source-document DELETE trigger verifies draft status before
    -- FK cascade. Once it removes the parent, permit that already-guarded cascade.
    IF doc.id IS NULL AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;
    IF doc.id IS NULL THEN RAISE EXCEPTION 'Source document does not exist.'; END IF;
  ELSE
    SELECT * INTO doc FROM public.assessment_source_documents WHERE id=NEW.source_document_id;
  END IF;
  IF doc.id IS NULL THEN RAISE EXCEPTION 'Source document does not exist.'; END IF;
  SELECT a.status,m.status INTO assessment_status,module_status
    FROM public.assessments a JOIN public.learning_modules m ON m.id=doc.module_id
    WHERE a.id=doc.assessment_id;
  IF assessment_status IS DISTINCT FROM 'draft' OR module_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Extraction content can change or be deleted only while assessment and module are drafts.';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  expected_kind:=CASE doc.mime_type
    WHEN 'application/pdf' THEN 'page'
    WHEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation' THEN 'slide'
    WHEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' THEN 'paragraph'
    WHEN 'text/plain' THEN 'line' END;
  IF NEW.extraction_range_kind IS DISTINCT FROM expected_kind THEN
    RAISE EXCEPTION 'Extraction range kind does not match source format.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_assessment_source_extraction() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_assessment_source_extraction() TO service_role;
DROP TRIGGER IF EXISTS trg_guard_assessment_source_extraction
  ON public.assessment_source_document_extractions;
CREATE TRIGGER trg_guard_assessment_source_extraction
  BEFORE INSERT OR UPDATE OR DELETE ON public.assessment_source_document_extractions
  FOR EACH ROW EXECUTE FUNCTION public.guard_assessment_source_extraction();

ALTER TABLE public.assessment_source_document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_source_document_extractions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assessment_source_extractions_service_role_only
  ON public.assessment_source_document_extractions;
CREATE POLICY assessment_source_extractions_service_role_only
  ON public.assessment_source_document_extractions FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.assessment_source_document_extractions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_source_document_extractions TO service_role;

-- NOT VALID avoids scanning any pre-existing cache rows during installation;
-- all subsequent writes are checked. Validate after preflight review.
-- ALTER TABLE public.assessment_source_document_extractions
--   VALIDATE CONSTRAINT assessment_source_extractions_valid_check;

-- Access rules: anon and authenticated (including students and mentors) have no
-- table privileges and no RLS policy. Backend service_role can read/write via
-- the private server client. Table owner/superuser retain PostgreSQL owner powers;
-- service_role remains secret and server-only. Table owners are subject to FORCE
-- RLS unless they are superusers/BYPASSRLS roles. Metadata-table grants/policies
-- are unchanged, so legitimate status/count metadata updates continue to work.

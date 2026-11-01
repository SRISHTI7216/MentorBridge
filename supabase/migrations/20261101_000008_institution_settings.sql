-- ==============================================================================
-- Migration: 20261101_000008_institution_settings.sql
-- Description: Singleton institutional configuration table storing institution metadata
--              and authoritative IANA timezone identifier for scheduling.
-- Notes: Safely re-runnable with IF NOT EXISTS, DROP POLICY IF EXISTS, and DROP TRIGGER IF EXISTS guards.
-- DO NOT EXECUTE DIRECTLY VIA AGENT — User applies manually in Supabase SQL Editor.
-- ==============================================================================

-- 1. Create Singleton Institution Settings Table
CREATE TABLE IF NOT EXISTS public.institution_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  institution_name TEXT NOT NULL DEFAULT 'Department of Computer Science & Engineering',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata' CHECK (char_length(timezone) >= 3 AND char_length(timezone) <= 64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Timezone Validation Function & Trigger (Validates against PostgreSQL pg_timezone_names)
CREATE OR REPLACE FUNCTION public.validate_institution_timezone()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Invalid timezone: "%". Value must be a valid IANA timezone identifier recognized by PostgreSQL (e.g., Asia/Kolkata, UTC, America/New_York).', NEW.timezone;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_institution_timezone ON public.institution_settings;
CREATE TRIGGER trg_validate_institution_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.institution_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_institution_timezone();

-- 3. Automatic Updated-At Timestamp Trigger (Reuses project's handle_updated_at)
DROP TRIGGER IF EXISTS update_institution_settings_timestamp ON public.institution_settings;
CREATE TRIGGER update_institution_settings_timestamp
  BEFORE UPDATE ON public.institution_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 4. Row-Level Security (RLS) Configuration
ALTER TABLE public.institution_settings ENABLE ROW LEVEL SECURITY;

-- 4.1 Authenticated Read Policy: All authenticated users (students, mentors, admins) can view settings
DROP POLICY IF EXISTS "authenticated_read_institution_settings" ON public.institution_settings;
CREATE POLICY "authenticated_read_institution_settings"
  ON public.institution_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- 4.2 Administrator Insert Policy: Strictly allows admins to insert (e.g. initial setup)
DROP POLICY IF EXISTS "admin_insert_institution_settings" ON public.institution_settings;
CREATE POLICY "admin_insert_institution_settings"
  ON public.institution_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- 4.3 Administrator Update Policy: Strictly allows admins to update existing settings
DROP POLICY IF EXISTS "admin_update_institution_settings" ON public.institution_settings;
CREATE POLICY "admin_update_institution_settings"
  ON public.institution_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 5. Seed Singleton Institutional Configuration Row (Never overwrites existing admin modifications on rerun)
INSERT INTO public.institution_settings (id, institution_name, timezone)
VALUES (1, 'Department of Computer Science & Engineering', 'Asia/Kolkata')
ON CONFLICT (id) DO NOTHING;

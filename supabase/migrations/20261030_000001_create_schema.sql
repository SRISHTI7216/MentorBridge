-- ==============================================================================
-- Migration: 20261030_000001_create_schema.sql
-- Description: Core Schema for MentorBridge (CSE MentorNet) Phase 2
-- Includes: profiles, academic_terms, cohorts, student_details, mentor_details,
--           mentor_assignments, and constraint ensuring single active assignment.
-- ==============================================================================

-- 1. Automatic Timestamp Updater Function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. User Profiles Table (Linked to Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('student', 'mentor', 'admin')),
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TRIGGER update_profiles_timestamp
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 3. Academic Terms Table
CREATE TABLE IF NOT EXISTS public.academic_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE, -- e.g., 'AY24-25-S6'
  name TEXT NOT NULL,        -- e.g., 'AY 2024–25 Semester VI (Spring)'
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT check_term_dates CHECK (end_date >= start_date)
);

CREATE TRIGGER update_academic_terms_timestamp
  BEFORE UPDATE ON public.academic_terms
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 4. Cohorts Table
CREATE TABLE IF NOT EXISTS public.cohorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE, -- e.g., 'CSE-A-2021-2025'
  name TEXT NOT NULL,        -- e.g., 'CSE-A (Batch 2021-2025)'
  department TEXT NOT NULL DEFAULT 'Computer Science & Engineering',
  admission_year INTEGER NOT NULL,
  graduation_year INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT check_cohort_years CHECK (graduation_year >= admission_year)
);

CREATE TRIGGER update_cohorts_timestamp
  BEFORE UPDATE ON public.cohorts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 5. Student Details Table
CREATE TABLE IF NOT EXISTS public.student_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  roll_number TEXT NOT NULL UNIQUE,
  branch TEXT NOT NULL DEFAULT 'CSE',
  semester INTEGER NOT NULL DEFAULT 1 CHECK (semester BETWEEN 1 AND 8),
  division TEXT NOT NULL DEFAULT 'A',
  admission_year INTEGER NOT NULL,
  cohort_id UUID REFERENCES public.cohorts(id) ON DELETE SET NULL,
  overall_score NUMERIC(5, 2) DEFAULT 0.0 CHECK (overall_score >= 0 AND overall_score <= 100),
  dsa_proficiency NUMERIC(5, 2) DEFAULT 0.0 CHECK (dsa_proficiency >= 0 AND dsa_proficiency <= 100),
  system_design_score NUMERIC(5, 2) DEFAULT 0.0 CHECK (system_design_score >= 0 AND system_design_score <= 100),
  attendance_rate NUMERIC(5, 2) DEFAULT 0.0 CHECK (attendance_rate >= 0 AND attendance_rate <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TRIGGER update_student_details_timestamp
  BEFORE UPDATE ON public.student_details
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 6. Mentor Details Table
CREATE TABLE IF NOT EXISTS public.mentor_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL UNIQUE,
  department TEXT NOT NULL DEFAULT 'Computer Science & Engineering',
  designation TEXT NOT NULL,
  office_location TEXT,
  office_hours TEXT,
  specializations TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TRIGGER update_mentor_details_timestamp
  BEFORE UPDATE ON public.mentor_details
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 7. Mentor Assignments Table
CREATE TABLE IF NOT EXISTS public.mentor_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  academic_term_id UUID NOT NULL REFERENCES public.academic_terms(id) ON DELETE RESTRICT,
  assigned_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TRIGGER update_mentor_assignments_timestamp
  BEFORE UPDATE ON public.mentor_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 8. Unique Constraint: Prevent duplicate ACTIVE assignments for the same student and academic term
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_student_term_assignment
  ON public.mentor_assignments (student_id, academic_term_id)
  WHERE is_active = true;

-- 9. Foreign Key & Query Performance Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_student_details_profile ON public.student_details(profile_id);
CREATE INDEX IF NOT EXISTS idx_student_details_roll ON public.student_details(roll_number);
CREATE INDEX IF NOT EXISTS idx_mentor_details_profile ON public.mentor_details(profile_id);
CREATE INDEX IF NOT EXISTS idx_mentor_details_emp ON public.mentor_details(employee_id);
CREATE INDEX IF NOT EXISTS idx_mentor_assignments_mentor ON public.mentor_assignments(mentor_id);
CREATE INDEX IF NOT EXISTS idx_mentor_assignments_student ON public.mentor_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_mentor_assignments_term ON public.mentor_assignments(academic_term_id);
CREATE INDEX IF NOT EXISTS idx_mentor_assignments_active ON public.mentor_assignments(is_active);

-- 10. Automatic Profile Sync on Auth User Creation (Provisioning Hook)
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role, avatar_url, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NULL),
    true
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    email = EXCLUDED.email;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bind trigger to auth.users if not already attached
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();


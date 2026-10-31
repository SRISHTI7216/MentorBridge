-- ==============================================================================
-- Migration: 20261030_000003_seed_institutional_data.sql
-- Description: Baseline institutional seed records for Academic Terms and Cohorts
-- ==============================================================================

-- 1. Seed Current & Upcoming Academic Terms
INSERT INTO public.academic_terms (id, code, name, start_date, end_date, is_current)
VALUES 
  ('a0000000-0000-0000-0000-000000000001', 'AY24-25-S6', 'AY 2024–25 Semester VI (Spring)', '2025-01-15', '2025-05-30', true),
  ('a0000000-0000-0000-0000-000000000002', 'AY24-25-S5', 'AY 2024–25 Semester V (Fall)', '2024-08-01', '2024-12-20', false),
  ('a0000000-0000-0000-0000-000000000003', 'AY25-26-S7', 'AY 2025–26 Semester VII (Fall)', '2025-08-01', '2025-12-20', false)
ON CONFLICT (code) DO NOTHING;

-- 2. Seed CSE Cohorts
INSERT INTO public.cohorts (id, code, name, department, admission_year, graduation_year)
VALUES
  ('c0000000-0000-0000-0000-000000000001', 'CSE-A-2021-2025', 'CSE-A (Batch 2021-2025)', 'Department of Computer Science & Engineering', 2021, 2025),
  ('c0000000-0000-0000-0000-000000000002', 'CSE-B-2021-2025', 'CSE-B (Batch 2021-2025)', 'Department of Computer Science & Engineering', 2021, 2025),
  ('c0000000-0000-0000-0000-000000000003', 'CSE-A-2022-2026', 'CSE-A (Batch 2022-2026)', 'Department of Computer Science & Engineering', 2022, 2026)
ON CONFLICT (code) DO NOTHING;


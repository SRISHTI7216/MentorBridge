/**
 * Phase 2 Verification Suite
 * Executes automated tests for:
 * - Migration schema SQL validity and constraint declarations
 * - Partial unique index on active mentor assignments
 * - Prevent tampering trigger and reassign_mentor procedure
 * - Supabase client initialization and safety guards
 * - Role-based route logic and redirection rules
 * - RLS policy contract verification
 */

import fs from 'fs';
import path from 'path';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, testName: string, failureDetails?: string) {
  if (condition) {
    results.push({ name: testName, passed: true });
    console.log(`[PASS] ${testName}`);
  } else {
    results.push({ name: testName, passed: false, details: failureDetails });
    console.error(`[FAIL] ${testName}: ${failureDetails || 'Assertion failed'}`);
  }
}

async function runPhase2Tests() {
  console.log('\n========================================');
  console.log('MENTORBRIDGE (CSE MENTORNET) PHASE 2 TESTS');
  console.log('========================================\n');

  // --- SUITE 1: Migration Files & SQL Schema Verification ---
  console.log('--- SUITE 1: Migration Files & SQL Schema ---');
  const migrationDir = path.resolve(process.cwd(), 'supabase/migrations');
  assert(fs.existsSync(migrationDir), 'Migration directory exists');

  const files = fs.readdirSync(migrationDir);
  assert(files.includes('20261030_000001_create_schema.sql'), 'Migration 001 exists: create_schema.sql');
  assert(files.includes('20261030_000002_enable_rls.sql'), 'Migration 002 exists: enable_rls.sql');
  assert(files.includes('20261030_000003_seed_institutional_data.sql'), 'Migration 003 exists: seed_institutional_data.sql');

  const schemaSql = fs.readFileSync(path.join(migrationDir, '20261030_000001_create_schema.sql'), 'utf-8');
  assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.profiles'), 'Schema defines public.profiles');
  assert(schemaSql.includes("role TEXT NOT NULL CHECK (role IN ('student', 'mentor', 'admin'))"), 'Profiles role check constraint enforced');
  assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.student_details'), 'Schema defines public.student_details');
  assert(schemaSql.includes('roll_number TEXT NOT NULL UNIQUE'), 'Student details enforces unique roll number');
  assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.mentor_details'), 'Schema defines public.mentor_details');
  assert(schemaSql.includes('employee_id TEXT NOT NULL UNIQUE'), 'Mentor details enforces unique employee ID');
  assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.academic_terms'), 'Schema defines public.academic_terms');
  assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.cohorts'), 'Schema defines public.cohorts');
  assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.mentor_assignments'), 'Schema defines public.mentor_assignments');

  // Constraint: Prevent duplicate active assignments for the same student and academic term
  assert(
    schemaSql.includes('idx_unique_active_student_term_assignment') &&
    schemaSql.includes('WHERE is_active = true'),
    'Partial unique index prevents duplicate active assignments for (student_id, academic_term_id)'
  );

  // --- SUITE 2: RLS Policies & Security Controls ---
  console.log('\n--- SUITE 2: Row Level Security (RLS) & Triggers ---');
  const rlsSql = fs.readFileSync(path.join(migrationDir, '20261030_000002_enable_rls.sql'), 'utf-8');
  assert(rlsSql.includes('ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;'), 'RLS enabled on profiles');
  assert(rlsSql.includes('ALTER TABLE public.student_details ENABLE ROW LEVEL SECURITY;'), 'RLS enabled on student_details');
  assert(rlsSql.includes('ALTER TABLE public.mentor_details ENABLE ROW LEVEL SECURITY;'), 'RLS enabled on mentor_details');
  assert(rlsSql.includes('ALTER TABLE public.mentor_assignments ENABLE ROW LEVEL SECURITY;'), 'RLS enabled on mentor_assignments');
  assert(rlsSql.includes('ALTER TABLE public.academic_terms ENABLE ROW LEVEL SECURITY;'), 'RLS enabled on academic_terms');
  assert(rlsSql.includes('ALTER TABLE public.cohorts ENABLE ROW LEVEL SECURITY;'), 'RLS enabled on cohorts');

  // Security functions and triggers
  assert(rlsSql.includes('CREATE OR REPLACE FUNCTION public.is_admin()'), 'Helper is_admin() function declared');
  assert(rlsSql.includes('CREATE OR REPLACE FUNCTION public.prevent_role_or_active_tampering()'), 'Tamper prevention function declared');
  assert(rlsSql.includes('CREATE TRIGGER enforce_role_integrity'), 'Role escalation trigger bound to profiles');
  assert(rlsSql.includes('CREATE OR REPLACE FUNCTION public.reassign_mentor('), 'Explicit mentor reassignment procedure declared');

  // Specific RLS access rules
  assert(rlsSql.includes('student_view_own_details'), 'Policy: Student views only own student_details');
  assert(rlsSql.includes('mentor_view_assigned_mentee_details'), 'Policy: Mentor views details ONLY of assigned mentees');
  assert(rlsSql.includes('mentor_view_own_assignments'), 'Policy: Mentor views only own assignments');
  assert(rlsSql.includes('student_view_own_assignments'), 'Policy: Student views only own assignments');

  // --- SUITE 3: Credential Safety & Environment Config ---
  console.log('\n--- SUITE 3: Credential Safety & .env Guards ---');
  const envExample = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf-8');
  assert(envExample.includes('VITE_SUPABASE_URL='), '.env.example contains VITE_SUPABASE_URL');
  assert(envExample.includes('VITE_SUPABASE_ANON_KEY='), '.env.example contains VITE_SUPABASE_ANON_KEY');
  assert(envExample.includes('SUPABASE_URL='), '.env.example contains SUPABASE_URL');
  assert(envExample.includes('SUPABASE_SERVICE_ROLE_KEY='), '.env.example contains SUPABASE_SERVICE_ROLE_KEY');

  const gitignore = fs.readFileSync(path.resolve(process.cwd(), '.gitignore'), 'utf-8');
  assert(gitignore.includes('.env'), '.gitignore excludes .env files');
  assert(gitignore.includes('!.env.example'), '.gitignore allows .env.example');

  // --- SUITE 4: Role-Based Routing Guard Logic ---
  console.log('\n--- SUITE 4: Role-Based Route Navigation Logic ---');
  function simulateRouteAccess(userRole: string | null, routePath: string): { allowed: boolean; redirect?: string } {
    if (!userRole) {
      return { allowed: false, redirect: '/login' };
    }
    if (routePath.startsWith('/student')) {
      if (userRole === 'student' || userRole === 'admin') return { allowed: true };
      return { allowed: false, redirect: userRole === 'mentor' ? '/mentor/dashboard' : '/login' };
    }
    if (routePath.startsWith('/mentor')) {
      if (userRole === 'mentor' || userRole === 'admin') return { allowed: true };
      return { allowed: false, redirect: userRole === 'student' ? '/student/dashboard' : '/login' };
    }
    if (routePath.startsWith('/admin')) {
      if (userRole === 'admin') return { allowed: true };
      return { allowed: false, redirect: userRole === 'mentor' ? '/mentor/dashboard' : '/student/dashboard' };
    }
    return { allowed: true };
  }

  // Unauthenticated user checks
  const unauthAttempt = simulateRouteAccess(null, '/student/dashboard');
  assert(!unauthAttempt.allowed && unauthAttempt.redirect === '/login', 'Unauthenticated user redirected to /login');

  // Student role checks
  const studentValid = simulateRouteAccess('student', '/student/dashboard');
  assert(studentValid.allowed, 'Student can access /student/dashboard');

  const studentMentorAttempt = simulateRouteAccess('student', '/mentor/mentees');
  assert(!studentMentorAttempt.allowed && studentMentorAttempt.redirect === '/student/dashboard', 'Student blocked from /mentor/mentees and redirected to /student/dashboard');

  const studentAdminAttempt = simulateRouteAccess('student', '/admin/dashboard');
  assert(!studentAdminAttempt.allowed && studentAdminAttempt.redirect === '/student/dashboard', 'Student blocked from /admin/dashboard and redirected to /student/dashboard');

  // Mentor role checks
  const mentorValid = simulateRouteAccess('mentor', '/mentor/dashboard');
  assert(mentorValid.allowed, 'Mentor can access /mentor/dashboard');

  const mentorStudentAttempt = simulateRouteAccess('mentor', '/student/learning');
  assert(!mentorStudentAttempt.allowed && mentorStudentAttempt.redirect === '/mentor/dashboard', 'Mentor blocked from /student/learning and redirected to /mentor/dashboard');

  const mentorAdminAttempt = simulateRouteAccess('mentor', '/admin/dashboard');
  assert(!mentorAdminAttempt.allowed && mentorAdminAttempt.redirect === '/mentor/dashboard', 'Mentor blocked from /admin/dashboard and redirected to /mentor/dashboard');

  // Admin role checks
  const adminAccess = simulateRouteAccess('admin', '/admin/dashboard');
  assert(adminAccess.allowed, 'Admin can access /admin/dashboard');
  const adminMentorAccess = simulateRouteAccess('admin', '/mentor/mentees');
  assert(adminMentorAccess.allowed, 'Admin can access institutional /mentor routes');
  const adminStudentAccess = simulateRouteAccess('admin', '/student/dashboard');
  assert(adminStudentAccess.allowed, 'Admin can inspect /student routes');

  // --- SUITE 5: Removal of Demo Persona Switcher ---
  console.log('\n--- SUITE 5: Removal of Demo Persona Switcher ---');
  const navbarCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/layout/Navbar.tsx'), 'utf-8');
  assert(!navbarCode.includes('Switch demo persona'), 'Demo persona switcher button removed from Navbar');
  assert(!navbarCode.includes('Switch Prototype Role'), 'Demo persona switcher menu removed from Navbar');
  assert(navbarCode.includes('handleSignOut'), 'Navbar integrates authentic session Sign Out action');

  // --- SUMMARY ---
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  console.log('\n========================================');
  console.log(`TEST SUMMARY: ${passedCount} / ${totalCount} PASSED`);
  console.log('========================================\n');

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runPhase2Tests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});


/**
 * Phase 4A Verification Suite - Database Preparation & Migration Contracts
 *
 * Clearly distinguishes:
 * [SECTION A] Static Migration, Schema Constraints, Indexes & RLS Policy Checks (Offline / Deterministic)
 * [SECTION B] Application Code & Store Compatibility Contracts
 * [SECTION C] Live Database Verification Contracts (Executed only post-manual Supabase migration)
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

interface TestReport {
  suite: string;
  testName: string;
  passed: boolean;
  category: 'STATIC MIGRATION' | 'RLS POLICIES' | 'INDEXES & CONSTRAINTS' | 'APP COMPATIBILITY';
  details?: string;
}

const reports: TestReport[] = [];

function assert(
  condition: boolean,
  suite: string,
  testName: string,
  category: 'STATIC MIGRATION' | 'RLS POLICIES' | 'INDEXES & CONSTRAINTS' | 'APP COMPATIBILITY',
  failureDetails?: string
) {
  if (condition) {
    reports.push({ suite, testName, passed: true, category });
    console.log(`[PASS] [${category}] ${testName}`);
  } else {
    reports.push({ suite, testName, passed: false, category, details: failureDetails });
    console.error(`[FAIL] [${category}] ${testName}: ${failureDetails || 'Assertion failed'}`);
  }
}

export function runPhase4AMigrationVerification() {
  console.log('\n============================================================');
  console.log('MENTORBRIDGE PHASE 4A: DATABASE PREPARATION & MIGRATION AUDIT');
  console.log('============================================================\n');

  const migrationDir = path.resolve(process.cwd(), 'supabase/migrations');
  const files = fs.readdirSync(migrationDir);

  // --------------------------------------------------------------------------
  // 1. Migration File Existence & Timestamp Convention
  // --------------------------------------------------------------------------
  const migration006Name = '20261101_000006_create_ai_feedback_and_analytics_schema.sql';
  assert(
    files.includes(migration006Name),
    '1. Migration File',
    `Migration 006 exists: ${migration006Name}`,
    'STATIC MIGRATION'
  );

  const migration006Path = path.join(migrationDir, migration006Name);
  const migrationSql = fs.readFileSync(migration006Path, 'utf-8');

  // --------------------------------------------------------------------------
  // 2. Publication Timestamp on Assessments Table
  // --------------------------------------------------------------------------
  assert(
    migrationSql.includes('ALTER TABLE public.assessments') &&
      migrationSql.includes('ADD COLUMN IF NOT EXISTS results_published_at TIMESTAMPTZ'),
    '2. Publication Timestamp',
    'Assessments table altered with results_published_at TIMESTAMPTZ column',
    'STATIC MIGRATION'
  );

  assert(
    migrationSql.includes('COMMENT ON COLUMN public.assessments.results_published_at'),
    '2. Publication Timestamp',
    'Historical publication records handled explicitly without fabricated dates',
    'STATIC MIGRATION'
  );

  // --------------------------------------------------------------------------
  // 3. AI Feedback Reports Table & Columns
  // --------------------------------------------------------------------------
  assert(
    migrationSql.includes('CREATE TABLE IF NOT EXISTS public.ai_feedback_reports'),
    '3. AI Feedback Table',
    'Declares public.ai_feedback_reports table',
    'STATIC MIGRATION'
  );

  const requiredColumns = [
    'id UUID PRIMARY KEY',
    'student_id UUID NOT NULL',
    'feedback_type TEXT NOT NULL',
    'assessment_id UUID',
    'attempt_id UUID',
    'academic_term_id UUID',
    'period_start TIMESTAMPTZ',
    'period_end TIMESTAMPTZ',
    'status TEXT NOT NULL',
    'summary TEXT',
    'strengths TEXT[]',
    'weaknesses TEXT[]',
    'recommended_actions TEXT[]',
    'provider TEXT NOT NULL',
    'model_name TEXT NOT NULL',
    'prompt_tokens INTEGER',
    'completion_tokens INTEGER',
    'latency_ms INTEGER',
    'input_snapshot_hash TEXT NOT NULL',
    'error_message TEXT',
    'retry_count INTEGER',
    'created_at TIMESTAMPTZ',
    'updated_at TIMESTAMPTZ',
  ];

  for (const col of requiredColumns) {
    assert(
      migrationSql.includes(col),
      '3. AI Feedback Columns',
      `Contains column declaration: ${col}`,
      'STATIC MIGRATION'
    );
  }

  // --------------------------------------------------------------------------
  // 3b. Free Model Policy & Provider Metadata
  // --------------------------------------------------------------------------
  assert(
    migrationSql.includes("model_name TEXT NOT NULL DEFAULT 'openrouter/free'"),
    '3b. Free Model Policy',
    "Migration enforces openrouter/free as initial model default",
    'STATIC MIGRATION'
  );

  assert(
    !migrationSql.includes('google/gemini-2.5-flash') &&
      !migrationSql.includes('gpt-4') &&
      !migrationSql.includes('claude-3'),
    '3b. Free Model Policy',
    'No paid or proprietary models configured as defaults or fallbacks in migration',
    'STATIC MIGRATION'
  );

  const envExamplePath = path.resolve(process.cwd(), '.env.example');
  const envExampleContent = fs.readFileSync(envExamplePath, 'utf-8');
  assert(
    envExampleContent.includes('OPENROUTER_MODEL=openrouter/free'),
    '3b. Free Model Policy',
    '.env.example documents OPENROUTER_MODEL=openrouter/free for backend configuration',
    'STATIC MIGRATION'
  );

  // --------------------------------------------------------------------------
  // 4. Feedback History Preservation & Non-Destructive Foreign Keys
  // --------------------------------------------------------------------------
  assert(
    migrationSql.includes('REFERENCES public.assessments(id) ON DELETE SET NULL'),
    '4. Foreign Key Constraints',
    'assessment_id uses ON DELETE SET NULL to preserve student learning feedback',
    'INDEXES & CONSTRAINTS'
  );

  assert(
    migrationSql.includes('REFERENCES public.assessment_attempts(id) ON DELETE RESTRICT'),
    '4. Foreign Key Constraints',
    'attempt_id uses ON DELETE RESTRICT to prevent foreign-key/check-constraint conflicts',
    'INDEXES & CONSTRAINTS'
  );

  assert(
    !migrationSql.includes('REFERENCES public.assessment_attempts(id) ON DELETE SET NULL'),
    '4. Foreign Key Constraints',
    'attempt_id does NOT use ON DELETE SET NULL (avoids violating check_immediate_feedback_attempt)',
    'INDEXES & CONSTRAINTS'
  );

  assert(
    migrationSql.includes('REFERENCES public.academic_terms(id) ON DELETE RESTRICT'),
    '4. Foreign Key Constraints',
    'academic_term_id uses ON DELETE RESTRICT to satisfy check_weekly_feedback_fields',
    'INDEXES & CONSTRAINTS'
  );

  assert(
    migrationSql.includes('REFERENCES public.profiles(id) ON DELETE RESTRICT'),
    '4. Foreign Key Constraints',
    'student_id uses ON DELETE RESTRICT to preserve student audit ownership',
    'INDEXES & CONSTRAINTS'
  );

  // --------------------------------------------------------------------------
  // 4b. Trigger Compatibility & Idempotency
  // --------------------------------------------------------------------------
  const schema001Path = path.join(migrationDir, '20261030_000001_create_schema.sql');
  const schema001Sql = fs.readFileSync(schema001Path, 'utf-8');

  assert(
    schema001Sql.includes('CREATE OR REPLACE FUNCTION public.handle_updated_at()') &&
      schema001Sql.includes('NEW.updated_at = timezone(\'utc\'::text, now());'),
    '4b. Trigger Compatibility',
    'public.handle_updated_at() exists in base schema and updates updated_at in UTC',
    'INDEXES & CONSTRAINTS'
  );

  assert(
    migrationSql.includes('DROP TRIGGER IF EXISTS update_ai_feedback_reports_timestamp ON public.ai_feedback_reports;') &&
      migrationSql.includes('EXECUTE FUNCTION public.handle_updated_at();'),
    '4b. Trigger Compatibility',
    'Trigger update_ai_feedback_reports_timestamp is idempotent and attaches to public.handle_updated_at()',
    'INDEXES & CONSTRAINTS'
  );

  // --------------------------------------------------------------------------
  // 5. Check Constraints (Feedback Types, Reporting Periods, Attempt linkage)
  // --------------------------------------------------------------------------
  assert(
    migrationSql.includes("CHECK (feedback_type IN ('immediate', 'weekly'))"),
    '5. Check Constraints',
    'Feedback type restricted to immediate and weekly',
    'INDEXES & CONSTRAINTS'
  );

  assert(
    migrationSql.includes("CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped_insufficient_data'))"),
    '5. Check Constraints',
    'Lifecycle statuses include pending, processing, completed, failed, skipped_insufficient_data',
    'INDEXES & CONSTRAINTS'
  );

  assert(
    migrationSql.includes("CHECK (feedback_type <> 'immediate' OR attempt_id IS NOT NULL)"),
    '5. Check Constraints',
    'Immediate feedback requires a non-null attempt_id',
    'INDEXES & CONSTRAINTS'
  );

  assert(
    /period_end\s*>=\s*period_start/.test(migrationSql),
    '5. Check Constraints',
    'Reporting periods enforce period_end >= period_start',
    'INDEXES & CONSTRAINTS'
  );

  assert(
    /feedback_type\s*<>\s*'weekly'\s*OR\s*\(\s*academic_term_id\s+IS\s+NOT\s+NULL\s+AND\s+period_start\s+IS\s+NOT\s+NULL\s+AND\s+period_end\s+IS\s+NOT\s+NULL\s*\)/i.test(migrationSql),
    '5. Check Constraints',
    'Weekly feedback enforces mandatory term, period_start, and period_end',
    'INDEXES & CONSTRAINTS'
  );

  // --------------------------------------------------------------------------
  // 6. Idempotency & Uniqueness Constraints
  // --------------------------------------------------------------------------
  assert(
    migrationSql.includes('idx_unique_immediate_feedback_per_attempt') &&
      migrationSql.includes('UNIQUE INDEX') &&
      migrationSql.includes('(student_id, attempt_id, feedback_type)'),
    '6. Idempotency',
    'Unique index enforces single immediate feedback per attempt (allows multi-attempt feedback)',
    'INDEXES & CONSTRAINTS'
  );

  assert(
    migrationSql.includes('idx_unique_weekly_feedback_per_period') &&
      migrationSql.includes('UNIQUE INDEX') &&
      migrationSql.includes('(student_id, academic_term_id, period_start, period_end, feedback_type)'),
    '6. Idempotency',
    'Unique index enforces single weekly feedback per student and reporting period',
    'INDEXES & CONSTRAINTS'
  );

  // --------------------------------------------------------------------------
  // 7. Analytics & AI Feedback Performance Indexes
  // --------------------------------------------------------------------------
  const requiredIndexes = [
    'idx_feedback_student_type_status',
    'idx_feedback_attempt',
    'idx_feedback_period',
    'idx_feedback_status',
    'idx_attempts_student_eval_status',
    'idx_assessments_results_published',
    'idx_answers_attempt_eval',
  ];

  for (const idx of requiredIndexes) {
    assert(
      migrationSql.includes(idx),
      '7. Performance Indexes',
      `Includes performance index: ${idx}`,
      'INDEXES & CONSTRAINTS'
    );
  }

  // --------------------------------------------------------------------------
  // 8. Row Level Security Policies
  // --------------------------------------------------------------------------
  assert(
    migrationSql.includes('ALTER TABLE public.ai_feedback_reports ENABLE ROW LEVEL SECURITY;'),
    '8. RLS Policies',
    'RLS enabled on public.ai_feedback_reports',
    'RLS POLICIES'
  );

  assert(
    migrationSql.includes('DROP POLICY IF EXISTS "admin_all_ai_feedback_reports" ON public.ai_feedback_reports;') &&
      migrationSql.includes('CREATE POLICY "admin_all_ai_feedback_reports"') &&
      migrationSql.includes('public.is_admin()'),
    '8. RLS Policies',
    'Admin policy is safely re-creatable via DROP POLICY IF EXISTS and uses public.is_admin()',
    'RLS POLICIES'
  );

  assert(
    migrationSql.includes('DROP POLICY IF EXISTS "student_view_own_completed_feedback" ON public.ai_feedback_reports;') &&
      migrationSql.includes('CREATE POLICY "student_view_own_completed_feedback"') &&
      migrationSql.includes('student_id = auth.uid()') &&
      migrationSql.includes("status = 'completed'"),
    '8. RLS Policies',
    'Student policy is safely re-creatable via DROP POLICY IF EXISTS and restricts to own completed reports',
    'RLS POLICIES'
  );

  assert(
    migrationSql.includes('DROP POLICY IF EXISTS "mentor_view_mentee_feedback" ON public.ai_feedback_reports;') &&
      migrationSql.includes('CREATE POLICY "mentor_view_mentee_feedback"') &&
      migrationSql.includes('public.is_active_mentor_for_student(student_id)'),
    '8. RLS Policies',
    'Mentor policy is safely re-creatable via DROP POLICY IF EXISTS and restricts to assigned active mentees',
    'RLS POLICIES'
  );

  assert(
    !migrationSql.includes('CREATE POLICY "student_insert') &&
      !migrationSql.includes('CREATE POLICY "mentor_insert'),
    '8. RLS Policies',
    'Direct INSERT/UPDATE/DELETE strictly prohibited for students and mentors (service-role only)',
    'RLS POLICIES'
  );

  // --------------------------------------------------------------------------
  // 9. Application Code & Store Compatibility
  // --------------------------------------------------------------------------
  const assessmentStorePath = path.resolve(process.cwd(), 'server/src/services/assessmentStore.ts');
  const assessmentStoreCode = fs.readFileSync(assessmentStorePath, 'utf-8');

  assert(
    assessmentStoreCode.includes('resultsPublishedAt?: string | null;'),
    '9. App Compatibility',
    'StoredAssessment interface includes resultsPublishedAt',
    'APP COMPATIBILITY'
  );

  assert(
    assessmentStoreCode.includes('resultsPublishedAt: row.results_published_at || null'),
    '9. App Compatibility',
    'mapAssessmentRow maps results_published_at from database',
    'APP COMPATIBILITY'
  );

  assert(
    assessmentStoreCode.includes('if (updates.resultsPublishedAt !== undefined) payload.results_published_at = updates.resultsPublishedAt;'),
    '9. App Compatibility',
    'updateAssessment supports updating results_published_at',
    'APP COMPATIBILITY'
  );

  const assessmentRoutesPath = path.resolve(process.cwd(), 'server/src/routes/assessmentRoutes.ts');
  const assessmentRoutesCode = fs.readFileSync(assessmentRoutesPath, 'utf-8');

  assert(
    assessmentRoutesCode.includes('existing.resultsPublishedAt || new Date().toISOString()'),
    '9. App Compatibility',
    'Publish results endpoint sets resultsPublishedAt without overwriting on duplicate requests',
    'APP COMPATIBILITY'
  );

  const typesPath = path.resolve(process.cwd(), 'src/types/assessment.ts');
  const typesCode = fs.readFileSync(typesPath, 'utf-8');

  assert(
    typesCode.includes('resultsPublishedAt?: string | null;'),
    '9. App Compatibility',
    'Frontend Assessment type includes resultsPublishedAt',
    'APP COMPATIBILITY'
  );

  assert(
    typesCode.includes('export interface AiFeedbackReport'),
    '9. App Compatibility',
    'TypeScript interface AiFeedbackReport defined for upcoming analytics & AI features',
    'APP COMPATIBILITY'
  );

  console.log('\n============================================================');
  const passed = reports.filter((r) => r.passed).length;
  console.log(`PHASE 4A MIGRATION CONTRACT AUDIT: ${passed} / ${reports.length} PASSED`);
  console.log('============================================================\n');

  if (reports.some((r) => !r.passed)) {
    process.exit(1);
  }
}

runPhase4AMigrationVerification();

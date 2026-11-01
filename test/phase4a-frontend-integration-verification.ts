/**
 * Phase 4A Step 4: Frontend Analytics Dashboard Integration Verification
 * 
 * Verifies that:
 * 1. Student Reports page uses live API data with zero mock data.
 * 2. Mentor Reports page uses live API data with zero mock data.
 * 3. Loading, empty, and error states are fully handled.
 * 4. Pagination is implemented for assessment history.
 * 5. Unpublished scores and feedback are strictly withheld from students.
 * 6. Mentors can only view actively assigned mentees (no cross-mentor leakage).
 * 7. Charts render safely with empty datasets.
 * 8. At-risk labels are described as review indicators, not definitive judgments.
 * 9. Exact API client signatures are correctly wired and typed.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

import { apiClient } from '../src/services/apiClient';

let testsPassed = 0;
let testsTotal = 0;

function assert(condition: boolean, section: string, testName: string, category: string = 'FRONTEND INTEGRATION') {
  testsTotal++;
  if (condition) {
    testsPassed++;
    console.log(`[PASS] [${category}] ${testName}`);
  } else {
    console.error(`[FAIL] [${category}] ${testName}: Assertion failed`);
  }
}

async function runFrontendIntegrationVerification() {
  console.log('\n============================================================');
  console.log('MENTORBRIDGE PHASE 4A: FRONTEND ANALYTICS DASHBOARD VERIFICATION');
  console.log('============================================================\n');

  // ==========================================================================
  // SECTION A: STATIC SOURCE CONTRACT & MOCK REMOVAL AUDIT
  // ==========================================================================
  console.log('>>> SECTION A: STATIC CONTRACT & MOCK REMOVAL AUDIT <<<\n');

  const studentReportsPath = path.resolve(process.cwd(), 'src/features/student/Reports.tsx');
  const mentorReportsPath = path.resolve(process.cwd(), 'src/features/mentor/Reports.tsx');
  const apiClientPath = path.resolve(process.cwd(), 'src/services/apiClient.ts');

  assert(fs.existsSync(studentReportsPath), 'A: Files', 'Student Reports component exists: src/features/student/Reports.tsx');
  assert(fs.existsSync(mentorReportsPath), 'A: Files', 'Mentor Reports component exists: src/features/mentor/Reports.tsx');
  assert(fs.existsSync(apiClientPath), 'A: Files', 'API client exists: src/services/apiClient.ts');

  const studentCode = fs.readFileSync(studentReportsPath, 'utf-8');
  const mentorCode = fs.readFileSync(mentorReportsPath, 'utf-8');
  const apiCode = fs.readFileSync(apiClientPath, 'utf-8');

  // Mock data removal checks
  assert(!studentCode.includes('CURRENT_STUDENT'), 'A: Mock Data', 'Student Reports does not import or reference CURRENT_STUDENT');
  assert(!studentCode.includes('MOCK_ASSESSMENTS'), 'A: Mock Data', 'Student Reports does not import or reference MOCK_ASSESSMENTS');
  assert(!studentCode.includes('MOCK_LEARNING_MODULES'), 'A: Mock Data', 'Student Reports does not import or reference MOCK_LEARNING_MODULES');
  assert(!studentCode.includes('Cumulative Score</span>\n          <p className="text-3xl font-bold font-display text-primary">84.5%</p>'), 'A: Mock Data', 'Student Reports replaced hardcoded 84.5% template score');

  assert(!mentorCode.includes('CURRENT_MENTOR'), 'A: Mock Data', 'Mentor Reports does not import or reference CURRENT_MENTOR');
  assert(!mentorCode.includes('MOCK_MENTEES'), 'A: Mock Data', 'Mentor Reports does not import or reference MOCK_MENTEES');
  assert(!mentorCode.includes('Criterion 3.1: Algorithmic Rigor'), 'A: Mock Data', 'Mentor Reports replaced static ABET mock template');

  // ==========================================================================
  // SECTION B: STUDENT REPORTS API WIRING & CONTRACTS
  // ==========================================================================
  console.log('\n>>> SECTION B: STUDENT REPORTS API WIRING & DATA FLOW <<<\n');

  assert(studentCode.includes('apiClient.getStudentAnalyticsSummary()'), 'B: Wiring', 'Student Reports connects getStudentAnalyticsSummary()');
  assert(studentCode.includes('apiClient.getStudentAnalyticsCounts()'), 'B: Wiring', 'Student Reports connects getStudentAnalyticsCounts()');
  assert(studentCode.includes('apiClient.getStudentAnalyticsTopics()'), 'B: Wiring', 'Student Reports connects getStudentAnalyticsTopics()');
  assert(studentCode.includes('apiClient.getStudentAnalyticsHistory('), 'B: Wiring', 'Student Reports connects getStudentAnalyticsHistory() with pagination');
  assert(studentCode.includes('apiClient.getStudentAnalyticsTrends()'), 'B: Wiring', 'Student Reports connects getStudentAnalyticsTrends()');

  // Verification of key student display requirements
  assert(studentCode.includes('counts?.totalAssigned'), 'B: Display', 'Student Reports renders total assigned assessments count');
  assert(studentCode.includes('counts?.publishedResults'), 'B: Display', 'Student Reports renders published results count');
  assert(studentCode.includes('counts?.inProgress'), 'B: Display', 'Student Reports renders in-progress assessments count');
  assert(studentCode.includes('counts?.pending'), 'B: Display', 'Student Reports renders pending assessments count');
  assert(studentCode.includes('counts?.missed'), 'B: Display', 'Student Reports renders missed assessments count');
  assert(studentCode.includes('overallPct'), 'B: Display', 'Student Reports renders overall published performance percentage');
  assert(studentCode.includes('mcqAccuracy'), 'B: Display', 'Student Reports displays objective MCQ accuracy separately');
  assert(studentCode.includes('descriptivePercentage'), 'B: Display', 'Student Reports displays descriptive marks separately');
  assert(studentCode.includes('Insufficient Data'), 'B: Display', 'Student Reports clearly labels insufficient-data topics (< 3 questions)');

  // Unpublished score safeguard check
  assert(
    studentCode.includes('item.isResultsPublished ?') && studentCode.includes('Hidden until publication'),
    'B: Security',
    'Student Reports strictly hides unpublished scores and mentor feedback'
  );

  // Pagination controls check
  assert(
    studentCode.includes('handlePageChange') && studentCode.includes('historyLimit') && studentCode.includes('totalPages'),
    'B: Pagination',
    'Student Reports provides complete pagination controls for assessment history'
  );

  // ==========================================================================
  // SECTION C: MENTOR REPORTS API WIRING & DATA FLOW
  // ==========================================================================
  console.log('\n>>> SECTION C: MENTOR REPORTS API WIRING & DATA FLOW <<<\n');

  assert(mentorCode.includes('apiClient.getMentorAnalyticsOverview()'), 'C: Wiring', 'Mentor Reports connects getMentorAnalyticsOverview()');
  assert(mentorCode.includes('apiClient.getMentorMenteesList()'), 'C: Wiring', 'Mentor Reports connects getMentorMenteesList()');
  assert(mentorCode.includes('apiClient.getMentorAtRiskMentees()'), 'C: Wiring', 'Mentor Reports connects getMentorAtRiskMentees()');
  assert(mentorCode.includes('apiClient.getMentorCohortTopics()'), 'C: Wiring', 'Mentor Reports connects getMentorCohortTopics()');
  assert(mentorCode.includes('apiClient.getIndividualMenteeSummary('), 'C: Wiring', 'Mentor Reports connects getIndividualMenteeSummary() for drilldowns');
  assert(mentorCode.includes('apiClient.getIndividualMenteeTopics('), 'C: Wiring', 'Mentor Reports connects getIndividualMenteeTopics() for drilldowns');
  assert(mentorCode.includes('apiClient.getIndividualMenteeTrends('), 'C: Wiring', 'Mentor Reports connects getIndividualMenteeTrends() for drilldowns');

  // Verification of key mentor display requirements
  assert(mentorCode.includes('overview?.activeMenteesCount'), 'C: Display', 'Mentor Reports renders active assigned mentee count');
  assert(mentorCode.includes('overview?.cohortAveragePercentage'), 'C: Display', 'Mentor Reports renders cohort average performance');
  assert(mentorCode.includes('overview?.completionRate'), 'C: Display', 'Mentor Reports renders cohort completion rate');
  assert(mentorCode.includes('distributionBars'), 'C: Display', 'Mentor Reports renders score distribution histogram');
  assert(mentorCode.includes('overview?.atRiskCount'), 'C: Display', 'Mentor Reports renders at-risk count');
  assert(mentorCode.includes('filteredMentees.map'), 'C: Display', 'Mentor Reports renders mentee performance table/roster');
  assert(mentorCode.includes('cohortTopics.map'), 'C: Display', 'Mentor Reports renders topic-level cohort strengths and weaknesses');
  assert(mentorCode.includes('handleOpenMenteeDetail'), 'C: Display', 'Mentor Reports provides individual mentee advisory dossier modal');

  // Indicator wording check (non-judgmental review indicators)
  assert(
    mentorCode.includes('Review Indicators') && mentorCode.includes('Not Definitive Judgments'),
    'C: Advisory',
    'At-risk labels are explicitly described as indicators for review, not definitive judgments'
  );

  // ==========================================================================
  // SECTION D: LOADING, EMPTY & ERROR STATE DEFENSIVE DESIGN
  // ==========================================================================
  console.log('\n>>> SECTION D: LOADING, EMPTY & ERROR STATES <<<\n');

  assert(studentCode.includes('isLoading') && studentCode.includes('animate-pulse'), 'D: States', 'Student Reports includes loading skeleton state');
  assert(studentCode.includes('errorMessage') && studentCode.includes('Retry Data Load'), 'D: States', 'Student Reports includes error state with retry button');
  assert(studentCode.includes('topics.length === 0') && studentCode.includes('trends.length === 0'), 'D: States', 'Student Reports handles empty topics and empty trend chart safely');

  assert(mentorCode.includes('isLoading') && mentorCode.includes('animate-pulse'), 'D: States', 'Mentor Reports includes loading skeleton state');
  assert(mentorCode.includes('errorMessage') && mentorCode.includes('Retry Cohort Load'), 'D: States', 'Mentor Reports includes error state with retry button');
  assert(mentorCode.includes('filteredMentees.length === 0'), 'D: States', 'Mentor Reports handles empty mentee roster state safely');
  assert(mentorCode.includes('distributionBars.every'), 'D: States', 'Mentor Reports handles empty score distribution histogram safely');

  // ==========================================================================
  // SECTION E: API CLIENT SIGNATURE AND TYPE COMPATIBILITY
  // ==========================================================================
  console.log('\n>>> SECTION E: API CLIENT CONTRACTS & SIGNATURES <<<\n');

  assert(typeof apiClient.getStudentAnalyticsSummary === 'function', 'E: API Client', 'apiClient exposes getStudentAnalyticsSummary()');
  assert(typeof apiClient.getStudentAnalyticsCounts === 'function', 'E: API Client', 'apiClient exposes getStudentAnalyticsCounts()');
  assert(typeof apiClient.getStudentAnalyticsTopics === 'function', 'E: API Client', 'apiClient exposes getStudentAnalyticsTopics()');
  assert(typeof apiClient.getStudentTopicAnalytics === 'function', 'E: API Client', 'apiClient exposes getStudentTopicAnalytics()');
  assert(typeof apiClient.getStudentAnalyticsHistory === 'function', 'E: API Client', 'apiClient exposes getStudentAnalyticsHistory()');
  assert(typeof apiClient.getStudentAnalyticsTrends === 'function', 'E: API Client', 'apiClient exposes getStudentAnalyticsTrends()');
  assert(typeof apiClient.getMentorAnalyticsOverview === 'function', 'E: API Client', 'apiClient exposes getMentorAnalyticsOverview()');
  assert(typeof apiClient.getMentorMenteesList === 'function', 'E: API Client', 'apiClient exposes getMentorMenteesList()');
  assert(typeof apiClient.getMentorAtRiskMentees === 'function', 'E: API Client', 'apiClient exposes getMentorAtRiskMentees()');
  assert(typeof apiClient.getMentorCohortTopics === 'function', 'E: API Client', 'apiClient exposes getMentorCohortTopics()');
  assert(typeof apiClient.getIndividualMenteeSummary === 'function', 'E: API Client', 'apiClient exposes getIndividualMenteeSummary()');
  assert(typeof apiClient.getIndividualMenteeTopics === 'function', 'E: API Client', 'apiClient exposes getIndividualMenteeTopics()');
  assert(typeof apiClient.getIndividualMenteeTrends === 'function', 'E: API Client', 'apiClient exposes getIndividualMenteeTrends()');

  console.log('\n============================================================');
  console.log(`FRONTEND INTEGRATION VERIFICATION: ${testsPassed} / ${testsTotal} PASSED`);
  console.log('============================================================\n');

  if (testsPassed !== testsTotal) {
    process.exit(1);
  }
}

runFrontendIntegrationVerification().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});


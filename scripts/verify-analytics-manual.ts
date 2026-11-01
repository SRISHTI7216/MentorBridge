/**
 * Manual API Verification Runner for Phase 4A Analytics Endpoints
 * 
 * Verifies real HTTP request/response flows against the Express backend
 * with role-based JWT bearer authentication, asserting:
 * - Student summary, history, topics, counts
 * - Mentor overview, mentor cohort topics, mentees list, mentee detail
 * - Admin overview, admin cohort trends, institution-wide topics
 * - Active mentee isolation (unassigned mentee returns 403 Forbidden)
 * - Cross-role access denial (student calling mentor route -> 403, mentor calling admin route -> 403)
 */

import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import { createClient } from '@supabase/supabase-js';
import app from '../server/src/index.js';

const rawUrl = process.env.SUPABASE_URL || '';
const cleanUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!cleanUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(cleanUrl, serviceKey);

async function run() {
  console.log('\n============================================================');
  console.log('MANUAL API VERIFICATION: PHASE 4A ANALYTICS ENDPOINTS');
  console.log('============================================================\n');

  // Start Express on test port
  const PORT = 5005;
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  const baseUrl = `http://localhost:${PORT}`;

  try {
    // 1. Resolve authentic test users from database
    const { data: activeAssgn } = await supabase
      .from('mentor_assignments')
      .select('mentor_id, student_id')
      .eq('is_active', true)
      .limit(1);

    const testMentorId = activeAssgn?.[0]?.mentor_id;
    const testStudentId = activeAssgn?.[0]?.student_id;

    const { data: adminProfiles } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('role', 'admin')
      .limit(1);

    const { data: studentProfiles } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('id', testStudentId || '')
      .limit(1);

    const { data: mentorProfiles } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('id', testMentorId || '')
      .limit(1);

    const studentUser = studentProfiles?.[0];
    const mentorUser = mentorProfiles?.[0];
    const adminUser = adminProfiles?.[0];

    if (!studentUser || !mentorUser || !adminUser) {
      console.error('Could not find student, mentor, and admin profiles in database.');
      server.close();
      return;
    }

    console.log(`Identified test profiles:`);
    console.log(`  Student: ${studentUser.email} (${studentUser.id})`);
    console.log(`  Mentor:  ${mentorUser.email} (${mentorUser.id})`);
    console.log(`  Admin:   ${adminUser.email} (${adminUser.id})\n`);

    // Generate authenticated test session tokens via Admin API
    // (generates short-lived tokens without logging or exposing credentials)
    const { data: studentLink } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: studentUser.email,
    });
    const { data: mentorLink } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: mentorUser.email,
    });
    const { data: adminLink } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: adminUser.email,
    });

    const studentToken = studentLink?.properties?.hashed_token
      ? (await supabase.auth.verifyOtp({ token_hash: studentLink.properties.hashed_token, type: 'magiclink' })).data.session?.access_token
      : null;

    const mentorToken = mentorLink?.properties?.hashed_token
      ? (await supabase.auth.verifyOtp({ token_hash: mentorLink.properties.hashed_token, type: 'magiclink' })).data.session?.access_token
      : null;

    const adminToken = adminLink?.properties?.hashed_token
      ? (await supabase.auth.verifyOtp({ token_hash: adminLink.properties.hashed_token, type: 'magiclink' })).data.session?.access_token
      : null;

    if (!studentToken || !mentorToken || !adminToken) {
      console.error('Failed to generate test session tokens for verification.');
      server.close();
      return;
    }

    let passCount = 0;
    let failCount = 0;

    async function checkEndpoint(
      title: string,
      method: string,
      path: string,
      token: string,
      expectedStatus: number,
      validator?: (data: any) => boolean
    ) {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const isStatusOk = res.status === expectedStatus;
      let body: any = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }

      const isDataOk = validator ? validator(body) : true;

      if (isStatusOk && isDataOk) {
        console.log(`[PASS] [${expectedStatus}] ${title} (${path})`);
        passCount++;
      } else {
        console.error(`[FAIL] [Expected ${expectedStatus}, Got ${res.status}] ${title} (${path})`);
        if (!isDataOk) console.error('       Data validation check failed:', body);
        failCount++;
      }
    }

    console.log('>>> 1. STUDENT ANALYTICS FLOW <<<');
    await checkEndpoint('Student Summary', 'GET', '/api/analytics/student/summary', studentToken, 200, (b) => !!b?.summary && typeof b?.summary?.totalAssigned === 'number');
    await checkEndpoint('Student History (Paginated)', 'GET', '/api/analytics/student/history?page=1&limit=5', studentToken, 200, (b) => Array.isArray(b?.items));
    await checkEndpoint('Student Topics', 'GET', '/api/analytics/student/topics', studentToken, 200, (b) => Array.isArray(b?.topics));
    await checkEndpoint('Student Counts', 'GET', '/api/analytics/student/counts', studentToken, 200, (b) => !!b?.counts && typeof b?.counts?.totalAssigned === 'number');

    console.log('\n>>> 2. MENTOR ANALYTICS FLOW <<<');
    await checkEndpoint('Mentor Dashboard Overview', 'GET', '/api/analytics/mentor/overview', mentorToken, 200, (b) => !!b?.overview && typeof b?.overview?.activeMenteesCount === 'number');
    await checkEndpoint('Mentor Cohort Topics', 'GET', '/api/analytics/mentor/topics', mentorToken, 200, (b) => Array.isArray(b?.topics));
    await checkEndpoint('Mentor Active Mentees List', 'GET', '/api/analytics/mentor/mentees', mentorToken, 200, (b) => Array.isArray(b?.mentees));
    await checkEndpoint('Mentor View Assigned Mentee', 'GET', `/api/analytics/mentor/mentees/${studentUser.id}`, mentorToken, 200, (b) => !!b?.summary && b?.summary?.studentId === studentUser.id);

    console.log('\n>>> 3. ADMIN ANALYTICS FLOW <<<');
    await checkEndpoint('Admin Institution Overview', 'GET', '/api/analytics/admin/overview', adminToken, 200, (b) => !!b?.overview && typeof b?.overview?.totalActiveStudents === 'number');
    await checkEndpoint('Admin Cohort Trends', 'GET', '/api/analytics/admin/cohorts', adminToken, 200, (b) => Array.isArray(b?.cohorts));
    await checkEndpoint('Admin Institution-Wide Topics', 'GET', '/api/analytics/admin/topics', adminToken, 200, (b) => Array.isArray(b?.topics));

    console.log('\n>>> 4. SECURITY & ISOLATION ENFORCEMENT <<<');
    const fakeUnassignedId = '00000000-0000-0000-0000-000000000001';
    await checkEndpoint('Mentor Accessing Unassigned Student Blocked', 'GET', `/api/analytics/mentor/mentees/${fakeUnassignedId}`, mentorToken, 403);
    await checkEndpoint('Student Accessing Mentor Overview Blocked', 'GET', '/api/analytics/mentor/overview', studentToken, 403);
    await checkEndpoint('Mentor Accessing Admin Topics Blocked', 'GET', '/api/analytics/admin/topics', mentorToken, 403);

    console.log('\n============================================================');
    console.log(`MANUAL API VERIFICATION RESULTS: ${passCount} / ${passCount + failCount} PASSED`);
    console.log('============================================================\n');

    server.close();
    process.exit(failCount === 0 ? 0 : 1);
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});

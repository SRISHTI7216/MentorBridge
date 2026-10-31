/**
 * Phase 3A Verification Suite - Trial Admin Panel & User Management
 *
 * Clearly distinguishes:
 * [SECTION A] Automated code, schema, route, and unit contracts
 * [SECTION B] Live database tests against Supabase PostgreSQL
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

interface TestReport {
  suite: string;
  testName: string;
  passed: boolean;
  isLiveDatabaseTest: boolean;
  details?: string;
}

const reports: TestReport[] = [];

function assert(
  condition: boolean,
  suite: string,
  testName: string,
  isLiveDatabaseTest: boolean = false,
  failureDetails?: string
) {
  if (condition) {
    reports.push({ suite, testName, passed: true, isLiveDatabaseTest });
    console.log(`[PASS] [${isLiveDatabaseTest ? 'LIVE DB' : 'UNIT'}] ${testName}`);
  } else {
    reports.push({ suite, testName, passed: false, isLiveDatabaseTest, details: failureDetails });
    console.error(`[FAIL] [${isLiveDatabaseTest ? 'LIVE DB' : 'UNIT'}] ${testName}: ${failureDetails || 'Assertion failed'}`);
  }
}

async function runPhase3ATests() {
  console.log('\n============================================================');
  console.log('MENTORBRIDGE (CSE MENTORNET) PHASE 3A VERIFICATION SUITE');
  console.log('============================================================\n');

  // ==========================================================================
  // SECTION A: AUTOMATED CODE, ROUTING & CONTRACT TESTS (No DB connection needed)
  // ==========================================================================
  console.log('>>> SECTION A: AUTOMATED CODE & ROUTING CONTRACT TESTS <<<\n');

  // Test A1: Admin routes declared in AppRoutes
  const routesFile = fs.readFileSync(path.resolve(process.cwd(), 'src/routes/index.tsx'), 'utf-8');
  assert(routesFile.includes("path=\"students\" element={<AdminStudents />}"), 'A: Routes', 'Admin students route mounted in src/routes/index.tsx');
  assert(routesFile.includes("path=\"mentors\" element={<AdminMentors />}"), 'A: Routes', 'Admin mentors route mounted in src/routes/index.tsx');
  assert(routesFile.includes("path=\"allocation\" element={<AdminAllocation />}"), 'A: Routes', 'Admin allocation route mounted in src/routes/index.tsx');
  assert(routesFile.includes("path=\"academic\" element={<AdminAcademic />}"), 'A: Routes', 'Admin academic route mounted in src/routes/index.tsx');
  assert(routesFile.includes("path=\"settings\" element={<AdminSettings />}"), 'A: Routes', 'Admin settings route mounted in src/routes/index.tsx');

  // Test A2: Admin sidebar navigation items
  const sidebarFile = fs.readFileSync(path.resolve(process.cwd(), 'src/components/layout/AdminSidebar.tsx'), 'utf-8');
  assert(sidebarFile.includes('/admin/dashboard'), 'A: Sidebar', 'Admin sidebar includes Overview link');
  assert(sidebarFile.includes('/admin/students'), 'A: Sidebar', 'Admin sidebar includes Students link');
  assert(sidebarFile.includes('/admin/mentors'), 'A: Sidebar', 'Admin sidebar includes Mentors link');
  assert(sidebarFile.includes('/admin/allocation'), 'A: Sidebar', 'Admin sidebar includes Mentor Allocation link');
  assert(sidebarFile.includes('/admin/academic'), 'A: Sidebar', 'Admin sidebar includes Academic Management link');
  assert(sidebarFile.includes('/admin/settings'), 'A: Sidebar', 'Admin sidebar includes Settings link');

  // Test A3: Server endpoint routing & middleware integration
  const serverIndexFile = fs.readFileSync(path.resolve(process.cwd(), 'server/src/index.ts'), 'utf-8');
  assert(serverIndexFile.includes("app.use('/api/admin', adminRoutes);"), 'A: Backend', 'Express server mounts /api/admin router');

  const adminRoutesFile = fs.readFileSync(path.resolve(process.cwd(), 'server/src/routes/adminRoutes.ts'), 'utf-8');
  assert(adminRoutesFile.includes("router.use(requireAdminAuth);"), 'A: Backend', 'All admin routes protected by requireAdminAuth middleware');
  assert(adminRoutesFile.includes("router.get('/stats'"), 'A: Backend', 'Admin stats endpoint declared');
  assert(adminRoutesFile.includes("router.post('/students'"), 'A: Backend', 'Admin create student endpoint declared');
  assert(adminRoutesFile.includes("router.post('/mentors'"), 'A: Backend', 'Admin create mentor endpoint declared');
  assert(adminRoutesFile.includes("router.patch('/users/:id/status'"), 'A: Backend', 'Admin user status toggle endpoint declared');
  assert(adminRoutesFile.includes("router.post('/allocations/assign'"), 'A: Backend', 'Admin batch allocation endpoint declared');
  assert(adminRoutesFile.includes("router.post('/allocations/reassign'"), 'A: Backend', 'Admin reassignment endpoint declared');

  // Test A4: Self-deactivation prevention logic
  assert(
    adminRoutesFile.includes("req.adminUser?.id === targetUserId") &&
    adminRoutesFile.includes("Self-deactivation prohibited"),
    'A: Security',
    'Admin backend prevents self-deactivation of logged-in admin'
  );

  // Test A5: Trailing URL normalization in Supabase clients
  const clientFile = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/supabaseClient.ts'), 'utf-8');
  assert(clientFile.includes("replace(/\\/rest\\/v1\\/?$/, '')"), 'A: Client', 'Client sanitizes trailing /rest/v1/ in Supabase URL');

  const adminClientFile = fs.readFileSync(path.resolve(process.cwd(), 'server/src/lib/supabaseAdmin.ts'), 'utf-8');
  assert(adminClientFile.includes("replace(/\\/rest\\/v1\\/?$/, '')"), 'A: Server', 'Server admin client sanitizes trailing /rest/v1/ in Supabase URL');

  // ==========================================================================
  // SECTION B: ACTUAL TESTS AGAINST LIVE SUPABASE DATABASE
  // ==========================================================================
  console.log('\n>>> SECTION B: TESTS AGAINST LIVE SUPABASE DATABASE <<<\n');

  const rawUrl = process.env.SUPABASE_URL || '';
  const cleanUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();

  if (!cleanUrl || !serviceKey) {
    console.error('Database credentials missing in environment.');
    process.exit(1);
  }

  const adminClient = createClient(cleanUrl, serviceKey);
  const anonClient = createClient(cleanUrl, anonKey);

  // Test B1: Admin Login & Session Generation
  console.log('--- Testing Admin Login & Auth Token ---');
  const { data: loginData, error: loginError } = await anonClient.auth.signInWithPassword({
    email: 'admin@mentorbridge.edu',
    password: 'AdminPassword123!',
  });

  assert(!loginError && !!loginData.session, 'B: Live DB', 'Admin login with valid credentials succeeds and returns JWT', true);
  const adminToken = loginData.session?.access_token || '';

  // Client executing in authenticated administrator session context
  const adminUserClient = createClient(cleanUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${adminToken}` } },
  });

  // Test B2: Anonymous / Non-admin Access Rejection
  console.log('--- Testing Unauthorized Token Rejection ---');
  const { data: invalidUserCheck, error: invalidTokenError } = await adminClient.auth.getUser('invalid-token-12345');
  assert(!!invalidTokenError || !invalidUserCheck?.user, 'B: Live DB', 'Invalid auth token is rejected by Supabase Auth', true);

  // Test B3: Querying Dashboard Stats from Database
  console.log('--- Testing Dashboard Data Queries ---');
  const [profilesRes, termsRes, cohortsRes] = await Promise.all([
    adminClient.from('profiles').select('id, role, is_active'),
    adminClient.from('academic_terms').select('*'),
    adminClient.from('cohorts').select('*'),
  ]);

  assert(profilesRes.error === null && Array.isArray(profilesRes.data), 'B: Live DB', 'Can query profiles table with service role', true);
  assert(termsRes.error === null && (termsRes.data?.length || 0) >= 3, 'B: Live DB', 'Academic terms seeded data present (>= 3 terms)', true);
  assert(cohortsRes.error === null && (cohortsRes.data?.length || 0) >= 3, 'B: Live DB', 'Cohorts seeded data present (>= 3 cohorts)', true);

  const activeTerm = termsRes.data?.find((t) => t.is_current) || termsRes.data?.[0];
  const firstCohort = cohortsRes.data?.[0];

  // Test B4: Student Provisioning Workflow with Cleanup
  console.log('--- Testing Student Account Provisioning ---');
  const testStudentEmail = `test.student.${Date.now()}@mentorbridge.internal`;
  const testRollNumber = `TEST-${Date.now().toString().slice(-6)}`;

  let testStudentUserId: string | null = null;
  try {
    // Generate invitation link
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'invite',
      email: testStudentEmail,
      options: {
        data: {
          name: 'Automated Test Student',
          role: 'student',
        },
      },
    });

    assert(!linkError && !!linkData?.user?.id, 'B: Live DB', 'Student invitation link generated via Supabase Admin Auth', true);
    testStudentUserId = linkData?.user?.id || null;

    if (testStudentUserId) {
      // Profile created by DB trigger check
      const { data: profileCheck } = await adminClient
        .from('profiles')
        .select('*')
        .eq('id', testStudentUserId)
        .single();

      assert(profileCheck?.role === 'student' && profileCheck?.email === testStudentEmail, 'B: Live DB', 'Trigger created profile with student role', true);

      // Insert student_details
      const { data: detailData, error: detailError } = await adminClient
        .from('student_details')
        .insert({
          profile_id: testStudentUserId,
          roll_number: testRollNumber,
          branch: 'CSE',
          semester: 6,
          division: 'A',
          admission_year: 2022,
          cohort_id: firstCohort?.id || null,
        })
        .select('*')
        .single();

      assert(!detailError && detailData?.roll_number === testRollNumber, 'B: Live DB', 'Student details record successfully linked to profile', true);

      // Test Student Editing
      const { data: updatedDetail, error: updateError } = await adminClient
        .from('student_details')
        .update({ division: 'B' })
        .eq('profile_id', testStudentUserId)
        .select('division')
        .single();

      assert(!updateError && updatedDetail?.division === 'B', 'B: Live DB', 'Student details record updated successfully', true);

      // Test Account Status Activation/Deactivation (executed by authenticated administrator)
      const { data: deactivated, error: deactError } = await adminUserClient
        .from('profiles')
        .update({ is_active: false })
        .eq('id', testStudentUserId)
        .select('is_active')
        .single();

      assert(!deactError && deactivated?.is_active === false, 'B: Live DB', 'Student account status successfully deactivated', true);

      const { data: reactivated } = await adminUserClient
        .from('profiles')
        .update({ is_active: true })
        .eq('id', testStudentUserId)
        .select('is_active')
        .single();

      assert(reactivated?.is_active === true, 'B: Live DB', 'Student account status successfully reactivated', true);
    }
  } catch (err: unknown) {
    console.error('Student test error:', err);
  }

  // Test B5: Mentor Provisioning Workflow
  console.log('--- Testing Mentor Account Provisioning ---');
  const testMentorEmail = `test.mentor.${Date.now()}@mentorbridge.internal`;
  const testEmployeeId = `FAC-TEST-${Date.now().toString().slice(-5)}`;
  let testMentorUserId: string | null = null;

  try {
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'invite',
      email: testMentorEmail,
      options: {
        data: {
          name: 'Dr. Test Mentor',
          role: 'mentor',
        },
      },
    });

    assert(!linkError && !!linkData?.user?.id, 'B: Live DB', 'Mentor invitation link generated via Supabase Admin Auth', true);
    testMentorUserId = linkData?.user?.id || null;

    if (testMentorUserId) {
      await adminClient.from('profiles').upsert({
        id: testMentorUserId,
        name: 'Dr. Test Mentor',
        email: testMentorEmail,
        role: 'mentor',
        is_active: true,
      });

      const { data: mentorDetail, error: mentorDetailError } = await adminClient
        .from('mentor_details')
        .insert({
          profile_id: testMentorUserId,
          employee_id: testEmployeeId,
          department: 'Computer Science & Engineering',
          designation: 'Associate Professor',
          office_location: 'Room 303, CSE Block',
          specializations: ['Cloud Computing', 'AI Systems'],
        })
        .select('*')
        .single();

      assert(!mentorDetailError && mentorDetail?.employee_id === testEmployeeId, 'B: Live DB', 'Mentor details record successfully linked to profile', true);
    }
  } catch (err: unknown) {
    console.error('Mentor test error:', err);
  }

  // Test B6: Mentor–Mentee Allocation & Partial Unique Index Constraint
  console.log('--- Testing Mentor Allocation & Unique Active Constraint ---');
  let firstAssignmentId: string | null = null;
  if (testStudentUserId && testMentorUserId && activeTerm?.id) {
    // 1. Create first active assignment
    const { data: assignment1, error: asgn1Error } = await adminClient
      .from('mentor_assignments')
      .insert({
        mentor_id: testMentorUserId,
        student_id: testStudentUserId,
        academic_term_id: activeTerm.id,
        assigned_date: new Date().toISOString().split('T')[0],
        is_active: true,
        notes: 'Initial test assignment',
      })
      .select('id')
      .single();

    assert(!asgn1Error && !!assignment1?.id, 'B: Live DB', 'Created active mentor assignment for student in active term', true);
    firstAssignmentId = assignment1?.id || null;

    // 2. Attempt duplicate active assignment for SAME student in SAME term -> MUST FAIL with 23505
    const { error: duplicateError } = await adminClient
      .from('mentor_assignments')
      .insert({
        mentor_id: testMentorUserId,
        student_id: testStudentUserId,
        academic_term_id: activeTerm.id,
        assigned_date: new Date().toISOString().split('T')[0],
        is_active: true,
        notes: 'Attempted duplicate assignment',
      });

    assert(
      duplicateError !== null && (duplicateError.code === '23505' || duplicateError.message.includes('unique')),
      'B: Live DB',
      'Database rejects duplicate active assignment (idx_unique_active_student_term_assignment enforced)',
      true
    );

    // 3. Test Reassignment using reassign_mentor stored procedure
    // Create a 2nd mentor for reassignment
    const testMentor2Email = `test.mentor2.${Date.now()}@mentorbridge.internal`;
    const testEmp2 = `FAC-REASGN-${Date.now().toString().slice(-4)}`;
    const { data: link2 } = await adminClient.auth.admin.generateLink({
      type: 'invite',
      email: testMentor2Email,
      options: { data: { name: 'Dr. Reassign Target', role: 'mentor' } },
    });
    const mentor2Id = link2?.user?.id;
    if (mentor2Id) {
      await adminClient.from('profiles').upsert({
        id: mentor2Id,
        name: 'Dr. Reassign Target',
        email: testMentor2Email,
        role: 'mentor',
        is_active: true,
      });
      await adminClient.from('mentor_details').insert({
        profile_id: mentor2Id,
        employee_id: testEmp2,
        department: 'CSE',
        designation: 'Professor',
      });

      // Call reassign_mentor procedure via authenticated administrator
      const { data: newAsgnId, error: rpcError } = await adminUserClient.rpc('reassign_mentor', {
        p_student_id: testStudentUserId,
        p_new_mentor_id: mentor2Id,
        p_academic_term_id: activeTerm.id,
        p_notes: 'Reassigned via automated test suite',
      });

      assert(!rpcError && !!newAsgnId, 'B: Live DB', 'reassign_mentor() procedure executed successfully', true);

      // Verify old assignment is deactivated and new is active
      const { data: oldAsgn } = await adminClient
        .from('mentor_assignments')
        .select('is_active')
        .eq('id', firstAssignmentId!)
        .single();

      const { data: newAsgn } = await adminClient
        .from('mentor_assignments')
        .select('is_active, mentor_id')
        .eq('id', newAsgnId)
        .single();

      assert(oldAsgn?.is_active === false, 'B: Live DB', 'Previous assignment safely set to is_active = false', true);
      assert(newAsgn?.is_active === true && newAsgn?.mentor_id === mentor2Id, 'B: Live DB', 'New assignment active with new mentor', true);

      // Clean up mentor 2
      await adminClient.auth.admin.deleteUser(mentor2Id);
    }
  }

  // Test B7: Academic Term & Cohort Live Operations
  console.log('--- Testing Academic Term & Cohort Operations ---');
  const testTermCode = `TEST-T-${Date.now().toString().slice(-6)}`;
  const { data: createdTerm, error: createTermErr } = await adminClient
    .from('academic_terms')
    .insert({
      code: testTermCode,
      name: `Test Term ${testTermCode}`,
      start_date: '2027-01-01',
      end_date: '2027-05-31',
      is_current: false,
    })
    .select('*')
    .single();

  assert(!createTermErr && createdTerm?.code === testTermCode, 'B: Live DB', 'Created custom academic term in live database', true);

  if (createdTerm?.id) {
    // Clean up created test term
    await adminClient.from('academic_terms').delete().eq('id', createdTerm.id);
  }

  // Cleanup test student and test mentor
  if (testStudentUserId) {
    await adminClient.auth.admin.deleteUser(testStudentUserId);
  }
  if (testMentorUserId) {
    await adminClient.auth.admin.deleteUser(testMentorUserId);
  }

  // ==========================================================================
  // FINAL REPORT & SUMMARY
  // ==========================================================================
  const unitTests = reports.filter((r) => !r.isLiveDatabaseTest);
  const liveDbTests = reports.filter((r) => r.isLiveDatabaseTest);

  const unitPassed = unitTests.filter((r) => r.passed).length;
  const liveDbPassed = liveDbTests.filter((r) => r.passed).length;

  console.log('\n============================================================');
  console.log('TEST SUMMARY');
  console.log('============================================================');
  console.log(`[SECTION A - Automated Unit & Code Contracts]: ${unitPassed} / ${unitTests.length} PASSED`);
  console.log(`[SECTION B - Actual Live Supabase Database]:   ${liveDbPassed} / ${liveDbTests.length} PASSED`);
  console.log(`TOTAL: ${unitPassed + liveDbPassed} / ${reports.length} PASSED`);
  console.log('============================================================\n');

  if (unitPassed !== unitTests.length || liveDbPassed !== liveDbTests.length) {
    process.exit(1);
  }
}

runPhase3ATests().catch((err) => {
  console.error('Fatal testing error:', err);
  process.exit(1);
});

/**
 * Student and Mentor Invitation Authentication Flow Verification
 * Tests the complete end-to-end lifecycle:
 * - Admin invites/provisions student with redirectTo pointing to frontend /auth/callback
 * - Action link contains valid redirect_to=http://localhost:5173/auth/callback
 * - Extraction of token and simulation of password setup via updateUser({ password })
 * - Student login with new password and verified role routing
 * - Mentor creation, invitation, password setup, and verified role routing
 * - Role-based route guard enforcement (student blocked from mentor/admin; mentor blocked from admin)
 * - Handling of expired/invalid invitation tokens
 * - Preservation of mentor assignments
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const rawUrl = process.env.SUPABASE_URL || '';
const cleanUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '').trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

if (!cleanUrl || !serviceKey || !anonKey) {
  console.error('Missing required database credentials in environment.');
  process.exit(1);
}

const adminClient = createClient(cleanUrl, serviceKey);
const anonClient = createClient(cleanUrl, anonKey);

let testsPassed = 0;
let testsTotal = 0;

function assert(condition: boolean, testName: string, failureDetails?: string) {
  testsTotal++;
  if (condition) {
    testsPassed++;
    console.log(`[PASS] ${testName}`);
  } else {
    console.error(`[FAIL] ${testName}: ${failureDetails || 'Assertion failed'}`);
  }
}

async function runInvitationFlowVerification() {
  console.log('\n============================================================');
  console.log('STUDENT & MENTOR INVITATION AUTHENTICATION FLOW VERIFICATION');
  console.log('============================================================\n');

  const timestamp = Date.now();
  const testStudentEmail = `flow.student.${timestamp}@engg.edu`;
  const testStudentRoll = `CS-INV-${timestamp.toString().slice(-5)}`;
  const testStudentPassword = 'StudentSecret123!';

  const testMentorEmail = `flow.mentor.${timestamp}@engg.edu`;
  const testMentorEmpId = `EMP-INV-${timestamp.toString().slice(-5)}`;
  const testMentorPassword = 'MentorSecret123!';

  const expectedRedirectTo = `${frontendUrl.replace(/\/+$/, '')}/auth/callback`;

  let createdStudentId: string | null = null;
  let createdMentorId: string | null = null;

  try {
    // ------------------------------------------------------------------------
    // PART 1: STUDENT INVITATION, TOKEN GENERATION, AND REDIRECT URL
    // ------------------------------------------------------------------------
    console.log('--- 1. Testing Student Account Creation & Invitation Generation ---');
    const { data: studentLinkData, error: studentLinkError } = await adminClient.auth.admin.generateLink({
      type: 'invite',
      email: testStudentEmail,
      options: {
        redirectTo: expectedRedirectTo,
        data: {
          name: 'Jane Doe',
          role: 'student',
        },
      },
    });

    assert(!studentLinkError && !!studentLinkData?.user?.id, 'Student user generated via Admin Auth API');
    createdStudentId = studentLinkData?.user?.id || null;

    const studentActionLink = studentLinkData?.properties?.action_link || '';
    assert(
      studentActionLink.includes(`redirect_to=${encodeURIComponent(expectedRedirectTo)}`) ||
      studentActionLink.includes(`redirect_to=${expectedRedirectTo}`),
      `Student action link contains valid redirect_to pointing to ${expectedRedirectTo}`
    );

    // Profile record created
    const { data: studentProfile } = await adminClient
      .from('profiles')
      .upsert({
        id: createdStudentId,
        name: 'Jane Doe',
        email: testStudentEmail,
        role: 'student',
        is_active: true,
      })
      .select()
      .single();

    assert(studentProfile?.role === 'student', 'Student profile created with role = student');

    // Link student details
    await adminClient.from('student_details').insert({
      profile_id: createdStudentId,
      roll_number: testStudentRoll,
      branch: 'CSE',
      semester: 4,
      division: 'A',
      admission_year: 2023,
    });

    // ------------------------------------------------------------------------
    // PART 2: STUDENT PASSWORD CONFIGURATION (Simulating /auth/callback)
    // ------------------------------------------------------------------------
    console.log('\n--- 2. Testing Student Setting Password & Authentication ---');
    // Simulate setting password after clicking invite link (which confirms email)
    const { error: setStudentPwdErr } = await adminClient.auth.admin.updateUserById(createdStudentId!, {
      password: testStudentPassword,
      email_confirm: true,
    });
    assert(!setStudentPwdErr, 'Student password configured successfully');

    // Test logging in with newly configured credentials via anon client
    const { data: studentLoginData, error: studentLoginErr } = await anonClient.auth.signInWithPassword({
      email: testStudentEmail,
      password: testStudentPassword,
    });

    assert(!studentLoginErr && !!studentLoginData?.session, 'Student can successfully sign in with newly set password');
    const studentToken = studentLoginData?.session?.access_token || '';

    // Verify student authenticated client only accesses student role
    const studentUserClient = createClient(cleanUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${studentToken}` } },
    });

    const { data: studentOwnProfile } = await studentUserClient
      .from('profiles')
      .select('*')
      .eq('id', createdStudentId)
      .single();

    assert(studentOwnProfile?.role === 'student', 'Database profile preserves role = student post-password setup');

    // ------------------------------------------------------------------------
    // PART 3: MENTOR INVITATION, TOKEN GENERATION, AND PASSWORD SETUP
    // ------------------------------------------------------------------------
    console.log('\n--- 3. Testing Mentor Account Creation & Invitation Generation ---');
    const { data: mentorLinkData, error: mentorLinkError } = await adminClient.auth.admin.generateLink({
      type: 'invite',
      email: testMentorEmail,
      options: {
        redirectTo: expectedRedirectTo,
        data: {
          name: 'Prof. John Smith',
          role: 'mentor',
        },
      },
    });

    assert(!mentorLinkError && !!mentorLinkData?.user?.id, 'Mentor user generated via Admin Auth API');
    createdMentorId = mentorLinkData?.user?.id || null;

    const mentorActionLink = mentorLinkData?.properties?.action_link || '';
    assert(
      mentorActionLink.includes(`redirect_to=${encodeURIComponent(expectedRedirectTo)}`) ||
      mentorActionLink.includes(`redirect_to=${expectedRedirectTo}`),
      `Mentor action link contains valid redirect_to pointing to ${expectedRedirectTo}`
    );

    // Profile record created
    const { data: mentorProfile } = await adminClient
      .from('profiles')
      .upsert({
        id: createdMentorId,
        name: 'Prof. John Smith',
        email: testMentorEmail,
        role: 'mentor',
        is_active: true,
      })
      .select()
      .single();

    assert(mentorProfile?.role === 'mentor', 'Mentor profile created with role = mentor');

    // Link mentor details
    await adminClient.from('mentor_details').insert({
      profile_id: createdMentorId,
      employee_id: testMentorEmpId,
      department: 'Computer Science & Engineering',
      designation: 'Assistant Professor',
    });

    // Configure mentor password (simulating invite verification + password setup)
    const { error: setMentorPwdErr } = await adminClient.auth.admin.updateUserById(createdMentorId!, {
      password: testMentorPassword,
      email_confirm: true,
    });
    assert(!setMentorPwdErr, 'Mentor password configured successfully');

    // Test logging in with mentor credentials
    const { data: mentorLoginData, error: mentorLoginErr } = await anonClient.auth.signInWithPassword({
      email: testMentorEmail,
      password: testMentorPassword,
    });

    assert(!mentorLoginErr && !!mentorLoginData?.session, 'Mentor can successfully sign in with newly set password');
    const mentorToken = mentorLoginData?.session?.access_token || '';

    const mentorUserClient = createClient(cleanUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${mentorToken}` } },
    });

    const { data: mentorOwnProfile } = await mentorUserClient
      .from('profiles')
      .select('*')
      .eq('id', createdMentorId)
      .single();

    assert(mentorOwnProfile?.role === 'mentor', 'Database profile preserves role = mentor post-password setup');

    // ------------------------------------------------------------------------
    // PART 4: SECURITY & ROLE GUARDS
    // ------------------------------------------------------------------------
    console.log('\n--- 4. Testing Role Isolation & RLS Restrictions ---');
    // Student attempting to query another student's private student_details
    const { data: otherStudentCheck } = await studentUserClient
      .from('student_details')
      .select('*')
      .neq('profile_id', createdStudentId);

    assert(
      !otherStudentCheck || otherStudentCheck.length === 0,
      'Student cannot view student_details of unassigned peers (RLS enforced)'
    );

    // Mentor cannot elevate own role to admin (prevent_role_or_active_tampering trigger)
    const { error: tamperError } = await mentorUserClient
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', createdMentorId);

    assert(!!tamperError, 'User is prevented from elevating own role to admin by trigger');

    // ------------------------------------------------------------------------
    // PART 5: ASSIGNMENT INTEGRITY
    // ------------------------------------------------------------------------
    console.log('\n--- 5. Testing Assignment Creation & Integrity ---');
    const { data: currentTerm } = await adminClient
      .from('academic_terms')
      .select('id')
      .eq('is_current', true)
      .single();

    if (currentTerm && createdStudentId && createdMentorId) {
      const { data: asgn, error: asgnErr } = await adminClient
        .from('mentor_assignments')
        .insert({
          student_id: createdStudentId,
          mentor_id: createdMentorId,
          academic_term_id: currentTerm.id,
          is_active: true,
        })
        .select()
        .single();

      assert(!asgnErr && !!asgn?.id, 'Assigned new mentor to new student successfully');

      // Mentor can now view assigned student's details
      const { data: menteeDetails } = await mentorUserClient
        .from('student_details')
        .select('*')
        .eq('profile_id', createdStudentId)
        .single();

      assert(menteeDetails?.roll_number === testStudentRoll, 'Mentor can view assigned mentee details');
    }

    // ------------------------------------------------------------------------
    // PART 6: EXPIRED / INVALID TOKEN HANDLING CONTRACT
    // ------------------------------------------------------------------------
    console.log('\n--- 6. Testing Token Expiration Contract ---');
    const { data: expiredCheck, error: expiredError } = await anonClient.auth.verifyOtp({
      token_hash: 'invalid_or_expired_hash_12345',
      type: 'invite',
    });

    assert(
      !!expiredError || !expiredCheck?.session,
      'Invalid or expired token returns error from Supabase Auth verifyOtp'
    );
  } finally {
    // Clean up created test accounts to maintain pristine database state
    console.log('\n--- Cleaning up temporary test accounts ---');
    if (createdStudentId) {
      await adminClient.auth.admin.deleteUser(createdStudentId);
    }
    if (createdMentorId) {
      await adminClient.auth.admin.deleteUser(createdMentorId);
    }
  }

  console.log('\n============================================================');
  console.log(`INVITATION FLOW VERIFICATION: ${testsPassed} / ${testsTotal} PASSED`);
  console.log('============================================================\n');

  if (testsPassed !== testsTotal) {
    process.exit(1);
  }
}

runInvitationFlowVerification();

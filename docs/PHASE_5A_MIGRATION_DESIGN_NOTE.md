# MentorBridge — Phase 5A Step 1: Database Migration Design Note (Final Hardened & Verified)

## 1. Canonical Migration Directory & File Parity
- **Canonical Migration Directory**: `supabase/migrations/`
  - Canonical file: `supabase/migrations/20261118_000009_create_learning_module_schema.sql`
  - Mirrored file: `server/supabase/migrations/20261118_000009_create_learning_module_schema.sql`
  - **Verified SHA-256 Hash**: `CC6ABD498CF449BC5AADECEDA24762EB08929A8DF65992B353891CC077FF3B44`
  - **Parity Status**: 100% byte-for-byte identical across both paths.
- **Migration Status**: **DRAFT ONLY — PENDING USER APPROVAL — NOT APPLIED TO DATABASE**.

---

## 2. Final Targeted SQL Corrections Summary

### 2.1 Assignment Revocation Audit Integrity
- During mentor revocation, `revoked_by` is unconditionally forced to `auth.uid()`, and `revoked_at` is unconditionally forced to `now()`. Caller-supplied identities and timestamps are discarded.
- Mandatory non-empty `revocation_reason` is enforced.
- Revoked assignments are permanently immutable (`OLD.status = 'revoked' -> RAISE EXCEPTION`).
- Administrator/service-role workflows are preserved with explicit defaults (`COALESCE(NEW.revoked_at, now())`, `COALESCE(NEW.revoked_by, auth.uid())`).

### 2.2 Certificate Immutability
- Added `accredited_by` to the immutable field comparison check in `public.protect_certificate_integrity()`.
- Guaranteed that all displayed signed fields (`certificate_no`, `student_id`, `module_id`, `enrollment_id`, `grade`, `signature_algorithm`, `signature_version`, `canonical_payload`, `verifiable_hash`, `accredited_by`, `issued_at`, `issued_by`) remain strictly tamper-proof.
- Preserved administrator/service-role-only revocation authorization.

### 2.3 Term-Scoped Progress RLS
- Replaced all non-term-scoped mentor checks (`public.is_active_mentor_for_student(student_id)`) across `student_module_enrollments`, `lesson_completions`, and `certificate_credentials`.
- All three policies now require active mentor allocation in the module's exact academic term:
  `EXISTS (SELECT 1 FROM public.learning_modules lm WHERE lm.id = module_id AND public.is_active_mentor_for_student_in_term(student_id, lm.academic_term_id))`
- Preserved historical mentor access strictly where an actual original assignment (`ma.mentor_id = auth.uid()`) or issuance (`issued_by = auth.uid()`) establishes audit ownership.

### 2.4 Active Mentor Profile Validation
- Hardened `public.is_active_mentor_for_student_in_term()` to join `public.profiles p` and require `p.id = auth.uid()`, `p.role = 'mentor'`, and `p.is_active = true` in addition to active term allocation.

### 2.5 Clone Function Permissions
- Resolved the privilege mismatch: removed `service_role` from `clone_module_version()` grant, restricting execution strictly to `authenticated`.
- Added explicit check rejecting unidentified/anonymous callers (`auth.uid() IS NULL`).
- Used safe NULL-aware comparisons (`COALESCE`, `IS DISTINCT FROM`).

### 2.6 SECURITY DEFINER Hardening
- Standardized `SET search_path = pg_catalog, public, pg_temp;` across all stored and trigger functions.
- Retained `REVOKE EXECUTE ... FROM PUBLIC` on all functions.

### 2.7 Concurrency-Safe Institutional Enrollment
- Upgraded `public.enroll_in_institutional_module()` from check-then-insert to atomic upsert:
  `ON CONFLICT (module_id, student_id) DO UPDATE SET updated_at = public.student_module_enrollments.updated_at RETURNING id INTO v_enrollment_id;`
- Returns existing enrollment ID without duplicate key violations under concurrent requests.

---

## 3. Row Level Security & Privilege Matrix

| Table | SELECT | INSERT | UPDATE | DELETE |
| :--- | :--- | :--- | :--- | :--- |
| `learning_categories` | Authenticated, Service Role | Admin only | Admin only | Admin only |
| `learning_modules` | Admin, Author Mentor, Term Mentors, Assigned/Eligible Student (`can_access_learning_module`) | Admin, Author Mentor (drafts only) | Admin, Author Mentor (drafts or published -> archived) | Admin, Author Mentor (draft only) |
| `module_lessons` | Authenticated Module Viewers (`can_access_learning_module`) | Admin, Module Author (drafts only) | Admin, Module Author (drafts only) | Admin, Module Author (drafts only) |
| `learning_resources` | Authenticated Module Viewers (`can_access_learning_module`) | Admin, Module Author (drafts only) | Admin, Module Author (drafts only) | Admin, Module Author (drafts only) |
| `module_assignments` | Admin, Assigning Mentor, Assigned Student | Admin, Active Mentor in Term | Admin (limited), Assigning Mentor (revocation only) | Admin only (`ON DELETE RESTRICT`) |
| `student_module_enrollments` | Admin, Term Mentors, Assigning Mentor, Student (own) | Admin, Service Role (`enroll_in_institutional_module`) | Admin, Service Role only | Admin only |
| `lesson_completions` | Admin, Term Mentors, Assigning Mentor, Student (own) | Admin, Service Role only | Forbidden (Immutable ledger) | Forbidden (Immutable ledger) |
| `module_assessment_links` | Authenticated Module Viewers (`can_access_learning_module`) | Admin, Module Author (drafts only) | Admin, Module Author (drafts only) | Admin, Module Author (drafts only) |
| `certificate_credentials` | Admin, Term Mentors, Issuer Mentor, Student (own) | Admin, Service Role only | Admin, Service Role (revocation only; trigger-guarded) | Forbidden (`trg_protect_certificate_deletion`) |

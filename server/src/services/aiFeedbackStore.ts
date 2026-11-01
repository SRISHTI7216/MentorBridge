/**
 * AI Feedback Database Persistence Service
 * Phase 4A Step 5.2.1: Queue Reliability Hardening
 * 
 * Provides typed database access for public.ai_feedback_reports using supabaseAdmin:
 * - Supabase PostgreSQL is the sole, permanent source of truth (no in-memory maps).
 * - Enforces idempotency via database unique indexes:
 *     * Immediate: (student_id, attempt_id, feedback_type = 'immediate')
 *     * Weekly: (student_id, academic_term_id, period_start, period_end, feedback_type = 'weekly')
 * - Worker ownership & lease management:
 *     * Each worker has a unique worker_id.
 *     * Atomic claiming records locked_by and lease_expires_at.
 *     * Active workers can renew leases while valid; expired leases are safely reclaimed.
 *     * State saves enforce locked_by, valid lease, and matching input_snapshot_hash.
 * - Retry scheduling & head-of-line blocking prevention:
 *     * next_retry_at is persisted in PostgreSQL with bounded exponential backoff.
 *     * Database queries filter eligible records directly, preventing starvation.
 *     * Permanent errors set retry_count to maxRetries with null next_retry_at.
 * - Snapshot integrity:
 *     * Detects source data changes (hash mismatch) and resets status to pending.
 *     * Rejects attempts by stale workers to save obsolete results.
 */

import crypto from 'crypto';
import { supabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin.js';
import type { StructuredAiFeedback } from './openrouterService.js';

export type FeedbackType = 'immediate' | 'weekly';
export type FeedbackStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped_insufficient_data';

export interface AiFeedbackReport {
  id: string;
  studentId: string;
  feedbackType: FeedbackType;
  assessmentId?: string | null;
  attemptId?: string | null;
  academicTermId?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  status: FeedbackStatus;
  summary?: string | null;
  strengths: string[];
  weaknesses: string[];
  recommendedActions: string[];
  provider: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs?: number | null;
  inputSnapshotHash: string;
  errorMessage?: string | null;
  retryCount: number;
  lockedBy?: string | null;
  leaseExpiresAt?: string | null;
  nextRetryAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateImmediateReportParams {
  studentId: string;
  assessmentId: string;
  attemptId: string;
  inputSnapshotHash: string;
}

export interface CreateWeeklyReportParams {
  studentId: string;
  academicTermId: string;
  periodStart: string;
  periodEnd: string;
  inputSnapshotHash: string;
}

export interface SaveCompletedFeedbackParams {
  feedback: StructuredAiFeedback;
  actualModel: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
  workerId?: string;
  expectedSnapshotHash?: string;
}

export class AiFeedbackStore {
  private hardenedSchemaAvailable: boolean | null = null;

  private getDb() {
    if (!isSupabaseAdminConfigured() || !supabaseAdmin) {
      throw new Error('Supabase admin client is not configured.');
    }
    return supabaseAdmin;
  }

  /**
   * Checks whether the hardened schema columns (next_retry_at, locked_by, lease_expires_at)
   * exist in the live database. Caches the result to avoid redundant probing.
   */
  public async isHardenedSchemaAvailable(): Promise<boolean> {
    if (this.hardenedSchemaAvailable !== null) {
      return this.hardenedSchemaAvailable;
    }
    try {
      const db = this.getDb();
      const { error } = await db.from('ai_feedback_reports').select('next_retry_at').limit(1);
      if (error && error.code === '42703') {
        this.hardenedSchemaAvailable = false;
      } else {
        this.hardenedSchemaAvailable = true;
      }
    } catch {
      this.hardenedSchemaAvailable = false;
    }
    return this.hardenedSchemaAvailable;
  }

  /**
   * Testing hook: allows explicitly mocking or resetting the hardened schema availability
   */
  public setHardenedSchemaOverride(supported: boolean | null): void {
    this.hardenedSchemaAvailable = supported;
  }

  /**
   * Maps a raw PostgreSQL ai_feedback_reports row to a typed AiFeedbackReport
   */
  public mapRow(row: any): AiFeedbackReport {
    return {
      id: row.id,
      studentId: row.student_id,
      feedbackType: row.feedback_type,
      assessmentId: row.assessment_id || null,
      attemptId: row.attempt_id || null,
      academicTermId: row.academic_term_id || null,
      periodStart: row.period_start || null,
      periodEnd: row.period_end || null,
      status: row.status,
      summary: row.summary || null,
      strengths: Array.isArray(row.strengths) ? row.strengths : [],
      weaknesses: Array.isArray(row.weaknesses) ? row.weaknesses : [],
      recommendedActions: Array.isArray(row.recommended_actions) ? row.recommended_actions : [],
      provider: row.provider || 'openrouter',
      modelName: row.model_name || 'openrouter/free',
      promptTokens: Number(row.prompt_tokens || 0),
      completionTokens: Number(row.completion_tokens || 0),
      latencyMs: row.latency_ms !== null && row.latency_ms !== undefined ? Number(row.latency_ms) : null,
      inputSnapshotHash: row.input_snapshot_hash,
      errorMessage: row.error_message || null,
      retryCount: Number(row.retry_count || 0),
      lockedBy: row.locked_by || null,
      leaseExpiresAt: row.lease_expires_at || null,
      nextRetryAt: row.next_retry_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Retrieves a report by its primary key UUID
   */
  async getReportById(id: string): Promise<AiFeedbackReport | null> {
    const db = this.getDb();
    const { data, error } = await db
      .from('ai_feedback_reports')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Database error fetching report ${id}: ${error.message}`);
    }
    return data ? this.mapRow(data) : null;
  }

  /**
   * Retrieves an immediate feedback report for a specific student attempt
   */
  async getImmediateReport(studentId: string, attemptId: string): Promise<AiFeedbackReport | null> {
    const db = this.getDb();
    const { data, error } = await db
      .from('ai_feedback_reports')
      .select('*')
      .eq('student_id', studentId)
      .eq('attempt_id', attemptId)
      .eq('feedback_type', 'immediate')
      .maybeSingle();

    if (error) {
      throw new Error(`Database error fetching immediate report for attempt ${attemptId}: ${error.message}`);
    }
    return data ? this.mapRow(data) : null;
  }

  /**
   * Retrieves a weekly progress summary for a student, term, and reporting period
   */
  async getWeeklyReport(
    studentId: string,
    academicTermId: string,
    periodStart: string,
    periodEnd: string
  ): Promise<AiFeedbackReport | null> {
    const db = this.getDb();
    const { data, error } = await db
      .from('ai_feedback_reports')
      .select('*')
      .eq('student_id', studentId)
      .eq('academic_term_id', academicTermId)
      .eq('period_start', periodStart)
      .eq('period_end', periodEnd)
      .eq('feedback_type', 'weekly')
      .maybeSingle();

    if (error) {
      throw new Error(`Database error fetching weekly report for student ${studentId}: ${error.message}`);
    }
    return data ? this.mapRow(data) : null;
  }

  /**
   * Retrieves all reports for a student, optionally filtered by feedback type
   */
  async getReportsByStudent(studentId: string, feedbackType?: FeedbackType): Promise<AiFeedbackReport[]> {
    const db = this.getDb();
    let query = db
      .from('ai_feedback_reports')
      .select('*')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });

    if (feedbackType) {
      query = query.eq('feedback_type', feedbackType);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Database error querying reports for student ${studentId}: ${error.message}`);
    }
    return (data || []).map((row) => this.mapRow(row));
  }

  /**
   * Creates or retrieves an immediate feedback report with idempotency protection.
   * If a report already exists:
   *   - Same hash: returns existing report (no-op).
   *   - Changed hash: resets status to 'pending', updates hash, clears retry count & lease.
   */
  async createOrGetImmediateReport(
    params: CreateImmediateReportParams
  ): Promise<{ report: AiFeedbackReport; isNew: boolean }> {
    const db = this.getDb();
    const isHardened = await this.isHardenedSchemaAvailable();

    // 1. Check existing report by unique constraint
    const existing = await this.getImmediateReport(params.studentId, params.attemptId);
    if (existing) {
      if (existing.inputSnapshotHash === params.inputSnapshotHash) {
        return { report: existing, isNew: false };
      }

      // Hash changed: reset to pending with updated snapshot hash and clear ownership
      const updatePayload: Record<string, any> = {
        input_snapshot_hash: params.inputSnapshotHash,
        status: 'pending',
        summary: null,
        strengths: [],
        weaknesses: [],
        recommended_actions: [],
        error_message: null,
        retry_count: 0,
      };

      if (isHardened) {
        updatePayload.next_retry_at = new Date().toISOString();
        updatePayload.locked_by = null;
        updatePayload.lease_expires_at = null;
      }

      const { data: updated, error: updErr } = await db
        .from('ai_feedback_reports')
        .update(updatePayload)
        .eq('id', existing.id)
        .select('*')
        .single();

      if (updErr) {
        throw new Error(`Database error updating changed immediate snapshot: ${updErr.message}`);
      }
      return { report: this.mapRow(updated), isNew: true };
    }

    // 2. Perform insert
    const insertPayload: Record<string, any> = {
      student_id: params.studentId,
      assessment_id: params.assessmentId,
      attempt_id: params.attemptId,
      feedback_type: 'immediate',
      input_snapshot_hash: params.inputSnapshotHash,
      status: 'pending',
      provider: 'openrouter',
      model_name: 'openrouter/free',
      retry_count: 0,
    };

    if (isHardened) {
      insertPayload.next_retry_at = new Date().toISOString();
      insertPayload.locked_by = null;
      insertPayload.lease_expires_at = null;
    }

    const { data: inserted, error: insErr } = await db
      .from('ai_feedback_reports')
      .insert(insertPayload)
      .select('*')
      .maybeSingle();

    if (insErr) {
      // Handle race condition: 23505 unique constraint violation
      if (insErr.code === '23505' || insErr.message.includes('unique')) {
        const raceExisting = await this.getImmediateReport(params.studentId, params.attemptId);
        if (raceExisting) {
          return { report: raceExisting, isNew: false };
        }
      }
      throw new Error(`Database error inserting immediate report: ${insErr.message}`);
    }

    return { report: this.mapRow(inserted), isNew: true };
  }

  /**
   * Creates or retrieves a weekly progress report with idempotency protection.
   * Handles concurrent duplicate creation attempts safely via unique index.
   */
  async createOrGetWeeklyReport(
    params: CreateWeeklyReportParams
  ): Promise<{ report: AiFeedbackReport; isNew: boolean }> {
    const db = this.getDb();
    const isHardened = await this.isHardenedSchemaAvailable();

    // 1. Check existing report by unique constraint
    const existing = await this.getWeeklyReport(
      params.studentId,
      params.academicTermId,
      params.periodStart,
      params.periodEnd
    );

    if (existing) {
      if (existing.inputSnapshotHash === params.inputSnapshotHash) {
        return { report: existing, isNew: false };
      }

      // If existing report is completed, processing, pending, or failed,
      // do not reset or duplicate it. Preserve existing retry and queue behavior.
      if (
        existing.status === 'completed' ||
        existing.status === 'processing' ||
        existing.status === 'pending' ||
        existing.status === 'failed'
      ) {
        return { report: existing, isNew: false };
      }

      // If existing report was skipped due to insufficient data,
      // and new published data now makes it eligible (hash changed),
      // transition from skipped_insufficient_data -> pending via atomic CAS.
      if (existing.status === 'skipped_insufficient_data') {
        const updatePayload: Record<string, any> = {
          input_snapshot_hash: params.inputSnapshotHash,
          status: 'pending',
          summary: null,
          strengths: [],
          weaknesses: [],
          recommended_actions: [],
          error_message: null,
          retry_count: 0,
        };

        if (isHardened) {
          updatePayload.next_retry_at = new Date().toISOString();
          updatePayload.locked_by = null;
          updatePayload.lease_expires_at = null;
        }

        // Atomic conditional check (CAS) ensures only one concurrent worker/scheduler
        // successfully transitions the skipped report to pending
        const { data: updated, error: updErr } = await db
          .from('ai_feedback_reports')
          .update(updatePayload)
          .eq('id', existing.id)
          .eq('status', 'skipped_insufficient_data')
          .select('*')
          .maybeSingle();

        if (updErr) {
          throw new Error(`Database error transitioning skipped weekly report to pending: ${updErr.message}`);
        }

        if (!updated) {
          // Lost race to concurrent scheduler or worker; fetch and return current state
          const fresh = await this.getReportById(existing.id);
          return { report: fresh ?? existing, isNew: false };
        }

        return { report: this.mapRow(updated), isNew: true };
      }

      return { report: existing, isNew: false };
    }

    // 2. Perform insert
    const insertPayload: Record<string, any> = {
      student_id: params.studentId,
      academic_term_id: params.academicTermId,
      period_start: params.periodStart,
      period_end: params.periodEnd,
      feedback_type: 'weekly',
      input_snapshot_hash: params.inputSnapshotHash,
      status: 'pending',
      provider: 'openrouter',
      model_name: 'openrouter/free',
      retry_count: 0,
    };

    if (isHardened) {
      insertPayload.next_retry_at = new Date().toISOString();
      insertPayload.locked_by = null;
      insertPayload.lease_expires_at = null;
    }

    const { data: inserted, error: insErr } = await db
      .from('ai_feedback_reports')
      .insert(insertPayload)
      .select('*')
      .maybeSingle();

    if (insErr) {
      if (insErr.code === '23505' || insErr.message.includes('unique')) {
        const raceExisting = await this.getWeeklyReport(
          params.studentId,
          params.academicTermId,
          params.periodStart,
          params.periodEnd
        );
        if (raceExisting) {
          return { report: raceExisting, isNew: false };
        }
      }
      throw new Error(`Database error inserting weekly report: ${insErr.message}`);
    }

    return { report: this.mapRow(inserted), isNew: true };
  }

  /**
   * Retrieves the authoritative institution timezone from public.institution_settings.
   * Throws an error if not found or invalid; does NOT fall back to environment variables.
   */
  async getInstitutionTimezone(): Promise<string> {
    const db = this.getDb();
    const { data, error } = await db
      .from('institution_settings')
      .select('timezone')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      throw new Error(`Database error querying institution timezone: ${error.message}`);
    }

    if (!data || !data.timezone) {
      throw new Error('No institution timezone configured in public.institution_settings (id: 1).');
    }

    const tz = data.timezone.trim();
    // Validate as valid IANA timezone
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: tz });
    } catch {
      throw new Error(`Invalid IANA timezone identifier in institution_settings: "${tz}"`);
    }

    return tz;
  }

  /**
   * Idempotently records a skipped weekly feedback report when student has insufficient published data.
   */
  async recordSkippedWeeklyReport(params: {
    studentId: string;
    academicTermId: string;
    periodStart: string;
    periodEnd: string;
    reason: string;
  }): Promise<{ report: AiFeedbackReport; isNew: boolean }> {
    const db = this.getDb();
    const isHardened = await this.isHardenedSchemaAvailable();

    const existing = await this.getWeeklyReport(
      params.studentId,
      params.academicTermId,
      params.periodStart,
      params.periodEnd
    );

    if (existing) {
      return { report: existing, isNew: false };
    }

    const dummyHash = crypto
      .createHash('sha256')
      .update(`insufficient-data:${params.studentId}:${params.periodStart}:${params.periodEnd}`)
      .digest('hex');

    const insertPayload: Record<string, any> = {
      student_id: params.studentId,
      academic_term_id: params.academicTermId,
      period_start: params.periodStart,
      period_end: params.periodEnd,
      feedback_type: 'weekly',
      input_snapshot_hash: dummyHash,
      status: 'skipped_insufficient_data',
      summary: params.reason.slice(0, 500),
      provider: 'openrouter',
      model_name: 'openrouter/free',
      retry_count: 0,
    };

    if (isHardened) {
      insertPayload.next_retry_at = null;
      insertPayload.locked_by = null;
      insertPayload.lease_expires_at = null;
    }

    const { data: inserted, error: insErr } = await db
      .from('ai_feedback_reports')
      .insert(insertPayload)
      .select('*')
      .maybeSingle();

    if (insErr) {
      if (insErr.code === '23505' || insErr.message.includes('unique')) {
        const raceExisting = await this.getWeeklyReport(
          params.studentId,
          params.academicTermId,
          params.periodStart,
          params.periodEnd
        );
        if (raceExisting) {
          return { report: raceExisting, isNew: false };
        }
      }
      throw new Error(`Database error recording skipped weekly report: ${insErr.message}`);
    }

    return { report: this.mapRow(inserted), isNew: true };
  }

  /**
   * Atomically claims the next eligible report for processing using Compare-And-Swap (CAS).
   * 
   * Hardened Claim Algorithm:
   * 1. Direct DB filter: queries only records where next_retry_at <= NOW() and retry_count < maxRetries,
   *    or expired leases where lease_expires_at <= NOW(). Eliminates head-of-line blocking.
   * 2. Atomic CAS: sets status = 'processing', locked_by = workerId, lease_expires_at = NOW() + leaseDurationMs.
   * 3. Row lock: PostgreSQL row-level locks prevent two workers from claiming the same record.
   * 
   * Supports both (workerId, maxRetries, leaseDurationMs) and legacy (maxRetries, leaseDurationMs).
   */
  async claimNextEligibleReport(
    workerIdOrMaxRetries?: string | number,
    maxRetriesOrLease?: number,
    leaseDurationMs?: number
  ): Promise<AiFeedbackReport | null> {
    let workerId = 'worker-default';
    let maxRetries = 3;
    let leaseMs = 300000; // 5 minutes default

    if (typeof workerIdOrMaxRetries === 'string') {
      workerId = workerIdOrMaxRetries;
      maxRetries = maxRetriesOrLease ?? 3;
      leaseMs = leaseDurationMs ?? 300000;
    } else if (typeof workerIdOrMaxRetries === 'number') {
      maxRetries = workerIdOrMaxRetries;
      leaseMs = maxRetriesOrLease ?? 300000;
    }

    const db = this.getDb();
    const isHardened = await this.isHardenedSchemaAvailable();
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const leaseExpiresIso = new Date(nowMs + leaseMs).toISOString();

    let candidates: any[] = [];

    if (isHardened) {
      // 1. Pending & failed records eligible right now (ordered by next_retry_at and created_at)
      const { data: eligibleRetries, error: err1 } = await db
        .from('ai_feedback_reports')
        .select('id, status, retry_count, updated_at, created_at, locked_by, lease_expires_at, next_retry_at')
        .in('status', ['pending', 'failed'])
        .or(`next_retry_at.lte.${nowIso},next_retry_at.is.null`)
        .lt('retry_count', maxRetries)
        .order('next_retry_at', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(15);

      if (err1) {
        throw new Error(`Database error querying eligible reports: ${err1.message}`);
      }

      // 2. Expired processing leases ready for reclamation
      const { data: expiredLeases, error: err2 } = await db
        .from('ai_feedback_reports')
        .select('id, status, retry_count, updated_at, created_at, locked_by, lease_expires_at, next_retry_at')
        .eq('status', 'processing')
        .lte('lease_expires_at', nowIso)
        .order('lease_expires_at', { ascending: true })
        .limit(5);

      if (err2) {
        throw new Error(`Database error querying expired processing leases: ${err2.message}`);
      }

      candidates = [...(eligibleRetries || []), ...(expiredLeases || [])];
    } else {
      // Fallback for pre-migration schema
      const { data: legacyCandidates, error } = await db
        .from('ai_feedback_reports')
        .select('id, status, retry_count, updated_at, created_at')
        .in('status', ['pending', 'processing', 'failed'])
        .order('created_at', { ascending: true })
        .limit(20);

      if (error) {
        throw new Error(`Database error querying candidate reports: ${error.message}`);
      }

      for (const candidate of legacyCandidates || []) {
        const updatedTime = new Date(candidate.updated_at).getTime();
        if (candidate.status === 'pending') {
          candidates.push(candidate);
        } else if (candidate.status === 'processing' && nowMs - updatedTime >= leaseMs) {
          candidates.push(candidate);
        } else if (candidate.status === 'failed' && candidate.retry_count < maxRetries) {
          const backoff = Math.min(60000, 2000 * Math.pow(2, Math.max(0, candidate.retry_count - 1)));
          if (nowMs - updatedTime >= backoff) {
            candidates.push(candidate);
          }
        }
      }
    }

    if (!candidates || candidates.length === 0) {
      return null;
    }

    // Attempt Atomic Compare-And-Swap (CAS) update
    for (const candidate of candidates) {
      const updatePayload: Record<string, any> = {
        status: 'processing',
      };

      if (isHardened) {
        updatePayload.locked_by = workerId;
        updatePayload.lease_expires_at = leaseExpiresIso;
      }

      const { data: claimed, error: claimErr } = await db
        .from('ai_feedback_reports')
        .update(updatePayload)
        .eq('id', candidate.id)
        .eq('status', candidate.status)
        .eq('updated_at', candidate.updated_at) // Concurrency guard: row must not have changed
        .select('*')
        .maybeSingle();

      if (claimErr) {
        console.error(`[AiFeedbackStore] Claim error on candidate ${candidate.id}:`, claimErr);
        continue;
      }

      if (claimed) {
        return this.mapRow(claimed);
      }
      // If claimed is null, another concurrent worker claimed it first; proceed to next candidate.
    }

    return null;
  }

  /**
   * Atomically claims a specific report by ID for a worker using CAS.
   * Can only claim if the report is currently 'pending', 'failed' (with elapsed retry),
   * or 'processing' with an expired lease.
   */
  async claimReportById(
    reportId: string,
    workerId: string,
    leaseDurationMs: number = 300000,
    maxRetries: number = 3
  ): Promise<AiFeedbackReport | null> {
    const db = this.getDb();
    const isHardened = await this.isHardenedSchemaAvailable();
    const current = await this.getReportById(reportId);
    if (!current) {
      return null;
    }

    const now = new Date();

    // Check eligibility based on current state
    if (current.status === 'completed' || current.status === 'skipped_insufficient_data') {
      return null;
    }

    if (current.status === 'processing') {
      if (isHardened) {
        if (!current.leaseExpiresAt || new Date(current.leaseExpiresAt) > now) {
          // Active unexpired lease held by another worker
          return null;
        }
      } else {
        const ageMs = now.getTime() - new Date(current.updatedAt).getTime();
        if (ageMs <= leaseDurationMs) {
          return null;
        }
      }
    }

    if (current.status === 'failed') {
      if (current.retryCount >= maxRetries) {
        return null;
      }
      if (isHardened && current.nextRetryAt && new Date(current.nextRetryAt) > now) {
        return null;
      }
    }

    const leaseExpiresIso = new Date(Date.now() + leaseDurationMs).toISOString();
    const updatePayload: Record<string, any> = {
      status: 'processing',
    };

    if (isHardened) {
      updatePayload.locked_by = workerId;
      updatePayload.lease_expires_at = leaseExpiresIso;
      updatePayload.next_retry_at = null;
    }

    // Atomic CAS update verifying status and updated_at
    const { data: claimed, error: claimErr } = await db
      .from('ai_feedback_reports')
      .update(updatePayload)
      .eq('id', current.id)
      .eq('status', current.status)
      .eq('updated_at', current.updatedAt)
      .select('*')
      .maybeSingle();

    if (claimErr) {
      console.error(`[AiFeedbackStore] Claim error on report ${reportId}:`, claimErr);
      return null;
    }

    return claimed ? this.mapRow(claimed) : null;
  }

  /**
   * Renews the processing lease for an active report.
   * Can only succeed if the caller is the current owner and the lease is still valid.
   */
  async renewLease(
    reportId: string,
    workerId: string,
    leaseDurationMs: number = 300000
  ): Promise<boolean> {
    const db = this.getDb();
    const isHardened = await this.isHardenedSchemaAvailable();

    if (!isHardened) {
      // In unhardened schema, touching updated_at acts as lease refresh
      const { data, error } = await db
        .from('ai_feedback_reports')
        .update({ status: 'processing' })
        .eq('id', reportId)
        .eq('status', 'processing')
        .select('id')
        .maybeSingle();
      return !!data && !error;
    }

    const nowIso = new Date().toISOString();
    const newExpiresIso = new Date(Date.now() + leaseDurationMs).toISOString();

    const { data, error } = await db
      .from('ai_feedback_reports')
      .update({
        lease_expires_at: newExpiresIso,
      })
      .eq('id', reportId)
      .eq('status', 'processing')
      .eq('locked_by', workerId)
      .gt('lease_expires_at', nowIso) // Cannot renew an already-expired lease
      .select('id')
      .maybeSingle();

    if (error) {
      console.error(`[AiFeedbackStore] Lease renewal error on report ${reportId}:`, error);
      return false;
    }

    return !!data;
  }

  /**
   * Saves successfully generated and validated structured feedback.
   * 
   * Strict Safety Guards:
   * - Requires matching reportId and status = 'processing'.
   * - Requires matching input_snapshot_hash: prevents obsolete feedback if snapshot changed.
   * - Requires matching locked_by and valid lease: prevents old/evicted workers from overwriting results.
   * - Clears locked_by, lease_expires_at, and next_retry_at upon completion.
   */
  async saveCompletedFeedback(
    reportId: string,
    result: SaveCompletedFeedbackParams
  ): Promise<AiFeedbackReport | null> {
    const db = this.getDb();
    const isHardened = await this.isHardenedSchemaAvailable();

    const updatePayload: Record<string, any> = {
      status: 'completed',
      summary: result.feedback.summary,
      strengths: result.feedback.strengths,
      weaknesses: result.feedback.weaknesses,
      recommended_actions: result.feedback.recommended_actions,
      provider: 'openrouter',
      model_name: result.actualModel,
      prompt_tokens: result.promptTokens ?? 0,
      completion_tokens: result.completionTokens ?? 0,
      latency_ms: result.latencyMs,
      error_message: null,
    };

    if (isHardened) {
      updatePayload.locked_by = null;
      updatePayload.lease_expires_at = null;
      updatePayload.next_retry_at = null;
    }

    let query = db
      .from('ai_feedback_reports')
      .update(updatePayload)
      .eq('id', reportId);

    // Strict worker ownership & snapshot integrity guards when called in worker context
    if (result.workerId || result.expectedSnapshotHash) {
      query = query.eq('status', 'processing');

      if (result.expectedSnapshotHash) {
        query = query.eq('input_snapshot_hash', result.expectedSnapshotHash);
      }

      if (isHardened && result.workerId) {
        query = query
          .eq('locked_by', result.workerId)
          .gt('lease_expires_at', new Date().toISOString());
      }
    }

    const { data, error } = await query.select('*').maybeSingle();

    if (error) {
      throw new Error(`Database error saving completed feedback for report ${reportId}: ${error.message}`);
    }

    return data ? this.mapRow(data) : null;
  }

  /**
   * Saves failed feedback status, error message, and schedules next retry time.
   * 
   * Strict Safety Guards:
   * - Transient failures schedule bounded exponential backoff in next_retry_at.
   * - Permanent failures set retry_count = maxRetries and next_retry_at = null.
   * - Requires matching workerId, active lease, and expectedSnapshotHash.
   * - Clears ownership and lease fields.
   */
  async saveFailedFeedback(
    reportId: string,
    errorMessage: string,
    isPermanent: boolean = false,
    maxRetries: number = 3,
    workerId?: string,
    expectedSnapshotHash?: string
  ): Promise<AiFeedbackReport | null> {
    const db = this.getDb();
    const isHardened = await this.isHardenedSchemaAvailable();

    // Fetch current report to determine new retry count
    const current = await this.getReportById(reportId);
    const newRetryCount = isPermanent
      ? maxRetries
      : (current?.retryCount ?? 0) + 1;

    const willRetry = !isPermanent && newRetryCount < maxRetries;
    const backoffMs = willRetry
      ? Math.min(60000, 2000 * Math.pow(2, Math.max(0, newRetryCount - 1)))
      : 0;

    // Sanitize error message (no secrets or PII)
    const sanitizedError = errorMessage
      .replace(/Bearer\s+[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]')
      .replace(/sk-[a-zA-Z0-9_\-.]+/gi, '[KEY_REDACTED]')
      .slice(0, 1000);

    const updatePayload: Record<string, any> = {
      status: 'failed',
      error_message: sanitizedError,
      retry_count: newRetryCount,
    };

    if (isHardened) {
      updatePayload.locked_by = null;
      updatePayload.lease_expires_at = null;
      updatePayload.next_retry_at = willRetry
        ? new Date(Date.now() + backoffMs).toISOString()
        : null;
    }

    let query = db
      .from('ai_feedback_reports')
      .update(updatePayload)
      .eq('id', reportId);

    // Strict worker ownership & snapshot integrity guards when called in worker context
    if (workerId || expectedSnapshotHash) {
      if (expectedSnapshotHash) {
        query = query.eq('input_snapshot_hash', expectedSnapshotHash);
      }

      if (isHardened && workerId) {
        query = query
          .eq('status', 'processing')
          .eq('locked_by', workerId)
          .gt('lease_expires_at', new Date().toISOString());
      } else {
        query = query.in('status', ['pending', 'processing']);
      }
    }

    const { data, error } = await query.select('*').maybeSingle();

    if (error) {
      throw new Error(`Database error recording failed feedback for report ${reportId}: ${error.message}`);
    }

    return data ? this.mapRow(data) : null;
  }

  /**
   * Marks a report as skipped when source data is insufficient (e.g. 0 published tests in weekly window)
   */
  async markSkippedInsufficientData(reportId: string, reason: string): Promise<AiFeedbackReport> {
    const db = this.getDb();
    const isHardened = await this.isHardenedSchemaAvailable();

    const updatePayload: Record<string, any> = {
      status: 'skipped_insufficient_data',
      summary: reason.slice(0, 500),
    };

    if (isHardened) {
      updatePayload.locked_by = null;
      updatePayload.lease_expires_at = null;
      updatePayload.next_retry_at = null;
    }

    const { data, error } = await db
      .from('ai_feedback_reports')
      .update(updatePayload)
      .eq('id', reportId)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Database error marking report ${reportId} as skipped: ${error.message}`);
    }
    return this.mapRow(data);
  }

  /**
   * Recovers any abandoned jobs stuck in 'processing' longer than lease duration, returning them to 'pending'.
   * Leaves active leases with unexpired deadlines intact.
   */
  async recoverStaleJobs(leaseDurationMs: number = 300000): Promise<number> {
    const db = this.getDb();
    const isHardened = await this.isHardenedSchemaAvailable();
    const nowIso = new Date().toISOString();
    const cutoff = new Date(Date.now() - leaseDurationMs).toISOString();

    if (isHardened) {
      // Hardened recovery: safely resets processing jobs whose lease_expires_at <= NOW()
      // or legacy records where lease_expires_at is null and updated_at <= cutoff
      const { data, error } = await db
        .from('ai_feedback_reports')
        .update({
          status: 'pending',
          locked_by: null,
          lease_expires_at: null,
          next_retry_at: nowIso,
        })
        .eq('status', 'processing')
        .or(`lease_expires_at.lte.${nowIso},and(lease_expires_at.is.null,updated_at.lte.${cutoff})`)
        .select('id');

      if (error) {
        console.error('[AiFeedbackStore] Error recovering stale processing jobs:', error);
        return 0;
      }
      return data?.length ?? 0;
    } else {
      // Legacy fallback
      const { data, error } = await db
        .from('ai_feedback_reports')
        .update({
          status: 'pending',
        })
        .eq('status', 'processing')
        .lte('updated_at', cutoff)
        .select('id');

      if (error) {
        console.error('[AiFeedbackStore] Error recovering stale processing jobs:', error);
        return 0;
      }
      return data?.length ?? 0;
    }
  }
}

export const aiFeedbackStore = new AiFeedbackStore();

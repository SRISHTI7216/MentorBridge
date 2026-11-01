/**
 * Database-Backed Recoverable AI Feedback Queue Processor
 * Phase 4A Step 5.2.1: Queue Reliability Hardening
 * 
 * Implements an asynchronous queue processor where Supabase PostgreSQL is the authoritative queue:
 * - Each worker instance has a unique worker_id (`worker-${uuid}`).
 * - Recovers eligible pending and expired processing leases on startup / restart.
 * - Atomically claims jobs via CAS in aiFeedbackStore with worker ownership and lease deadline.
 * - Enforces bounded concurrency: strictly 1 active OpenRouter request per worker instance.
 * - Enforces request pacing between consecutive outbound calls.
 * - Enforces pre-flight publication gate, snapshot hash verification, and PII checks.
 * - Verifies worker lease ownership and snapshot hash matching on completion and failure.
 * - Automatically discards stale results if a lease was lost, expired, or the snapshot changed.
 * - Sanitized logging: zero secrets, tokens, full prompts, or student answers logged.
 */

import crypto from 'crypto';
import {
  aiFeedbackStore,
  AiFeedbackStore,
  AiFeedbackReport,
} from './aiFeedbackStore.js';
import {
  openrouterService,
  OpenRouterService,
  OpenRouterConfigError,
  OpenRouterPrivacyError,
  OpenRouterValidationError,
  OpenRouterRateLimitError,
  OpenRouterServerError,
  OpenRouterTimeoutError,
} from './openrouterService.js';
import { analyticsStore, AnalyticsStore } from './analyticsStore.js';

export interface AiFeedbackQueueOptions {
  workerId?: string;
  maxRetries?: number;
  pacingMs?: number;
  leaseDurationMs?: number;
  store?: AiFeedbackStore;
  openrouter?: OpenRouterService;
  analytics?: AnalyticsStore;
}

export class AiFeedbackQueue {
  private readonly workerId: string;
  private readonly maxRetries: number;
  private readonly pacingMs: number;
  private readonly leaseDurationMs: number;
  private readonly store: AiFeedbackStore;
  private openrouter: OpenRouterService;
  private readonly analytics: AnalyticsStore;

  private isProcessing: boolean = false;
  private activeJobsCount: number = 0;

  constructor(options?: AiFeedbackQueueOptions) {
    this.workerId = options?.workerId || `worker-${crypto.randomUUID()}`;
    this.maxRetries = options?.maxRetries ?? 3;
    this.pacingMs = options?.pacingMs ?? 1000;
    this.leaseDurationMs = options?.leaseDurationMs ?? 300000; // 5 minutes
    this.store = options?.store ?? aiFeedbackStore;
    this.openrouter = options?.openrouter ?? openrouterService;
    this.analytics = options?.analytics ?? analyticsStore;
  }

  /**
   * Allows injecting a mocked or alternative OpenRouterService instance (useful for unit/integration testing)
   */
  public setOpenRouterService(openrouter: OpenRouterService): void {
    this.openrouter = openrouter;
  }

  /**
   * Returns current queue worker identity and status
   */
  public getStatus(): { workerId: string; isProcessing: boolean; activeJobsCount: number } {
    return {
      workerId: this.workerId,
      isProcessing: this.isProcessing,
      activeJobsCount: this.activeJobsCount,
    };
  }

  /**
   * Returns the unique worker identifier
   */
  public getWorkerId(): string {
    return this.workerId;
  }

  /**
   * Lightweight notification to wake up the queue worker when new jobs are inserted.
   * The database remains the sole authoritative queue.
   */
  public kick(): void {
    if (this.isProcessing) {
      return;
    }
    // Launch processing loop in background without blocking caller
    this.processLoop().catch((err) => {
      console.error(`[AIFeedbackQueue:${this.workerId}] Unhandled error in processLoop:`, err.message || err);
    });
  }

  /**
   * Recovers expired processing leases and processes any eligible pending work.
   * Suitable for invocation upon server startup or explicit maintenance ping.
   */
  public async recoverAndProcess(): Promise<{ recoveredStaleCount: number }> {
    const recoveredStaleCount = await this.store.recoverStaleJobs(this.leaseDurationMs);
    if (recoveredStaleCount > 0) {
      console.log(`[AIFeedbackQueue:${this.workerId}] Recovered ${recoveredStaleCount} abandoned processing jobs to pending state.`);
    }
    this.kick();
    return { recoveredStaleCount };
  }

  /**
   * Main processing loop: claims and executes eligible reports sequentially
   * until no eligible reports remain in the database.
   */
  public async processLoop(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      while (true) {
        // Atomically claim the next eligible report via CAS with worker ownership
        const report = await this.store.claimNextEligibleReport(
          this.workerId,
          this.maxRetries,
          this.leaseDurationMs
        );

        // No eligible reports found; queue is fully drained
        if (!report) {
          break;
        }

        this.activeJobsCount++;
        try {
          await this.processSingleReport(report);
        } catch (err: any) {
          console.error(`[AIFeedbackQueue:${this.workerId}] Unexpected processing error on report ${report.id}:`, err.message || err);
          // Safeguard: Ensure report is never left permanently stuck in 'processing'
          try {
            await this.store.saveFailedFeedback(
              report.id,
              err.message || 'Unexpected worker error',
              false,
              this.maxRetries,
              this.workerId,
              report.inputSnapshotHash
            );
          } catch (saveErr) {
            console.error(`[AIFeedbackQueue:${this.workerId}] Failed to record failure for report ${report.id}:`, saveErr);
          }
        } finally {
          this.activeJobsCount--;
        }

        // Bounded pacing: delay between consecutive outbound OpenRouter calls to prevent rate limits
        if (this.pacingMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.pacingMs));
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Executes processing for a single claimed report:
   * 1. Captures expected snapshot hash.
   * 2. Reconstructs and validates academic snapshot.
   * 3. Checks publication status and PII safety.
   * 4. Calls OpenRouter free tier.
   * 5. Persists completed feedback only if worker still owns valid lease and hash matches.
   */
  public async processSingleReport(initialReport: AiFeedbackReport): Promise<void> {
    let report = initialReport;

    // Strict Worker Ownership Guard: ensure this worker holds an active processing lease on the report.
    // If passed a report not already claimed in 'processing' by this worker, atomically acquire the lease first.
    if (report.status !== 'processing' || report.lockedBy !== this.workerId) {
      const claimed = await this.store.claimReportById(
        report.id,
        this.workerId,
        this.leaseDurationMs,
        this.maxRetries
      );
      if (!claimed) {
        console.warn(
          `[AIFeedbackQueue:${this.workerId}] Cannot process report ${report.id}: unable to acquire processing lease.`
        );
        return;
      }
      report = claimed;
    }

    const expectedHash = report.inputSnapshotHash;
    console.log(
      `[AIFeedbackQueue:${this.workerId}] Processing report ${report.id} (type: ${report.feedbackType}, student: ${report.studentId.slice(0, 8)}...)`
    );

    // 1. Reconstruct snapshot from authoritative database tables
    let snapshotResult: {
      isEligible: boolean;
      reason?: string;
      payload?: any;
      inputSnapshotHash?: string;
    };

    if (report.feedbackType === 'immediate') {
      if (!report.assessmentId || !report.attemptId) {
        await this.store.saveFailedFeedback(
          report.id,
          'Immediate feedback report is missing assessmentId or attemptId.',
          true,
          this.maxRetries,
          this.workerId,
          expectedHash
        );
        return;
      }

      snapshotResult = await this.analytics.constructImmediateFeedbackSnapshot(
        report.studentId,
        report.assessmentId,
        report.attemptId
      );
    } else {
      if (!report.academicTermId || !report.periodStart || !report.periodEnd) {
        await this.store.saveFailedFeedback(
          report.id,
          'Weekly feedback report is missing academicTermId or reporting window dates.',
          true,
          this.maxRetries,
          this.workerId,
          expectedHash
        );
        return;
      }

      snapshotResult = await this.analytics.constructWeeklyFeedbackSnapshot(
        report.studentId,
        report.academicTermId,
        report.periodStart,
        report.periodEnd
      );
    }

    // 2. Publication & Eligibility Gate
    if (!snapshotResult.isEligible) {
      const reason = snapshotResult.reason || 'Snapshot ineligible for AI feedback generation.';

      if (reason.toLowerCase().includes('insufficient data')) {
        await this.store.markSkippedInsufficientData(report.id, reason);
        console.log(`[AIFeedbackQueue:${this.workerId}] Report ${report.id} skipped: ${reason}`);
        return;
      }

      // Record as permanent failure (e.g. results unpublished or attempt not evaluated)
      await this.store.saveFailedFeedback(
        report.id,
        reason,
        true,
        this.maxRetries,
        this.workerId,
        expectedHash
      );
      console.log(`[AIFeedbackQueue:${this.workerId}] Report ${report.id} failed eligibility: ${reason}`);
      return;
    }

    // 4. Pre-flight PII check
    try {
      this.openrouter.scanForPii(snapshotResult.payload);
    } catch (piiErr: any) {
      console.error(`[AIFeedbackQueue:${this.workerId}] PII validation failed for report ${report.id}:`, piiErr.message);
      // PII violation is a permanent error: do not retry
      await this.store.saveFailedFeedback(
        report.id,
        piiErr.message || 'PII detected in snapshot.',
        true,
        this.maxRetries,
        this.workerId,
        expectedHash
      );
      return;
    }

    // 5. Execute AI Generation with OpenRouter
    try {
      const executionResult = await this.openrouter.generateFeedback(snapshotResult.payload);

      // 6. Persist Completed Feedback with strict lease ownership & snapshot verification
      const savedReport = await this.store.saveCompletedFeedback(report.id, {
        feedback: executionResult.feedback,
        actualModel: executionResult.actualModel,
        promptTokens: executionResult.promptTokens,
        completionTokens: executionResult.completionTokens,
        latencyMs: executionResult.latencyMs,
        workerId: this.workerId,
        expectedSnapshotHash: expectedHash,
      });

      if (!savedReport) {
        console.warn(
          `[AIFeedbackQueue:${this.workerId}] Stale completion rejected for report ${report.id} (lease expired, ownership lost, or snapshot changed). Result safely discarded.`
        );
        return;
      }

      console.log(
        `[AIFeedbackQueue:${this.workerId}] Completed report ${report.id} in ${executionResult.latencyMs}ms using model "${executionResult.actualModel}"`
      );
    } catch (genErr: any) {
      const isPermanent =
        genErr instanceof OpenRouterConfigError ||
        genErr instanceof OpenRouterPrivacyError ||
        genErr instanceof OpenRouterValidationError;

      const errorMessage = genErr.message || 'AI generation failed';
      console.error(
        `[AIFeedbackQueue:${this.workerId}] Generation error on report ${report.id} (permanent: ${isPermanent}):`,
        errorMessage
      );

      const savedFailure = await this.store.saveFailedFeedback(
        report.id,
        errorMessage,
        isPermanent,
        this.maxRetries,
        this.workerId,
        expectedHash
      );

      if (!savedFailure) {
        console.warn(
          `[AIFeedbackQueue:${this.workerId}] Stale failure write rejected for report ${report.id} (lease lost). Discarded.`
        );
      }
    }
  }
}

export const aiFeedbackQueue = new AiFeedbackQueue();

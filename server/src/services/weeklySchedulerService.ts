/**
 * Automated Weekly AI Progress Feedback Scheduling Service
 * Phase 4A Step 5.4: Weekly AI Progress Feedback Scheduling & Background Automation
 * 
 * Responsibilities:
 * 1. Reads authoritative institution timezone dynamically from public.institution_settings.timezone.
 * 2. Enforces IANA timezone validation with no environment-variable fallback or hardcoding.
 * 3. Calculates deterministic weekly periods: Monday 00:00:00 through Sunday 21:00:00 local time,
 *    correctly converting boundaries to UTC ISO-8601 strings and handling DST transitions.
 * 4. Scans eligible active students and active academic terms.
 * 5. Reconstructs weekly snapshots from published assessment results only (never unpublished).
 * 6. Records reports idempotently via public.ai_feedback_reports and unique constraint idx_unique_weekly_feedback_per_period.
 * 7. Records skipped_insufficient_data for students with no published assessments in the window.
 * 8. Triggers non-blocking queue execution via aiFeedbackQueue.kick().
 * 9. Manages startup catch-up recovery and graceful timer shutdown.
 */

import { AiFeedbackStore, aiFeedbackStore } from './aiFeedbackStore.js';
import { AiFeedbackQueue, aiFeedbackQueue } from './aiFeedbackQueue.js';
import { AnalyticsStore, analyticsStore } from './analyticsStore.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

export class InstitutionTimezoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstitutionTimezoneError';
  }
}

export interface WeeklyPeriodBoundaries {
  periodStartUtc: string; // ISO-8601 UTC string (Monday 00:00 local)
  periodEndUtc: string;   // ISO-8601 UTC string (Sunday 21:00 local)
  isSundayTriggerWindow: boolean; // True if reference time is Sunday >= 21:00 local
  localYear: number;
  localSundayDate: string; // YYYY-MM-DD
}

export interface WeeklySchedulerRunResult {
  timeZone: string;
  academicTermId: string | null;
  periodStartUtc: string;
  periodEndUtc: string;
  totalStudents: number;
  newlyEnqueuedCount: number;
  skippedInsufficientCount: number;
  alreadyProcessedCount: number;
  errorCount: number;
  errors: string[];
  skippedReason?: string;
}

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string; // 'Sun', 'Mon', etc.
}

export class WeeklySchedulerService {
  private store: AiFeedbackStore;
  private queue: AiFeedbackQueue;
  private analytics: AnalyticsStore;
  private db: typeof supabaseAdmin;
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(options?: {
    store?: AiFeedbackStore;
    queue?: AiFeedbackQueue;
    analytics?: AnalyticsStore;
    db?: typeof supabaseAdmin;
  }) {
    this.store = options?.store || aiFeedbackStore;
    this.queue = options?.queue || aiFeedbackQueue;
    this.analytics = options?.analytics || analyticsStore;
    this.db = options?.db || supabaseAdmin;
  }

  private getDb() {
    if (this.db) {
      return this.db;
    }
    if (!supabaseAdmin) {
      throw new Error('Supabase admin client is not configured.');
    }
    return supabaseAdmin;
  }

  /**
   * Validates that a string is a recognized IANA timezone identifier
   */
  public validateTimezone(timeZone: string): void {
    if (!timeZone || typeof timeZone !== 'string') {
      throw new InstitutionTimezoneError('Timezone must be a non-empty string.');
    }
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: timeZone.trim() });
    } catch {
      throw new InstitutionTimezoneError(`Invalid or unsupported IANA timezone identifier: "${timeZone}"`);
    }
  }

  /**
   * Breaks a UTC Date into calendar parts formatted in the target timezone
   */
  public getZonedParts(date: Date, timeZone: string): ZonedDateParts {
    this.validateTimezone(timeZone);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone.trim(),
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
      hour12: false,
    });

    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((p) => [p.type, p.value])
    );

    return {
      year: parseInt(parts.year, 10),
      month: parseInt(parts.month, 10),
      day: parseInt(parts.day, 10),
      hour: parseInt(parts.hour === '24' ? '0' : parts.hour, 10),
      minute: parseInt(parts.minute, 10),
      second: parseInt(parts.second, 10),
      weekday: parts.weekday,
    };
  }

  /**
   * Converts local calendar numbers (year, month 1-12, day, hour 0-23, minute, second)
   * in the specified IANA timezone into an exact UTC Date.
   * Handles daylight-saving shifts (23h or 25h transitions) via iterative offset convergence.
   */
  public zonedTimeToUtc(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    timeZone: string
  ): Date {
    this.validateTimezone(timeZone);

    // Initial guess assuming the local numbers were UTC
    let guess = Date.UTC(year, month - 1, day, hour, minute, second);

    for (let i = 0; i < 4; i++) {
      const actual = this.getZonedParts(new Date(guess), timeZone);
      const actualAsUtc = Date.UTC(
        actual.year,
        actual.month - 1,
        actual.day,
        actual.hour,
        actual.minute,
        actual.second
      );
      const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
      const diff = targetAsUtc - actualAsUtc;
      if (diff === 0) {
        break;
      }
      guess += diff;
    }

    return new Date(guess);
  }

  /**
   * Computes the scheduled weekly reporting period (Monday 00:00 through Sunday 21:00)
   * relative to a given reference time in the institution's timezone.
   * 
   * Deterministic rule:
   * - If referenceTime is Sunday on or after 21:00 local time:
   *     Period End = this Sunday at 21:00:00
   *     Period Start = this week's Monday at 00:00:00 (6 days prior)
   *     isSundayTriggerWindow = true
   * - Otherwise (Sunday before 21:00, or Monday through Saturday):
   *     Period End = the most recently completed Sunday at 21:00:00
   *     Period Start = the Monday at 00:00:00 corresponding to that Sunday
   *     isSundayTriggerWindow = false
   */
  public computeWeeklyPeriod(referenceTime: Date, timeZone: string): WeeklyPeriodBoundaries {
    const parts = this.getZonedParts(referenceTime, timeZone);
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const dayOfWeek = weekdayMap[parts.weekday] ?? 0;

    let daysSinceEndSunday: number;
    let isSundayTriggerWindow: boolean = false;

    if (dayOfWeek === 0) {
      // Sunday
      if (parts.hour >= 21) {
        daysSinceEndSunday = 0; // Today at 21:00 is active trigger window
        isSundayTriggerWindow = true;
      } else {
        daysSinceEndSunday = 7; // Last Sunday at 21:00
        isSundayTriggerWindow = false;
      }
    } else {
      // Monday (1) through Saturday (6)
      daysSinceEndSunday = dayOfWeek;
      isSundayTriggerWindow = false;
    }

    // Step backwards to the reference Sunday
    const endZonedParts = this.getZonedParts(
      new Date(referenceTime.getTime() - daysSinceEndSunday * 86400000),
      timeZone
    );

    const periodEnd = this.zonedTimeToUtc(
      endZonedParts.year,
      endZonedParts.month,
      endZonedParts.day,
      21,
      0,
      0,
      timeZone
    );

    // Monday 00:00 of that reporting week is 6 days prior to the Sunday
    const startZonedParts = this.getZonedParts(
      new Date(periodEnd.getTime() - 6 * 86400000),
      timeZone
    );

    const periodStart = this.zonedTimeToUtc(
      startZonedParts.year,
      startZonedParts.month,
      startZonedParts.day,
      0,
      0,
      0,
      timeZone
    );

    const pad = (n: number) => String(n).padStart(2, '0');
    const localSundayDate = `${endZonedParts.year}-${pad(endZonedParts.month)}-${pad(endZonedParts.day)}`;

    return {
      periodStartUtc: periodStart.toISOString(),
      periodEndUtc: periodEnd.toISOString(),
      isSundayTriggerWindow,
      localYear: endZonedParts.year,
      localSundayDate,
    };
  }

  /**
   * Reads the authoritative timezone from public.institution_settings.
   * Throws if unconfigured; does NOT use environment variables or hardcoded values.
   */
  public async getInstitutionTimezone(): Promise<string> {
    return this.store.getInstitutionTimezone();
  }

  /**
   * Determines if a weekly generation run is currently due.
   */
  public async isRunDue(referenceTime: Date = new Date()): Promise<{
    isDue: boolean;
    reason?: string;
    timeZone?: string;
    boundaries?: WeeklyPeriodBoundaries;
  }> {
    let timeZone: string;
    try {
      timeZone = await this.getInstitutionTimezone();
    } catch (err: any) {
      return { isDue: false, reason: `Timezone resolution failed: ${err.message}` };
    }

    const boundaries = this.computeWeeklyPeriod(referenceTime, timeZone);

    const db = this.getDb();

    // Verify active academic term exists
    const { data: term, error: termErr } = await db
      .from('academic_terms')
      .select('id')
      .eq('is_current', true)
      .maybeSingle();

    if (termErr || !term) {
      return { isDue: false, reason: 'No active academic term (is_current = true) found in database.' };
    }

    // Verify active students exist
    const { data: students, error: sErr } = await db
      .from('profiles')
      .select('id')
      .eq('role', 'student')
      .eq('is_active', true);

    if (sErr || !students || students.length === 0) {
      return { isDue: false, reason: 'No active students found in institution.' };
    }

    // Check how many students already have a weekly report for this term and period
    const { count, error: countErr } = await db
      .from('ai_feedback_reports')
      .select('id', { count: 'exact', head: true })
      .eq('academic_term_id', term.id)
      .eq('period_start', boundaries.periodStartUtc)
      .eq('period_end', boundaries.periodEndUtc)
      .eq('feedback_type', 'weekly');

    if (countErr) {
      return { isDue: false, reason: `Database error checking scheduled reports: ${countErr.message}` };
    }

    // If all active students already have a report (completed, pending, or skipped), run is already complete
    if ((count ?? 0) >= students.length) {
      return {
        isDue: false,
        reason: `All active students (${students.length}) already have weekly records for period ${boundaries.periodStartUtc} - ${boundaries.periodEndUtc}.`,
        timeZone,
        boundaries,
      };
    }

    return {
      isDue: true,
      timeZone,
      boundaries,
    };
  }

  /**
   * Core weekly execution method:
   * 1. Resolves dynamic timezone from public.institution_settings.
   * 2. Calculates deterministic period boundaries in UTC.
   * 3. Resolves current academic term and active students.
   * 4. Idempotently creates pending or skipped_insufficient_data weekly reports.
   * 5. Non-blocking kick of the background AI queue worker.
   */
  public async processWeeklyRun(options?: {
    force?: boolean;
    referenceTime?: Date;
  }): Promise<WeeklySchedulerRunResult> {
    if (this.isRunning && !options?.force) {
      console.warn('[WeeklyScheduler] Execution already in progress; skipping concurrent invocation.');
      return {
        timeZone: 'unknown',
        academicTermId: null,
        periodStartUtc: '',
        periodEndUtc: '',
        totalStudents: 0,
        newlyEnqueuedCount: 0,
        skippedInsufficientCount: 0,
        alreadyProcessedCount: 0,
        errorCount: 0,
        errors: [],
        skippedReason: 'Concurrent run in progress.',
      };
    }

    this.isRunning = true;
    const refTime = options?.referenceTime || new Date();

    try {
      // 1. Authoritative Timezone
      const timeZone = await this.getInstitutionTimezone();

      // 2. Deterministic UTC period boundaries
      const boundaries = this.computeWeeklyPeriod(refTime, timeZone);

      console.log(
        `[WeeklyScheduler] Evaluating weekly period for institution timezone "${timeZone}": ${boundaries.periodStartUtc} -> ${boundaries.periodEndUtc} (Sunday ${boundaries.localSundayDate} 21:00 local)`
      );

      const db = this.getDb();

      // 3. Resolve active academic term
      const { data: currentTerm, error: termErr } = await db
        .from('academic_terms')
        .select('id, code, name')
        .eq('is_current', true)
        .maybeSingle();

      if (termErr) {
        throw new Error(`Database error querying active academic term: ${termErr.message}`);
      }

      if (!currentTerm) {
        console.warn('[WeeklyScheduler] No active academic term (is_current = true) configured. Weekly scheduling suspended.');
        return {
          timeZone,
          academicTermId: null,
          periodStartUtc: boundaries.periodStartUtc,
          periodEndUtc: boundaries.periodEndUtc,
          totalStudents: 0,
          newlyEnqueuedCount: 0,
          skippedInsufficientCount: 0,
          alreadyProcessedCount: 0,
          errorCount: 0,
          errors: [],
          skippedReason: 'No active academic term configured.',
        };
      }

      // 4. Resolve active students
      const { data: students, error: studentsErr } = await db
        .from('profiles')
        .select('id')
        .eq('role', 'student')
        .eq('is_active', true);

      if (studentsErr) {
        throw new Error(`Database error querying active students: ${studentsErr.message}`);
      }

      const activeStudents = students || [];
      if (activeStudents.length === 0) {
        console.log('[WeeklyScheduler] No active students found in institution.');
        return {
          timeZone,
          academicTermId: currentTerm.id,
          periodStartUtc: boundaries.periodStartUtc,
          periodEndUtc: boundaries.periodEndUtc,
          totalStudents: 0,
          newlyEnqueuedCount: 0,
          skippedInsufficientCount: 0,
          alreadyProcessedCount: 0,
          errorCount: 0,
          errors: [],
          skippedReason: 'No active students found.',
        };
      }

      let newlyEnqueuedCount = 0;
      let skippedInsufficientCount = 0;
      let alreadyProcessedCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      // 5. Evaluate each student's weekly progress
      for (const student of activeStudents) {
        try {
          // Check if report already exists for this term & period
          const existing = await this.store.getWeeklyReport(
            student.id,
            currentTerm.id,
            boundaries.periodStartUtc,
            boundaries.periodEndUtc
          );

          if (existing) {
            // Requirement 2: If existing report is completed, processing, pending, or failed,
            // do not reset or duplicate it. Preserve existing retry and queue behavior.
            if (existing.status !== 'skipped_insufficient_data') {
              alreadyProcessedCount++;
              continue;
            }

            // Requirement 3: If existing report has status skipped_insufficient_data:
            // Reconstruct weekly feedback snapshot using the same reporting period and academic term.
            const snapshotResult = await this.analytics.constructWeeklyFeedbackSnapshot(
              student.id,
              currentTerm.id,
              boundaries.periodStartUtc,
              boundaries.periodEndUtc
            );

            // If snapshot remains ineligible, leave the report unchanged.
            if (!snapshotResult.isEligible || !snapshotResult.inputSnapshotHash) {
              alreadyProcessedCount++;
              continue;
            }

            // If it is now eligible because results were published later:
            // Call createOrGetWeeklyReport with the new snapshot hash.
            const { isNew } = await this.store.createOrGetWeeklyReport({
              studentId: student.id,
              academicTermId: currentTerm.id,
              periodStart: boundaries.periodStartUtc,
              periodEnd: boundaries.periodEndUtc,
              inputSnapshotHash: snapshotResult.inputSnapshotHash,
            });

            if (isNew) {
              newlyEnqueuedCount++;
            } else {
              alreadyProcessedCount++;
            }
            continue;
          }

          // Construct snapshot from authoritative published assessments only
          const snapshotResult = await this.analytics.constructWeeklyFeedbackSnapshot(
            student.id,
            currentTerm.id,
            boundaries.periodStartUtc,
            boundaries.periodEndUtc
          );

          if (snapshotResult.isEligible && snapshotResult.inputSnapshotHash) {
            // Eligible published assessment results exist: create/enqueue pending report
            const { isNew } = await this.store.createOrGetWeeklyReport({
              studentId: student.id,
              academicTermId: currentTerm.id,
              periodStart: boundaries.periodStartUtc,
              periodEnd: boundaries.periodEndUtc,
              inputSnapshotHash: snapshotResult.inputSnapshotHash,
            });

            if (isNew) {
              newlyEnqueuedCount++;
            } else {
              alreadyProcessedCount++;
            }
          } else {
            // Insufficient published assessment data in window: record skipped status
            const reason = snapshotResult.reason || 'Insufficient data: No published assessment results in window.';
            const { isNew } = await this.store.recordSkippedWeeklyReport({
              studentId: student.id,
              academicTermId: currentTerm.id,
              periodStart: boundaries.periodStartUtc,
              periodEnd: boundaries.periodEndUtc,
              reason,
            });

            if (isNew) {
              skippedInsufficientCount++;
            } else {
              alreadyProcessedCount++;
            }
          }
        } catch (studentErr: any) {
          errorCount++;
          const safeMessage = `Error processing weekly summary for student ${student.id.slice(0, 8)}...: ${studentErr.message || studentErr}`;
          errors.push(safeMessage);
          console.error(`[WeeklyScheduler] ${safeMessage}`);
        }
      }

      // 6. Trigger non-blocking queue processing if new reports were enqueued
      if (newlyEnqueuedCount > 0) {
        console.log(`[WeeklyScheduler] Kicking background AI queue worker for ${newlyEnqueuedCount} new weekly reports.`);
        this.queue.kick();
      }

      console.log(
        `[WeeklyScheduler] Completed run for term "${currentTerm.code}" (${boundaries.localSundayDate}): total=${activeStudents.length}, enqueued=${newlyEnqueuedCount}, skipped=${skippedInsufficientCount}, existing=${alreadyProcessedCount}, errors=${errorCount}`
      );

      return {
        timeZone,
        academicTermId: currentTerm.id,
        periodStartUtc: boundaries.periodStartUtc,
        periodEndUtc: boundaries.periodEndUtc,
        totalStudents: activeStudents.length,
        newlyEnqueuedCount,
        skippedInsufficientCount,
        alreadyProcessedCount,
        errorCount,
        errors,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Starts periodic polling and triggers startup catch-up execution.
   */
  public start(pollIntervalMs: number = 300000): void {
    if (this.timer) {
      return;
    }

    console.log(`[WeeklyScheduler] Service started with poll interval ${Math.round(pollIntervalMs / 1000)}s.`);

    // Startup Catch-Up Check: trigger immediate run if Sunday 21:00 has passed and pending students remain
    this.processWeeklyRun().catch((err) => {
      console.error('[WeeklyScheduler] Startup recovery error:', err.message || err);
    });

    // Periodic Background Polling
    this.timer = setInterval(() => {
      this.processWeeklyRun().catch((err) => {
        console.error('[WeeklyScheduler] Periodic tick error:', err.message || err);
      });
    }, pollIntervalMs);

    // Unref timer so it does not block Node process termination in CLI/test runners
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Gracefully stops the periodic background timer.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[WeeklyScheduler] Service stopped.');
    }
  }
}

export const weeklySchedulerService = new WeeklySchedulerService();

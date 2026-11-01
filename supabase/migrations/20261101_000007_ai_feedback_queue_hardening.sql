-- ==============================================================================
-- Migration: 20261101_000007_ai_feedback_queue_hardening.sql
-- Description: Phase 4A Step 5.2.1 AI Feedback Queue Reliability Hardening:
--   1. Adds next_retry_at to support persistent exponential backoff and prevent
--      head-of-line blocking.
--   2. Adds locked_by (worker instance identifier) to guarantee worker lease ownership.
--   3. Adds lease_expires_at to formalize lease expiration and prevent stale worker
--      overwrites.
--   4. Backfills existing pending/failed records with immediate retry availability.
--   5. Adds targeted partial indexes for high-throughput queue polling.
-- ==============================================================================

-- 1. Add queue hardening columns with safe defaults and nullability
ALTER TABLE public.ai_feedback_reports
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS locked_by TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.ai_feedback_reports.next_retry_at IS
  'Timestamp when the report becomes eligible for next pickup/retry. Default is now() for pending work, null for terminal states.';

COMMENT ON COLUMN public.ai_feedback_reports.locked_by IS
  'Unique identifier of the worker instance currently holding the processing lease. Null when not locked.';

COMMENT ON COLUMN public.ai_feedback_reports.lease_expires_at IS
  'Timestamp after which the processing lease is considered abandoned and eligible for reclamation. Null when not processing.';

-- 2. Backfill existing pending/failed rows if next_retry_at is null
UPDATE public.ai_feedback_reports
  SET next_retry_at = timezone('utc'::text, now())
  WHERE status IN ('pending', 'failed') AND next_retry_at IS NULL;

-- 3. Targeted partial indexes for queue polling & head-of-line blocking prevention
-- Enables efficient query for next eligible pending or failed retry jobs:
-- WHERE status IN ('pending', 'failed') AND next_retry_at <= now()
CREATE INDEX IF NOT EXISTS idx_feedback_queue_eligible_retries
  ON public.ai_feedback_reports (status, next_retry_at, created_at)
  WHERE status IN ('pending', 'failed');

-- Enables fast detection of expired processing leases:
-- WHERE status = 'processing' AND lease_expires_at <= now()
CREATE INDEX IF NOT EXISTS idx_feedback_queue_expired_leases
  ON public.ai_feedback_reports (status, lease_expires_at)
  WHERE status = 'processing';


/** Returns whether this process should start its database-writing background workers. */
export function shouldStartBackgroundJobs(env: Record<string, string | undefined> = process.env): boolean {
  return env.DISABLE_BACKGROUND_JOBS !== 'true';
}

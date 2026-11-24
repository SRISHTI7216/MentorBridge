import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldStartBackgroundJobs } from '../server/src/backgroundJobsMode.js';

assert.equal(shouldStartBackgroundJobs({}), true, 'background jobs remain enabled when the flag is absent');
assert.equal(shouldStartBackgroundJobs({ DISABLE_BACKGROUND_JOBS: 'false' }), true, 'false preserves normal startup behavior');
assert.equal(shouldStartBackgroundJobs({ DISABLE_BACKGROUND_JOBS: 'TRUE' }), true, 'only the exact lowercase true value disables jobs');
assert.equal(shouldStartBackgroundJobs({ DISABLE_BACKGROUND_JOBS: 'true' }), false, 'exact true disables background jobs');

const indexSource = readFileSync('server/src/index.ts', 'utf8');
const gatePosition = indexSource.indexOf('if (shouldStartBackgroundJobs())');
const queueStartPosition = indexSource.indexOf('aiFeedbackQueue.recoverAndProcess()');
const schedulerStartPosition = indexSource.indexOf('weeklySchedulerService.start()');
const healthRoutePosition = indexSource.indexOf("app.get('/api/health'");
const listenPosition = indexSource.indexOf('app.listen(PORT');

assert(gatePosition >= 0 && queueStartPosition > gatePosition, 'queue recovery is behind the startup gate');
assert(schedulerStartPosition > gatePosition, 'weekly scheduler startup is behind the startup gate');
assert(healthRoutePosition >= 0 && healthRoutePosition < listenPosition, 'health endpoint remains registered before the server listens');
assert(indexSource.includes('Background jobs are disabled for this process.'), 'disabled mode logs a clear, secret-free message');

console.log('Backend startup gating verification passed.');

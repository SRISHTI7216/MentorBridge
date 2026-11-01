import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { isSupabaseAdminConfigured, supabaseAdmin } from './lib/supabaseAdmin.js';
import adminRoutes from './routes/adminRoutes.js';
import assessmentRoutes from './routes/assessmentRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import { aiFeedbackQueue } from './services/aiFeedbackQueue.js';
import { weeklySchedulerService } from './services/weeklySchedulerService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Administrative API Routes (Secured by Admin Bearer Auth)
app.use('/api/admin', adminRoutes);

// Weekly Assessment Engine API Routes (Secured by Role Auth)
app.use('/api/assessments', assessmentRoutes);

// Student & Mentor Analytics API Routes (Secured by Role Auth)
app.use('/api/analytics', analyticsRoutes);

// Backend Healthcheck
app.get('/api/health', async (_req: Request, res: Response) => {
  const configured = isSupabaseAdminConfigured();
  let dbStatus = configured ? 'configured' : 'unconfigured_placeholder';

  if (configured && supabaseAdmin) {
    try {
      const { error } = await supabaseAdmin.from('profiles').select('id').limit(1);
      if (error) {
        dbStatus = `connected_with_error: ${error.message}`;
      } else {
        dbStatus = 'connected_verified';
      }
    } catch (err: unknown) {
      dbStatus = `unreachable: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  res.json({
    status: 'ok',
    service: 'MentorBridge Backend API',
    phase: 'Phase 2 - Supabase Integration & RBAC',
    timestamp: new Date().toISOString(),
    database: dbStatus,
    adminClientAvailable: configured,
    // Note: NEVER output service role keys or secrets in responses or logs
  });
});

app.get('/api/version', (_req: Request, res: Response) => {
  res.json({
    version: '0.2.0-alpha',
    environment: process.env.NODE_ENV || 'development',
  });
});

// Start Server
if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, () => {
    console.log(`[MentorBridge Server] API running on http://localhost:${PORT}`);
    // Recover any abandoned jobs or expired leases upon server startup
    aiFeedbackQueue.recoverAndProcess().catch((err) => {
      console.error('[MentorBridge Server] Error recovering AI feedback queue:', err);
    });
    // Start automated weekly AI progress feedback scheduler
    weeklySchedulerService.start();
  });

  const gracefulShutdown = () => {
    console.log('[MentorBridge Server] Initiating graceful shutdown...');
    weeklySchedulerService.stop();
    server.close(() => {
      console.log('[MentorBridge Server] Closed remaining connections.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

export default app;

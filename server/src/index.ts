import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { isSupabaseAdminConfigured, supabaseAdmin } from './lib/supabaseAdmin.js';
import adminRoutes from './routes/adminRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Administrative API Routes (Secured by Admin Bearer Auth)
app.use('/api/admin', adminRoutes);

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
  app.listen(PORT, () => {
    console.log(`[MentorBridge Server] API running on http://localhost:${PORT}`);
  });
}

export default app;

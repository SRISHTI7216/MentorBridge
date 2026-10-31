import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin.js';

export interface AdminRequest extends Request {
  adminUser?: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
}

export const requireAdminAuth = async (
  req: AdminRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!isSupabaseAdminConfigured() || !supabaseAdmin) {
    res.status(503).json({
      error: 'Backend database service is not configured. Check environment variables.',
    });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized: Authentication token missing or invalid format. Please log in as an administrator.',
    });
    return;
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    res.status(401).json({
      error: 'Unauthorized: Empty authorization token provided.',
    });
    return;
  }

  try {
    // 1. Verify token with Supabase Auth
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !userData?.user) {
      res.status(401).json({
        error: 'Unauthorized: Invalid or expired session token.',
        details: userError?.message,
      });
      return;
    }

    const userId = userData.user.id;

    // 2. Query trusted profiles table for role and active status
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, name, email, role, is_active')
      .eq('id', userId)
      .maybeSingle();

    if (profileError || !profile) {
      res.status(403).json({
        error: 'Forbidden: User profile not found in institutional records.',
      });
      return;
    }

    if (!profile.is_active) {
      res.status(403).json({
        error: 'Forbidden: Account has been deactivated. Contact the system administrator.',
      });
      return;
    }

    if (profile.role !== 'admin') {
      res.status(403).json({
        error: `Forbidden: Administrative privileges required. Current role: '${profile.role}'.`,
      });
      return;
    }

    // Attach verified admin context to request
    req.adminUser = {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      role: profile.role,
    };

    next();
  } catch (err: unknown) {
    console.error('[requireAdminAuth] Verification error:', err);
    res.status(500).json({
      error: 'Internal server error verifying administrator authorization.',
    });
  }
};


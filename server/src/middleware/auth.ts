import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: 'student' | 'mentor' | 'admin';
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  adminUser?: AuthenticatedUser;
}

export interface AdminRequest extends AuthenticatedRequest {}

/**
 * Verifies bearer JWT token and attaches user profile to request
 */
export const requireAuth = async (
  req: AuthenticatedRequest,
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
      error: 'Unauthorized: Authentication token missing or invalid format.',
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
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !userData?.user) {
      res.status(401).json({
        error: 'Unauthorized: Invalid or expired session token.',
        details: userError?.message,
      });
      return;
    }

    const userId = userData.user.id;

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

    req.user = {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      role: profile.role as 'student' | 'mentor' | 'admin',
    };

    if (profile.role === 'admin') {
      req.adminUser = req.user;
    }

    next();
  } catch (err: unknown) {
    console.error('[requireAuth] Verification error:', err);
    res.status(500).json({
      error: 'Internal server error verifying authorization.',
    });
  }
};

/**
 * Requires verified mentor or administrator privileges
 */
export const requireMentorOrAdmin = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  await requireAuth(req, res, () => {
    if (!req.user || (req.user.role !== 'mentor' && req.user.role !== 'admin')) {
      res.status(403).json({
        error: `Forbidden: Faculty Mentor privileges required. Current role: '${req.user?.role}'.`,
      });
      return;
    }
    next();
  });
};

/**
 * Requires verified student privileges
 */
export const requireStudent = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  await requireAuth(req, res, () => {
    if (!req.user || req.user.role !== 'student') {
      res.status(403).json({
        error: `Forbidden: Student privileges required. Current role: '${req.user?.role}'.`,
      });
      return;
    }
    next();
  });
};

/**
 * Enforces strict administrator authentication across all administrative routes
 */
export const requireAdminAuth = async (
  req: AdminRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  await requireAuth(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      res.status(403).json({
        error: `Forbidden: Administrative privileges required. Current role: '${req.user?.role}'.`,
      });
      return;
    }
    req.adminUser = req.user;
    next();
  });
};

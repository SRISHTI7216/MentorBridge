import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const rawUrl = process.env.SUPABASE_URL || '';
// Clean trailing /rest/v1/ or slashes if provided in environment configuration
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '').trim();
const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

export const isSupabaseAdminConfigured = (): boolean => {
  return (
    Boolean(supabaseUrl) &&
    Boolean(supabaseServiceRoleKey) &&
    !supabaseUrl.includes('your-project') &&
    !supabaseServiceRoleKey.includes('placeholder')
  );
};

// Admin client with privileged service role.
// Strictly confined to backend server processes; never exposed to browser or client bundles.
export const supabaseAdmin: SupabaseClient | null = isSupabaseAdminConfigured()
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;


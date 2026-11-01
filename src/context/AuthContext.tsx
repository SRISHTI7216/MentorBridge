import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { AuthContextType, UserProfile, UserRole } from '../types/auth';
import { fetchUserProfile } from '../services/dataService';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const configured = isSupabaseConfigured();

  // Helper to load profile once session user is established
  const loadProfileForUser = async (userId: string) => {
    try {
      const userProfile = await fetchUserProfile(userId);
      if (userProfile && userProfile.isActive) {
        setProfile(userProfile);
        setRole(userProfile.role);
        return userProfile;
      } else {
        setProfile(null);
        setRole(null);
        return null;
      }
    } catch (err) {
      console.error('[AuthProvider] Failed to load user profile:', err);
      setProfile(null);
      setRole(null);
      return null;
    }
  };

  useEffect(() => {
    let isMounted = true;

    const initializeAuth = async () => {
      if (!configured) {
        setIsLoading(false);
        return;
      }

      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          console.warn('[AuthProvider] Initial session fetch error:', sessionError.message);
        }

        if (session?.user && isMounted) {
          setUser({ id: session.user.id, email: session.user.email });
          await loadProfileForUser(session.user.id);
        } else if (isMounted) {
          setUser(null);
          setProfile(null);
          setRole(null);
        }
      } catch (err) {
        console.error('[AuthProvider] Error restoring session:', err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    initializeAuth();

    if (configured) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (_event, session) => {
          if (!isMounted) return;

          if (session?.user) {
            setUser({ id: session.user.id, email: session.user.email });
            await loadProfileForUser(session.user.id);
          } else {
            setUser(null);
            setProfile(null);
            setRole(null);
          }
          setIsLoading(false);
        }
      );

      return () => {
        isMounted = false;
        subscription.unsubscribe();
      };
    } else {
      return () => {
        isMounted = false;
      };
    }
  }, [configured]);

  const signIn = async (email: string, password: string): Promise<{ error: Error | null; role?: UserRole }> => {
    setError(null);
    if (!configured) {
      const err = new Error('Supabase is not configured. Please supply VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.');
      setError(err.message);
      return { error: err };
    }

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        return { error: signInError };
      }

      if (!data.user) {
        const err = new Error('No user data returned from authentication service.');
        setError(err.message);
        return { error: err };
      }

      setUser({ id: data.user.id, email: data.user.email });
      const loadedProfile = await loadProfileForUser(data.user.id);

      if (!loadedProfile) {
        const err = new Error('Account profile not found or inactive. Please contact your department coordinator.');
        setError(err.message);
        return { error: err };
      }

      return { error: null, role: loadedProfile.role };
    } catch (err: any) {
      const message = err?.message || 'Authentication error occurred.';
      setError(message);
      return { error: new Error(message) };
    }
  };

  const signOut = async (): Promise<void> => {
    if (configured) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.error('[AuthProvider] SignOut error:', err);
      }
    }
    setUser(null);
    setProfile(null);
    setRole(null);
    setError(null);
  };

  const resetPassword = async (email: string): Promise<{ error: Error | null; success?: boolean }> => {
    if (!configured) {
      const err = new Error('Supabase is not configured. Please provide VITE_SUPABASE_URL in .env.');
      return { error: err };
    }

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback`,
      });

      if (resetError) {
        return { error: resetError };
      }

      return { error: null, success: true };
    } catch (err: any) {
      return { error: new Error(err?.message || 'Password reset request failed.') };
    }
  };

  const refreshProfile = async (): Promise<void> => {
    if (user?.id) {
      await loadProfileForUser(user.id);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        role,
        isLoading,
        error,
        isConfigured: configured,
        signIn,
        signOut,
        resetPassword,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};


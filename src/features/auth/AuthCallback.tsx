import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { APP_CONFIG } from '../../lib/constants';
import { useAuth } from '../../context/AuthContext';
import { fetchUserProfile } from '../../services/dataService';
import { UserRole } from '../../types/auth';

type CallbackState = 'loading' | 'error' | 'set_password' | 'success';

export const AuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const { refreshProfile, isConfigured } = useAuth();

  const [state, setState] = useState<CallbackState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [userName, setUserName] = useState<string>('');
  const [userRole, setUserRole] = useState<UserRole | null>(null);

  // Form State
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    const processAuthToken = async () => {
      if (!isConfigured) {
        if (isMounted) {
          setErrorMessage('Supabase is not configured. Please verify your environment settings.');
          setState('error');
        }
        return;
      }

      // 1. Inspect URL hash fragment and search parameters for errors
      const rawHash = window.location.hash.startsWith('#')
        ? window.location.hash.substring(1)
        : window.location.hash;
      const hashParams = new URLSearchParams(rawHash);
      const queryParams = new URLSearchParams(window.location.search);

      const error = hashParams.get('error') || queryParams.get('error');
      const errorCode = hashParams.get('error_code') || queryParams.get('error_code');
      const errorDesc =
        hashParams.get('error_description') ||
        queryParams.get('error_description') ||
        hashParams.get('error_msg');

      if (error || errorCode) {
        if (isMounted) {
          const humanizedDesc = errorDesc
            ? decodeURIComponent(errorDesc.replace(/\+/g, ' '))
            : errorCode === 'otp_expired'
            ? 'This invitation link has expired or has already been used.'
            : 'Access denied: The authentication link is invalid.';
          setErrorMessage(humanizedDesc);
          setState('error');
        }
        return;
      }

      // 2. Handle PKCE authorization code if present
      const code = queryParams.get('code');
      if (code) {
        try {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            if (isMounted) {
              setErrorMessage(exchangeError.message);
              setState('error');
            }
            return;
          }
        } catch (err: any) {
          if (isMounted) {
            setErrorMessage(err?.message || 'Failed to exchange authorization token.');
            setState('error');
          }
          return;
        }
      }

      // 3. Inspect established session (Supabase client auto-parses hash fragments on load)
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          if (isMounted) {
            setErrorMessage(sessionError.message);
            setState('error');
          }
          return;
        }

        let currentUser = session?.user;

        // If session not yet populated in storage, check getUser()
        if (!currentUser) {
          const { data: userData } = await supabase.auth.getUser();
          currentUser = userData?.user || undefined;
        }

        // Allow a brief settling period for onAuthStateChange if necessary
        if (!currentUser) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          const { data: retryData } = await supabase.auth.getSession();
          currentUser = retryData?.session?.user;
        }

        if (!currentUser) {
          if (isMounted) {
            setErrorMessage(
              'No active authentication session detected. Your invitation link may have expired or was already verified. Please request a new invitation from your department coordinator.'
            );
            setState('error');
          }
          return;
        }

        // Fetch user profile from database to get their assigned institutional role
        const profile = await fetchUserProfile(currentUser.id);

        if (!isMounted) return;

        setUserEmail(currentUser.email || '');
        setUserName(profile?.name || currentUser.user_metadata?.name || 'Academic Member');
        setUserRole((profile?.role || currentUser.user_metadata?.role || 'student') as UserRole);
        setState('set_password');
      } catch (err: any) {
        if (isMounted) {
          console.error('[AuthCallback] Session processing error:', err);
          setErrorMessage(err?.message || 'An unexpected error occurred while verifying your session.');
          setState('error');
        }
      }
    };

    processAuthToken();

    return () => {
      isMounted = false;
    };
  }, [isConfigured]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (password.length < 8) {
      setFormError('Password must be at least 8 characters in length.');
      return;
    }

    if (password !== confirmPassword) {
      setFormError('Passwords do not match. Please verify your entries.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Update the user's password in Supabase Auth
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      });

      if (updateError) {
        setFormError(updateError.message);
        setIsSubmitting(false);
        return;
      }

      // Refresh application auth context so profiles and permissions update
      await refreshProfile();

      setState('success');

      // Determine redirect path strictly from the database role
      const destination =
        userRole === 'mentor'
          ? '/mentor/dashboard'
          : userRole === 'admin'
          ? '/admin/dashboard'
          : '/student/dashboard';

      setTimeout(() => {
        navigate(destination, { replace: true });
      }, 1200);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to update institutional password.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col justify-between selection:bg-primary-fixed selection:text-primary">
      {/* Top Bar */}
      <header className="bg-surface border-b border-outline-variant shadow-sm z-30">
        <div className="flex justify-between items-center w-full px-6 py-3 max-w-7xl mx-auto">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-primary text-white flex items-center justify-center shadow-sm">
              <span className="material-symbols-outlined text-[24px]">school</span>
            </div>
            <div>
              <span className="font-display text-lg font-bold text-primary block leading-tight">
                {APP_CONFIG.name}
              </span>
              <span className="text-xs text-on-surface-variant flex items-center gap-1.5">
                {APP_CONFIG.department}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Link
              to="/login"
              className="text-xs font-semibold text-primary hover:text-primary-dim transition-colors flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Return to Login
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          {/* STATE 1: LOADING */}
          {state === 'loading' && (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-8 shadow-sm text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-primary text-white flex items-center justify-center mx-auto shadow-md animate-pulse">
                <span className="material-symbols-outlined text-3xl">verified_user</span>
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-bold text-on-surface font-display">
                  Verifying Institutional Invitation
                </h2>
                <p className="text-xs text-on-surface-variant">
                  Establishing secure cryptographic session with Supabase...
                </p>
              </div>
              <div className="w-48 h-1 bg-surface-container rounded-full overflow-hidden mx-auto mt-4">
                <div className="w-full h-full bg-primary animate-indeterminate" />
              </div>
            </div>
          )}

          {/* STATE 2: ERROR / EXPIRED / INVALID LINK */}
          {state === 'error' && (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-8 shadow-sm space-y-6">
              <div className="flex items-center gap-3 pb-4 border-b border-outline-variant">
                <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-2xl">error</span>
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 font-display">
                    Invitation Link Expired or Invalid
                  </h2>
                  <span className="text-[11px] font-mono text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200/60 inline-block mt-0.5">
                    LINK INVALIDATED
                  </span>
                </div>
              </div>

              {/* Error Detail */}
              <div className="p-4 rounded-xl bg-rose-50/80 border border-rose-200 text-rose-900 text-xs space-y-2">
                <p className="font-semibold text-rose-950 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-rose-700">warning</span>
                  Verification Unsuccessful
                </p>
                <p className="text-[11px] leading-relaxed text-rose-800">
                  {errorMessage || 'The invitation link has expired, was previously used, or is malformed.'}
                </p>
              </div>

              {/* Institutional Guidance */}
              <div className="bg-surface-container-low rounded-xl p-4 border border-outline-variant text-xs space-y-2.5">
                <p className="font-semibold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-primary text-base">info</span>
                  Why did this happen?
                </p>
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-on-surface-variant leading-relaxed">
                  <li>Invitation links are strictly single-use and expire for institutional security.</li>
                  <li>If you already configured your credentials, you can log in directly.</li>
                  <li>If your link expired before use, your department coordinator can issue a fresh invitation.</li>
                </ul>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-2">
                <Link
                  to="/login"
                  className="w-full py-2.5 px-4 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary-dim transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  <span className="material-symbols-outlined text-base">login</span>
                  Go to Institutional Sign-In
                </Link>

                <a
                  href={`mailto:${APP_CONFIG.supportEmail}?subject=${encodeURIComponent(
                    'MentorBridge Invitation Link Request'
                  )}&body=${encodeURIComponent(
                    'Hello CSE Coordinator,\n\nMy MentorBridge invitation link has expired or is invalid. Please generate and re-send a fresh invitation for my institutional account.\n\nThank you.'
                  )}`}
                  className="w-full py-2.5 px-4 bg-surface-container border border-outline-variant text-on-surface text-xs font-semibold rounded-xl hover:bg-surface-container-high transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-base">mail</span>
                  Request Fresh Link via Department Coordinator
                </a>

                <Link
                  to="/forgot-password"
                  className="w-full py-2 px-4 text-center text-xs text-on-surface-variant hover:text-primary transition-colors block"
                >
                  Already activated your account? Reset Password
                </Link>
              </div>
            </div>
          )}

          {/* STATE 3: SET PASSWORD */}
          {state === 'set_password' && (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-8 shadow-sm space-y-6">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary">
                  <span className="material-symbols-outlined text-xs">how_to_reg</span>
                  Account Activation
                </div>
                <h2 className="text-xl font-bold text-on-surface font-display">
                  Set Your Institutional Password
                </h2>
                <p className="text-xs text-on-surface-variant">
                  Welcome to {APP_CONFIG.name}. Please configure your account credentials to access your academic portal.
                </p>
              </div>

              {/* User Identity Card */}
              <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                      {userName.charAt(0) || 'U'}
                    </div>
                    <div>
                      <p className="font-bold text-on-surface">{userName}</p>
                      <p className="text-[11px] font-mono text-on-surface-variant">{userEmail}</p>
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                      userRole === 'mentor'
                        ? 'bg-emerald-100 text-emerald-800'
                        : userRole === 'admin'
                        ? 'bg-indigo-100 text-indigo-800'
                        : 'bg-sky-100 text-sky-800'
                    }`}
                  >
                    {userRole === 'mentor' ? 'Faculty Mentor' : userRole === 'admin' ? 'Coordinator' : 'Student'}
                  </span>
                </div>
              </div>

              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm text-rose-700">error</span>
                  <span>{formError}</span>
                </div>
              )}

              {/* Password Form */}
              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-on-surface mb-1.5">
                    New Institutional Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      className="w-full px-3.5 py-2.5 pr-10 text-xs rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                    >
                      <span className="material-symbols-outlined text-base">
                        {showPassword ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-on-surface mb-1.5">
                    Confirm Password
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-type your password"
                    className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono"
                  />
                </div>

                {/* Password Criteria */}
                <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant text-[11px] text-on-surface-variant space-y-1">
                  <p className="font-semibold text-on-surface">Institutional Password Requirements:</p>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`material-symbols-outlined text-[13px] ${
                        password.length >= 8 ? 'text-emerald-600' : 'text-slate-400'
                      }`}
                    >
                      {password.length >= 8 ? 'check_circle' : 'circle'}
                    </span>
                    <span>Minimum of 8 characters</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`material-symbols-outlined text-[13px] ${
                        password && confirmPassword && password === confirmPassword
                          ? 'text-emerald-600'
                          : 'text-slate-400'
                      }`}
                    >
                      {password && confirmPassword && password === confirmPassword
                        ? 'check_circle'
                        : 'circle'}
                    </span>
                    <span>Both passwords must match</span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || password.length < 8 || password !== confirmPassword}
                  className="w-full py-2.5 px-4 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
                >
                  {isSubmitting ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Activating Account...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-base">check</span>
                      Set Password & Enter Portal
                    </>
                  )}
                </button>
              </form>
            </div>
          )}

          {/* STATE 4: SUCCESS */}
          {state === 'success' && (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-8 shadow-sm text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500 text-white flex items-center justify-center mx-auto shadow-md">
                <span className="material-symbols-outlined text-3xl">task_alt</span>
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-on-surface font-display">
                  Account Activated Successfully!
                </h2>
                <p className="text-xs text-on-surface-variant">
                  Your institutional password has been securely saved.
                </p>
              </div>
              <p className="text-xs text-primary font-semibold animate-pulse pt-2">
                Redirecting to your {userRole === 'mentor' ? 'Faculty Mentor' : 'Student'} Workspace...
              </p>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full py-4 px-6 border-t border-outline-variant bg-surface text-center">
        <p className="text-xs text-on-surface-variant font-mono">
          {APP_CONFIG.name} • {APP_CONFIG.institution} • {APP_CONFIG.accreditation}
        </p>
      </footer>
    </div>
  );
};


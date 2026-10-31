import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { APP_CONFIG } from '../../lib/constants';
import { useAuth } from '../../context/AuthContext';

export const ForgotPassword: React.FC = () => {
  const { resetPassword, isConfigured } = useAuth();
  const [identifier, setIdentifier] = useState('alex.chen@engg.edu');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!identifier.trim()) {
      setErrorMessage('Please enter your institutional email address.');
      return;
    }

    setIsLoading(true);

    try {
      const result = await resetPassword(identifier.trim());
      if (result.error) {
        setErrorMessage(result.error.message || 'Unable to dispatch recovery link.');
      } else {
        setIsSubmitted(true);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to dispatch recovery link.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col justify-between selection:bg-primary-fixed selection:text-primary">
      {/* Top Header */}
      <header className="bg-surface border-b border-outline-variant shadow-sm w-full sticky top-0 z-50">
        <div className="flex justify-between items-center w-full px-6 py-3 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary text-white flex items-center justify-center font-bold shadow-sm">
              <span className="material-symbols-outlined">school</span>
            </div>
            <div>
              <span className="font-display text-lg font-bold text-primary tracking-tight">
                {APP_CONFIG.name}
              </span>
              <span className="hidden sm:inline-block text-outline-variant mx-2">|</span>
              <span className="hidden sm:inline-block text-xs text-on-surface-variant font-medium">
                {APP_CONFIG.department}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-xs font-semibold text-primary border border-outline-variant bg-surface-container-lowest px-3 py-1.5 rounded-lg hover:bg-surface-container transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              <span>Back to Sign In</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Recovery Content Area */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        {!isConfigured && (
          <div className="mb-6 max-w-4xl mx-auto p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-3 shadow-xs">
            <span className="material-symbols-outlined text-amber-700 text-xl shrink-0 mt-0.5">warning</span>
            <div>
              <p className="font-bold text-amber-950">Supabase Auth Not Configured</p>
              <p className="mt-0.5 leading-relaxed">
                Password recovery links require configured Supabase project settings. Please configure <code className="bg-amber-100 px-1 py-0.5 rounded font-mono text-[11px]">VITE_SUPABASE_URL</code> in your <code className="bg-amber-100 px-1 py-0.5 rounded font-mono text-[11px]">.env</code> file.
              </p>
            </div>
          </div>
        )}

        {/* Verification Gate Banner */}
        <div className="mb-8 p-4 rounded-xl border border-tertiary-container/30 bg-emerald-50/50 flex items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-700 text-white flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[18px]">verified_user</span>
            </div>
            <div>
              <p className="text-xs text-emerald-900 font-semibold">Institutional Validation Gate Active</p>
              <p className="text-[11px] text-on-surface-variant">
                Self-service verification links are dispatched securely via Supabase Auth.
              </p>
            </div>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 bg-surface-container-lowest rounded border border-outline-variant text-on-surface-variant">
            TLS 1.3 ENCRYPTED
          </span>
        </div>

        {/* Two-Column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Guidelines & Contact Info */}
          <aside className="lg:col-span-5 space-y-6">
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-2 pb-3 border-b border-surface-container">
                <span className="material-symbols-outlined text-primary text-[20px]">shield</span>
                <h2 className="text-sm font-bold text-on-surface">Institutional Security Policy</h2>
              </div>
              <ul className="mt-4 space-y-3.5 text-xs">
                <li className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-tertiary text-[18px] mt-0.5">verified</span>
                  <div>
                    <p className="font-semibold text-on-surface">Directory Cross-Verification</p>
                    <p className="text-on-surface-variant text-[11px]">
                      All reset requests must rigorously validate against the active University Registrar and Department HR Directory.
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-primary text-[18px] mt-0.5">schedule</span>
                  <div>
                    <p className="font-semibold text-on-surface">Strict Link Expiry</p>
                    <p className="text-on-surface-variant text-[11px]">
                      Self-service token links invalidate post-dispatch to defend against institutional spoofing.
                    </p>
                  </div>
                </li>
              </ul>
            </div>

            {/* Helpdesk Card */}
            <div className="bg-surface-container-low border border-outline-variant rounded-xl p-5 shadow-sm text-xs">
              <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[19px]">headset_mic</span>
                  <h3 className="font-bold text-on-surface">CSE Systems Helpdesk</h3>
                </div>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-medium">
                  On-Duty
                </span>
              </div>
              <p className="text-on-surface-variant text-[11px] mt-3">
                If you are locked out of two-factor authentication or cannot access your institutional mailbox, visit the systems lab in person with your campus ID card.
              </p>
              <div className="mt-3 pt-3 border-t border-outline-variant space-y-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-on-surface-variant">Email:</span>
                  <span className="font-mono text-primary font-medium">{APP_CONFIG.supportEmail}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-on-surface-variant">Office:</span>
                  <span className="font-medium text-on-surface">{APP_CONFIG.helpdeskRoom}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-on-surface-variant">Campus Ext:</span>
                  <span className="font-mono font-medium text-on-surface">{APP_CONFIG.helpdeskExt}</span>
                </div>
              </div>
            </div>
          </aside>

          {/* Right Column: Reset Card */}
          <section className="lg:col-span-7">
            <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 sm:p-8 shadow-sm">
              <div className="text-left mb-6">
                <h1 className="font-display text-2xl font-bold text-on-surface tracking-tight">
                  Reset Account Credentials
                </h1>
                <p className="text-xs text-on-surface-variant mt-1">
                  Enter your verified institutional email to receive a secure password recovery link.
                </p>
              </div>

              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-on-surface flex items-center gap-1" htmlFor="identifier">
                      <span>Institutional Email</span>
                      <span className="text-error">*</span>
                    </label>
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-on-surface-variant">
                      <span className="material-symbols-outlined text-[18px]">alternate_email</span>
                    </div>
                    <input
                      id="identifier"
                      type="email"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      required
                      placeholder="e.g. alex.chen@engg.edu"
                      className="block w-full pl-10 pr-4 py-2.5 bg-surface-container-lowest border border-outline-variant rounded-lg text-xs text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                    />
                  </div>
                </div>

                {errorMessage && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
                    <span className="material-symbols-outlined text-[16px] text-red-600 mt-0.5">error</span>
                    <span className="flex-1">{errorMessage}</span>
                  </div>
                )}

                {isSubmitted && (
                  <div className="p-4 rounded-lg bg-indigo-50/70 border border-indigo-200 flex items-start gap-3 text-xs">
                    <span className="material-symbols-outlined text-primary text-[20px] mt-0.5">mark_email_read</span>
                    <div>
                      <p className="font-semibold text-primary">Verification link dispatched to institutional inbox</p>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        Please check your inbox ({identifier}) and follow the instructions to securely reset your credentials.
                      </p>
                    </div>
                  </div>
                )}

                <div className="pt-2 space-y-2">
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-hover transition-colors shadow-sm disabled:opacity-60"
                  >
                    {isLoading ? (
                      <>
                        <span className="animate-spin material-symbols-outlined text-[16px]">progress_activity</span>
                        <span>Dispatching Token...</span>
                      </>
                    ) : (
                      <>
                        <span>Send Secure Recovery Link</span>
                        <span className="material-symbols-outlined text-[16px]">send</span>
                      </>
                    )}
                  </button>
                  <Link
                    to="/login"
                    className="w-full inline-flex items-center justify-center gap-2 px-6 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">keyboard_backspace</span>
                    <span>Return to Sign In</span>
                  </Link>
                </div>
              </form>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

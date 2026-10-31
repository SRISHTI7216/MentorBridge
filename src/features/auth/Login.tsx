import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { APP_CONFIG } from '../../lib/constants';
import { useAuth } from '../../context/AuthContext';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, role, signIn, isConfigured } = useAuth();

  const [selectedRolePill, setSelectedRolePill] = useState<'student' | 'mentor' | 'coordinator'>('student');
  const [email, setEmail] = useState('alex.chen@engg.edu');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // If already authenticated, redirect directly to user's assigned dashboard
  useEffect(() => {
    if (user && role) {
      const from = (location.state as any)?.from?.pathname;
      if (from && from !== '/login') {
        navigate(from, { replace: true });
      } else if (role === 'mentor') {
        navigate('/mentor/dashboard', { replace: true });
      } else if (role === 'admin') {
        navigate('/admin/dashboard', { replace: true });
      } else {
        navigate('/student/dashboard', { replace: true });
      }
    }
  }, [user, role, navigate, location]);

  const handleRolePillClick = (targetRole: 'student' | 'mentor' | 'coordinator') => {
    setSelectedRolePill(targetRole);
    if (targetRole === 'student') {
      setEmail('alex.chen@engg.edu');
    } else if (targetRole === 'mentor') {
      setEmail('alan.vance@cse.univ.edu');
    } else {
      setEmail('admin.coordinator@engg.edu');
    }
    setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!email.trim() || !password) {
      setErrorMessage('Please provide both institutional email and password.');
      return;
    }

    setIsLoading(true);

    try {
      const result = await signIn(email.trim(), password);

      if (result.error) {
        setErrorMessage(result.error.message || 'Authentication failed. Please verify institutional credentials.');
        setIsLoading(false);
        return;
      }

      // Successful sign in: redirect to destination or role dashboard
      const userRole = result.role;
      const from = (location.state as any)?.from?.pathname;

      if (from && from !== '/login') {
        navigate(from, { replace: true });
      } else if (userRole === 'mentor') {
        navigate('/mentor/dashboard', { replace: true });
      } else if (userRole === 'admin') {
        navigate('/admin/dashboard', { replace: true });
      } else {
        navigate('/student/dashboard', { replace: true });
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'An unexpected error occurred during institutional sign-in.');
    } finally {
      setIsLoading(false);
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
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-outline-variant"></span>
                <span className="text-tertiary font-medium">Accredited Academic Portal</span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container-lowest border border-outline-variant text-on-surface-variant text-xs">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-tertiary"></span>
              </span>
              <span className="font-semibold">{APP_CONFIG.systemStatus}</span>
            </div>
            <Link
              to="/forgot-password"
              className="text-xs font-semibold text-on-surface-variant hover:text-primary flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[18px]">help_outline</span>
              <span className="hidden md:inline">Account Recovery</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Canvas */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 bg-academic-grid">
        {!isConfigured && (
          <div className="mb-6 max-w-4xl mx-auto p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-3 shadow-xs">
            <span className="material-symbols-outlined text-amber-700 text-xl shrink-0 mt-0.5">warning</span>
            <div>
              <p className="font-bold text-amber-950">Supabase Connection Required (Phase 2)</p>
              <p className="mt-0.5 leading-relaxed">
                Supabase credentials are not yet set in your local environment. Create a <code className="bg-amber-100 px-1 py-0.5 rounded font-mono text-[11px]">.env</code> file from <code className="bg-amber-100 px-1 py-0.5 rounded font-mono text-[11px]">.env.example</code> and set <code className="bg-amber-100 px-1 py-0.5 rounded font-mono text-[11px]">VITE_SUPABASE_URL</code> and <code className="bg-amber-100 px-1 py-0.5 rounded font-mono text-[11px]">VITE_SUPABASE_ANON_KEY</code>.
              </p>
            </div>
          </div>
        )}

        {/* 12-Column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Left Column: Stitch Academic Highlights & Mentorship Infographic (7 Cols) */}
          <section className="lg:col-span-7 flex flex-col justify-center space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container-high border border-outline-variant text-secondary-deep w-fit text-xs">
              <span className="material-symbols-outlined text-[16px] text-primary">account_balance</span>
              <span className="font-semibold tracking-wide">
                Department of Computer Science & Engineering • Academic Portal
              </span>
            </div>

            <div className="space-y-3">
              <h1 className="font-display text-3xl sm:text-4xl text-on-surface font-bold tracking-tight leading-tight">
                Learn. Improve.{' '}
                <span className="text-primary underline decoration-secondary decoration-wavy decoration-2">
                  Achieve.
                </span>
              </h1>
              <p className="text-on-surface-variant text-base max-w-2xl leading-relaxed">
                Connecting computer science engineering students with faculty mentors for weekly code reviews, continuous academic performance tracking, technical research, and placement preparation.
              </p>
            </div>

            {/* Vector Graphic Card */}
            <div className="p-6 rounded-2xl bg-surface-container-lowest border border-outline-variant shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between pb-4 border-b border-outline-variant mb-4 text-xs">
                <div className="flex items-center gap-2 font-mono text-slate-500">
                  <span className="w-3 h-3 rounded-full bg-red-400 inline-block"></span>
                  <span className="w-3 h-3 rounded-full bg-amber-400 inline-block"></span>
                  <span className="w-3 h-3 rounded-full bg-emerald-400 inline-block"></span>
                  <span className="ml-2">cse_mentorship_pipeline.py</span>
                </div>
                <span className="text-primary font-semibold flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">terminal</span> Semester 6 Cycle
                </span>
              </div>

              {/* Mentorship Nodes SVG */}
              <svg className="w-full h-40 select-none" fill="none" viewBox="0 0 640 180" xmlns="http://www.w3.org/2000/svg">
                <path d="M40 90H600" stroke="#E2E8F0" strokeDasharray="4 4" strokeWidth="2"></path>
                <path d="M120 40V140M320 30V150M520 40V140" stroke="#E2E8F0" strokeDasharray="2 2" strokeWidth="1.5"></path>
                <path d="M120 90 C 200 40, 240 140, 320 90 C 400 40, 440 140, 520 90" fill="none" stroke="#4F46E5" strokeLinecap="round" strokeWidth="3"></path>
                
                {/* Mentee Node */}
                <g transform="translate(120, 90)">
                  <circle fill="#EEF2FF" r="28" stroke="#4F46E5" strokeWidth="2.5"></circle>
                  <circle fill="#4F46E5" r="5"></circle>
                  <text className="fill-[#0B1C30]" fontSize="11" fontWeight="600" textAnchor="middle" x="0" y="44">Mentee Student</text>
                  <text className="fill-[#006591] font-mono" fontSize="9" textAnchor="middle" x="0" y="-36">Roll: 21CSE104</text>
                </g>

                {/* Git Review Node */}
                <g transform="translate(320, 90)">
                  <rect fill="#FFFFFF" height="50" rx="8" stroke="#3525CD" strokeWidth="2" width="76" x="-38" y="-25"></rect>
                  <circle cx="0" cy="0" fill="#4F46E5" r="8"></circle>
                  <text fill="#FFFFFF" fontSize="9" fontWeight="bold" textAnchor="middle" x="0" y="3">GIT</text>
                  <text className="fill-[#0B1C30]" fontSize="11" fontWeight="600" textAnchor="middle" x="0" y="44">Weekly PR Review</text>
                </g>

                {/* Faculty Advisor Node */}
                <g transform="translate(520, 90)">
                  <circle fill="#ECFDF5" r="28" stroke="#006E4B" strokeWidth="2.5"></circle>
                  <circle fill="#005338" r="5"></circle>
                  <text className="fill-[#0B1C30]" fontSize="11" fontWeight="600" textAnchor="middle" x="0" y="44">Faculty Advisor</text>
                  <text className="fill-[#006E4B] font-mono" fontSize="9" textAnchor="middle" x="0" y="-36">Prof. A. Vance, Ph.D</text>
                </g>
              </svg>

              {/* 3 Metric Pills */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-outline-variant mt-2 text-xs">
                <div className="flex items-center gap-2 p-2 rounded-lg bg-surface-container-low">
                  <span className="material-symbols-outlined text-primary text-[20px]">calendar_month</span>
                  <div>
                    <p className="font-semibold text-on-surface">Weekly 1:1 Milestones</p>
                    <p className="text-[10px] text-on-surface-variant">Scheduled Code Sprints</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-surface-container-low">
                  <span className="material-symbols-outlined text-secondary text-[20px]">terminal</span>
                  <div>
                    <p className="font-semibold text-on-surface">Placement & DSA</p>
                    <p className="text-[10px] text-on-surface-variant">Tier-1 Tech Preparation</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-surface-container-low">
                  <span className="material-symbols-outlined text-tertiary text-[20px]">fact_check</span>
                  <div>
                    <p className="font-semibold text-on-surface">ABET Analytics</p>
                    <p className="text-[10px] text-on-surface-variant">Outcome Assessment</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2.5 text-on-surface-variant text-xs">
              <span className="material-symbols-outlined text-secondary text-[18px] mt-0.5">verified</span>
              <p>
                Assigned accounts are administered directly via campus IT. No public self-registration. Credentials conform to institutional Active Directory and federated SAML standards.
              </p>
            </div>
          </section>

          {/* Right Column: Centered Authentication Card (5 Cols) */}
          <section className="lg:col-span-5 w-full flex justify-center">
            <div className="w-full max-w-md bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 sm:p-8 shadow-sm relative">
              <div className="mb-6 space-y-1">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-xl font-bold text-on-surface">Mentor–Mentee Platform</h2>
                  <span className="px-2 py-0.5 rounded-full bg-surface-container-low border border-outline-variant text-[11px] font-semibold text-secondary">
                    Supabase Auth
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant">
                  Sign in with your verified institutional credentials
                </p>
              </div>

              {/* Quick Fill Preset Pills */}
              <div className="flex items-center justify-between bg-surface-container-low p-1 rounded-xl mb-6 border border-outline-variant text-xs">
                <button
                  type="button"
                  onClick={() => handleRolePillClick('student')}
                  className={`flex-1 text-center py-1.5 px-2 rounded-lg font-semibold flex items-center justify-center gap-1 transition-all ${
                    selectedRolePill === 'student'
                      ? 'bg-surface-container-lowest text-on-surface shadow-xs text-primary'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">school</span> Student
                </button>
                <button
                  type="button"
                  onClick={() => handleRolePillClick('mentor')}
                  className={`flex-1 text-center py-1.5 px-2 rounded-lg font-semibold flex items-center justify-center gap-1 transition-all ${
                    selectedRolePill === 'mentor'
                      ? 'bg-surface-container-lowest text-on-surface shadow-xs text-primary'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">psychology</span> Faculty
                </button>
                <button
                  type="button"
                  onClick={() => handleRolePillClick('coordinator')}
                  className={`flex-1 text-center py-1.5 px-2 rounded-lg font-semibold flex items-center justify-center gap-1 transition-all ${
                    selectedRolePill === 'coordinator'
                      ? 'bg-surface-container-lowest text-on-surface shadow-xs text-primary'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">admin_panel_settings</span> Coordinator
                </button>
              </div>

              {/* Form */}
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-on-surface" htmlFor="email-field">
                    Institutional Email
                  </label>
                  <div className="relative rounded-lg shadow-xs">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-on-surface-variant">
                      <span className="material-symbols-outlined text-[19px]">alternate_email</span>
                    </div>
                    <input
                      id="email-field"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="student.id@engg.edu or faculty@cs.univ.edu"
                      required
                      className={`w-full pl-10 pr-3 py-2.5 bg-surface-container-lowest border rounded-lg text-sm transition-all outline-none ${
                        errorMessage
                          ? 'border-error ring-2 ring-error/20'
                          : 'border-outline-variant focus:border-primary focus:ring-2 focus:ring-primary/20'
                      }`}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-on-surface" htmlFor="password-field">
                      Password
                    </label>
                    <Link to="/forgot-password" className="text-xs font-semibold text-primary hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative rounded-lg shadow-xs">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-on-surface-variant">
                      <span className="material-symbols-outlined text-[19px]">lock</span>
                    </div>
                    <input
                      id="password-field"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="Enter your password"
                      className="w-full pl-10 pr-10 py-2.5 bg-surface-container-lowest border border-outline-variant rounded-lg text-sm focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-on-surface-variant hover:text-on-surface"
                    >
                      <span className="material-symbols-outlined text-[19px]">
                        {showPassword ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>
                </div>

                {errorMessage && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
                    <span className="material-symbols-outlined text-[16px] text-red-600 mt-0.5">error</span>
                    <span className="flex-1">{errorMessage}</span>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      defaultChecked
                      className="w-4 h-4 rounded border-outline text-primary focus:ring-primary"
                    />
                    <span className="text-on-surface-variant">Remember this session</span>
                  </label>
                  <span className="text-outline text-[11px] font-mono flex items-center gap-0.5">
                    <span className="material-symbols-outlined text-[14px]">shield</span> PKCE Auth
                  </span>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-primary hover:bg-primary-hover text-white font-semibold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 shadow-sm transition-colors duration-150 focus:ring-2 focus:ring-offset-2 focus:ring-primary text-sm disabled:opacity-70"
                  >
                    {isLoading ? (
                      <>
                        <span className="animate-spin material-symbols-outlined text-[18px]">progress_activity</span>
                        <span>Verifying Credentials...</span>
                      </>
                    ) : (
                      <>
                        <span>Sign In</span>
                        <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="p-3 bg-surface-container-low rounded-lg border border-outline-variant flex items-start gap-2.5 text-on-surface-variant text-left mt-3">
                  <span className="material-symbols-outlined text-primary text-[18px] mt-0.5">info</span>
                  <p className="text-[11px] leading-relaxed">
                    <strong>Institutional Policy:</strong> Self-registration is disabled. Contact your Department Coordinator or campus IT administrator to provision your profile and assigned academic role.
                  </p>
                </div>
              </form>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-surface-container-low border-t border-outline-variant">
        <div className="w-full py-6 px-6 max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-xs">
          <div className="flex flex-col sm:flex-row items-center gap-2 text-center md:text-left">
            <span className="font-display font-semibold text-on-surface">{APP_CONFIG.name}</span>
            <span className="hidden sm:inline text-outline-variant">•</span>
            <span className="text-on-surface-variant text-[11px]">
              © {new Date().getFullYear()} {APP_CONFIG.department}. {APP_CONFIG.accreditation}.
            </span>
          </div>
          <nav className="flex flex-wrap justify-center items-center gap-x-5 gap-y-2 text-[11px] text-on-surface-variant">
            <a href="#conduct" className="hover:text-primary transition-colors">Academic Code of Conduct</a>
            <a href="#accreditation" className="hover:text-primary transition-colors">Institutional Accreditation</a>
            <a href="#security" className="hover:text-primary transition-colors">IT Security & SSO</a>
            <a href="#helpdesk" className="hover:text-primary transition-colors">Helpdesk Support</a>
          </nav>
        </div>
      </footer>
    </div>
  );
};

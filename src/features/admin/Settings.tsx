import React, { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { useAuth } from '../../context/AuthContext';
import { APP_CONFIG } from '../../lib/constants';

export const AdminSettings: React.FC = () => {
  const { profile } = useAuth();
  const [smtpTabExpanded, setSmtpTabExpanded] = useState<boolean>(true);

  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
              Institutional Administration Settings
            </h1>
            <Badge variant="primary">System Config</Badge>
          </div>
          <p className="text-xs text-on-surface-variant mt-1">
            Department of Computer Science & Engineering • Auth, SMTP Delivery & Security Governance
          </p>
        </div>
      </div>

      {/* Admin Profile Overview */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-200 text-primary flex items-center justify-center font-bold text-xl">
              {profile?.name?.charAt(0) || 'A'}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">{profile?.name || 'Administrator'}</h2>
              <p className="text-xs text-slate-500 font-mono">{profile?.email}</p>
            </div>
          </div>
          <span className="text-xs font-bold text-purple-700 bg-purple-100 px-3 py-1 rounded-full uppercase tracking-wider">
            {profile?.role || 'Admin'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <span className="text-slate-400 font-semibold block text-[10px] uppercase">Department</span>
            <span className="font-semibold text-slate-800">{APP_CONFIG.department}</span>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <span className="text-slate-400 font-semibold block text-[10px] uppercase">Accreditation Mandate</span>
            <span className="font-semibold text-slate-800">ABET EAC Criterion 3 & 5</span>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <span className="text-slate-400 font-semibold block text-[10px] uppercase">Account Security</span>
            <span className="font-semibold text-emerald-700 flex items-center gap-1 mt-0.5">
              <span className="material-symbols-outlined text-sm">verified_user</span>
              PostgreSQL Trigger Guarded
            </span>
          </div>
        </div>
      </Card>

      {/* Supabase SMTP Configuration Guide (Step 5 Requirement) */}
      <Card className="p-6 space-y-4 border-l-4 border-l-amber-500">
        <div
          className="flex items-center justify-between cursor-pointer select-none"
          onClick={() => setSmtpTabExpanded(!smtpTabExpanded)}
        >
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-amber-600 text-xl">mail_lock</span>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Supabase Auth SMTP Invitation Configuration
              </h3>
              <p className="text-xs text-slate-500">
                Outbound email delivery status & configuration instructions
              </p>
            </div>
          </div>
          <span className="material-symbols-outlined text-slate-400 text-lg">
            {smtpTabExpanded ? 'expand_less' : 'expand_more'}
          </span>
        </div>

        {smtpTabExpanded && (
          <div className="space-y-4 pt-2 text-xs leading-relaxed text-slate-600 border-t border-slate-100">
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200/80 text-amber-900">
              <p className="font-semibold flex items-center gap-1.5 mb-1 text-xs">
                <span className="material-symbols-outlined text-sm text-amber-700">info</span>
                Direct Invitation Delivery Behavior
              </p>
              <p className="text-[11px] leading-relaxed">
                Supabase free/trial project tiers limit outbound email sending via the default mailer to prevent abuse.
                When inviting students or mentors, our backend attempts direct email invitation first via{' '}
                <code className="font-mono bg-white px-1 py-0.5 rounded text-amber-900 text-[10px]">
                  admin.inviteUserByEmail()
                </code>
                . If direct delivery fails due to SMTP restrictions, the backend automatically generates a secure
                invitation token with an action link that the administrator can copy and send directly.
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="font-bold text-slate-800 text-xs">
                To enable 100% automated direct email delivery from Supabase:
              </h4>
              <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-slate-700">
                <li>
                  Open your <strong>Supabase Dashboard</strong> at{' '}
                  <a
                    href="https://supabase.com/dashboard"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline font-mono"
                  >
                    https://supabase.com/dashboard
                  </a>
                  .
                </li>
                <li>Navigate to <strong>Project Settings &gt; Authentication</strong>.</li>
                <li>Scroll down to the <strong>SMTP Settings</strong> section and toggle <strong>Enable Custom SMTP</strong> to ON.</li>
                <li>
                  Enter your institutional or SMTP credentials:
                  <ul className="list-disc list-inside ml-5 mt-1 text-slate-600 space-y-0.5">
                    <li><strong>Sender email:</strong> e.g., <code className="font-mono text-[10px]">noreply@mentorbridge.edu</code></li>
                    <li><strong>Sender name:</strong> <code className="font-mono text-[10px]">MentorBridge Academic Advising</code></li>
                    <li><strong>Host:</strong> e.g., <code className="font-mono text-[10px]">smtp.sendgrid.net</code> or <code className="font-mono text-[10px]">smtp.resend.com</code></li>
                    <li><strong>Port:</strong> 587 (TLS) or 465 (SSL)</li>
                    <li><strong>User &amp; Password:</strong> Your SMTP provider API key / password</li>
                  </ul>
                </li>
                <li>Save changes. All subsequent invitations will be delivered directly into recipients&apos; inboxes.</li>
              </ol>
            </div>
          </div>
        )}
      </Card>

      {/* Security Architecture & RLS Safeguards */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
          <span className="material-symbols-outlined text-primary text-xl">security</span>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Row Level Security & Database Controls</h3>
            <p className="text-xs text-slate-500">PostgreSQL security policies and database trigger state</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <p className="font-bold text-slate-800 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-emerald-600 text-sm">check_circle</span>
              Single Active Assignment Constraint
            </p>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Enforced by index <code className="bg-white px-1 py-0.5 rounded font-mono text-[10px]">idx_unique_active_student_term_assignment</code> on{' '}
              <code className="bg-white px-1 py-0.5 rounded font-mono text-[10px]">(student_id, academic_term_id) WHERE is_active = true</code>.
              Guarantees a student can never hold multiple active mentors simultaneously in the same term.
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <p className="font-bold text-slate-800 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-emerald-600 text-sm">check_circle</span>
              Role Escalation Guard Trigger
            </p>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Enforced by trigger <code className="bg-white px-1 py-0.5 rounded font-mono text-[10px]">enforce_role_integrity</code> calling{' '}
              <code className="bg-white px-1 py-0.5 rounded font-mono text-[10px]">prevent_role_or_active_tampering()</code>.
              Prevents client-side modification of roles or active status.
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <p className="font-bold text-slate-800 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-emerald-600 text-sm">check_circle</span>
              Transactional Reassignment
            </p>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Administered via PostgreSQL stored procedure <code className="bg-white px-1 py-0.5 rounded font-mono text-[10px]">reassign_mentor()</code>.
              Atomically deactivates the previous active pairing and creates the new assignment, preserving full historical audit trails.
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <p className="font-bold text-slate-800 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-emerald-600 text-sm">check_circle</span>
              Backend Service Role Isolation
            </p>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Privileged service-role operations (inviting users, updating student_details, admin management) are strictly confined to the Express server.
              The client browser operates only under anon JWTs checked by PostgreSQL RLS.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};

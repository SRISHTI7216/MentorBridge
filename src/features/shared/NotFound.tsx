import React from 'react';
import { Link } from 'react-router-dom';
import { APP_CONFIG } from '../../lib/constants';
import { Button } from '../../components/ui/Button';

export const NotFound: React.FC = () => {
  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6 text-center select-none bg-academic-grid">
      <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-primary flex items-center justify-center mx-auto mb-4 border border-indigo-100 shadow-sm">
        <span className="material-symbols-outlined text-3xl">error</span>
      </div>
      <span className="text-xs font-mono font-semibold text-primary uppercase tracking-widest bg-indigo-50 px-3 py-1 rounded-full border border-indigo-200 mb-2">
        HTTP 404 • Resource Not Located
      </span>
      <h1 className="text-3xl font-bold font-display text-slate-900 mt-2">
        Requested Academic Route Not Found
      </h1>
      <p className="text-xs text-slate-600 max-w-md mx-auto mt-2 leading-relaxed">
        The academic portal endpoint you are looking for has been moved, does not exist, or requires specific SSO authentication credentials.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
        <Link to="/login">
          <Button variant="outline" size="sm" leftIcon={<span className="material-symbols-outlined text-sm">lock</span>}>
            Sign In Portal Gate
          </Button>
        </Link>
        <Link to="/mentor/dashboard">
          <Button variant="primary" size="sm" leftIcon={<span className="material-symbols-outlined text-sm">psychology</span>}>
            Faculty Mentor Workspace
          </Button>
        </Link>
        <Link to="/student/dashboard">
          <Button variant="secondary" size="sm" leftIcon={<span className="material-symbols-outlined text-sm">school</span>}>
            Student Workspace
          </Button>
        </Link>
      </div>

      <p className="text-[11px] text-slate-400 mt-8">
        {APP_CONFIG.name} • {APP_CONFIG.department}
      </p>
    </div>
  );
};


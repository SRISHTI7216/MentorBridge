import React from 'react';
import { APP_CONFIG } from '../../lib/constants';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-surface-container-low border-t border-outline-variant w-full mt-auto">
      <div className="w-full py-6 px-6 max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-xs">
        <div className="flex flex-col sm:flex-row items-center gap-2 text-center md:text-left">
          <span className="font-display font-semibold text-on-surface">
            {APP_CONFIG.name}
          </span>
          <span className="hidden sm:inline text-outline-variant">•</span>
          <span className="text-on-surface-variant text-[11px]">
            © {new Date().getFullYear()} {APP_CONFIG.department}. {APP_CONFIG.accreditation}.
          </span>
        </div>

        <nav className="flex flex-wrap justify-center items-center gap-x-5 gap-y-2 text-[11px] text-on-surface-variant">
          <a href="#conduct" className="hover:text-primary transition-colors">
            Academic Code of Conduct
          </a>
          <a href="#accreditation" className="hover:text-primary transition-colors">
            ABET SO-1 Compliance
          </a>
          <a href="#security" className="hover:text-primary transition-colors">
            IT Security & SSO
          </a>
          <a href="#helpdesk" className="hover:text-primary transition-colors">
            Helpdesk: {APP_CONFIG.supportEmail}
          </a>
        </nav>
      </div>
    </footer>
  );
};


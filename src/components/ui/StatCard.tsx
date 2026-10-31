import React from 'react';
import { Card } from './Card';

export interface StatCardProps {
  title: string;
  value: string | number;
  change?: string;
  isPositive?: boolean;
  subtext?: string;
  actionText?: string;
  iconName: string;
  iconColor?: 'primary' | 'emerald' | 'sky' | 'amber';
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  change,
  isPositive = true,
  subtext,
  actionText,
  iconName,
  iconColor = 'primary',
}) => {
  const iconColorMap = {
    primary: "bg-indigo-50 text-primary",
    emerald: "bg-emerald-50 text-emerald-600",
    sky: "bg-sky-50 text-sky-600",
    amber: "bg-amber-50 text-amber-600",
  };

  return (
    <Card hoverEffect className="p-5 flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          {title}
        </span>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${iconColorMap[iconColor]}`}>
          <span className="material-symbols-outlined text-xl">{iconName}</span>
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-bold font-display text-slate-900">{value}</span>
        {change && (
          <span
            className={`text-xs font-semibold px-1.5 py-0.5 rounded flex items-center ${
              isPositive ? "text-emerald-700 bg-emerald-50" : "text-amber-700 bg-amber-50"
            }`}
          >
            {change}
          </span>
        )}
      </div>
      {(subtext || actionText) && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
          <span>{subtext}</span>
          {actionText && <span className="font-medium text-primary">{actionText}</span>}
        </div>
      )}
    </Card>
  );
};


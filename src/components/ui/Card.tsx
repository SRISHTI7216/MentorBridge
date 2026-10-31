import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverEffect?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  hoverEffect = false,
  className,
  ...props
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          "bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 shadow-sm",
          hoverEffect && "hover:border-primary/40 hover:shadow-md transition-all duration-200",
          className
        )
      )}
      {...props}
    >
      {children}
    </div>
  );
};


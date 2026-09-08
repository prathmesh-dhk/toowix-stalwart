import React from 'react';

export interface StatCardProps {
  title: string;
  value: string | number;
  label?: string;
  trend?: string;
  trendDirection?: 'up' | 'down';
  icon: React.ReactNode;
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  label,
  trend,
  trendDirection = 'up',
  icon,
  className = '',
}) => {
  return (
    <div className={`card-base stat-card ${className}`.trim()}>
      <div className="flex items-center justify-between">
        <span className="card-title">{title}</span>
        <div className="stat-icon-chip">{icon}</div>
      </div>
      <div className="stat-num">{value}</div>
      {(label || trend) && (
        <div className="flex items-center justify-between mt-1 text-xs">
          {label && <span className="stat-label">{label}</span>}
          {trend && (
            <span className={`stat-trend ${trendDirection === 'down' ? 'down' : ''}`}>
              {trend}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

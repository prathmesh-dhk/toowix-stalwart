import React from 'react';

export type StatusType = 
  | 'active' 
  | 'completed' 
  | 'approved'
  | 'operational'
  | 'healthy'
  | 'pending'
  | 'pending_review' 
  | 'pending_setup'
  | 'in_progress'
  | 'review'
  | 'suspended' 
  | 'closed'
  | 'inactive'
  | 'rejected' 
  | 'error'
  | 'failed'
  | 'danger'
  | 'new'
  | 'info'
  | 'success'
  | 'warning';

interface StatusBadgeProps {
  status: string;
  label?: string;
  children?: React.ReactNode;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, children, className = '' }) => {
  const normalized = (status || '').toLowerCase().replace(/[\s-]+/g, '_');

  let badgeClass = 'badge-closed';
  let dotClass = 'gray';
  const displayLabel = children ?? label ?? status;

  if (['active', 'completed', 'approved', 'operational', 'healthy', 'success'].includes(normalized)) {
    badgeClass = 'badge-completed';
    dotClass = 'green';
  } else if (['pending', 'pending_review', 'pending_setup', 'in_progress', 'review', 'warning', 'degraded'].includes(normalized)) {
    badgeClass = 'badge-progress';
    dotClass = 'yellow';
  } else if (['new', 'info'].includes(normalized)) {
    badgeClass = 'badge-new';
    dotClass = 'blue';
  } else if (['rejected', 'error', 'failed', 'danger'].includes(normalized)) {
    badgeClass = 'badge-rejected';
    dotClass = 'red';
  } else if (['suspended', 'closed', 'inactive', 'archived', 'pending_deletion'].includes(normalized)) {
    badgeClass = 'badge-closed';
    dotClass = 'gray';
  }

  return (
    <span className={`status-badge ${badgeClass} ${className}`.trim()}>
      <span className={`status-dot ${dotClass}`} />
      {displayLabel}
    </span>
  );
};

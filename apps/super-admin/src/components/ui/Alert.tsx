import React from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export interface AlertProps {
  type?: 'info' | 'warning' | 'success' | 'error';
  message: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

export const Alert: React.FC<AlertProps> = ({
  type = 'info',
  message,
  onClose,
  className = '',
}) => {
  const icons = {
    info: <Info className="w-4 h-4 shrink-0" />,
    warning: <AlertTriangle className="w-4 h-4 shrink-0" />,
    success: <CheckCircle2 className="w-4 h-4 shrink-0" />,
    error: <AlertCircle className="w-4 h-4 shrink-0" />,
  };

  return (
    <div className={`alert-banner alert-${type} ${className}`.trim()}>
      {icons[type]}
      <div className="flex-1 text-xs sm:text-sm">{message}</div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="text-current opacity-70 hover:opacity-100 p-1"
          aria-label="Close alert"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

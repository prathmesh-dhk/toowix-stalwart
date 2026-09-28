import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface SlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  widthClassName?: string;
}

/**
 * Reusable inspector drawer that slides in from the right edge for quick-look records
 * (an audit log entry, a domain's DNS status, ...) without a full page navigation.
 * Closes on Escape or clicking the backdrop.
 */
export const SlideOver: React.FC<SlideOverProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  widthClassName = 'max-w-md',
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        onClick={onClose}
        className="absolute inset-0"
        style={{ backgroundColor: 'var(--overlay-color)', animation: 'slideover-backdrop-in 0.2s ease' }}
      />
      <div
        className={`relative w-full ${widthClassName} h-full flex flex-col shadow-2xl`}
        style={{
          backgroundColor: 'var(--surface-color)',
          borderLeft: '1px solid var(--border-color)',
          animation: 'slideover-panel-in 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div
          className="flex items-start justify-between gap-3 px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--border-color)' }}
        >
          <div className="min-w-0">
            <h2 className="text-sm font-bold truncate" style={{ color: 'var(--slate-900)' }}>
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--slate-500)' }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="modal-close-btn shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
      <style>{`
        @keyframes slideover-backdrop-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideover-panel-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
      `}</style>
    </div>
  );
};

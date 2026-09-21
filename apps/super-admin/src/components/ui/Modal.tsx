import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}

const MAX_WIDTH_MAP: Record<string, string> = {
  'max-w-xs': '320px',
  'max-w-sm': '384px',
  'max-w-md': '448px',
  'max-w-lg': '512px',
  'max-w-xl': '576px',
  'max-w-2xl': '672px',
  'max-w-3xl': '768px',
  'max-w-4xl': '896px',
  'max-w-5xl': '1024px',
  'max-w-6xl': '1152px',
  'max-w-7xl': '1280px',
  'max-w-full': '100%',
};

function resolveMaxWidth(maxWidth?: string): string | undefined {
  if (!maxWidth) return undefined;
  const match = maxWidth.match(/max-w-\[(.+)\]/);
  if (match) return match[1];
  for (const token of maxWidth.split(/\s+/)) {
    if (MAX_WIDTH_MAP[token]) return MAX_WIDTH_MAP[token];
  }
  return undefined;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxWidth = 'max-w-[540px]',
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const resolvedWidth = resolveMaxWidth(maxWidth);

  return (
    <div className="modal-backdrop-mock" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className={`modal-card ${maxWidth}`}
        style={
          resolvedWidth
            ? ({
                '--modal-max-width': resolvedWidth,
                maxWidth: `min(${resolvedWidth}, calc(100vw - 48px))`,
              } as React.CSSProperties)
            : undefined
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="modal-body">{children}</div>

        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
};

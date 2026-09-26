import { X, CreditCard } from 'lucide-react';
import { PaymentMethodSelector } from './PaymentMethodSelector';
import { PaymentMethodItem, Plan } from '../types';

interface PaymentMethodModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (paymentMethod?: PaymentMethodItem) => void;
  selectedPlan?: Plan | null;
  domainName?: string;
  autoAttachDomainId?: string;
  title?: string;
}

export const PaymentMethodModal: React.FC<PaymentMethodModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  selectedPlan,
  domainName,
  autoAttachDomainId,
  title = 'Payment Method',
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[calc(100dvh-24px)]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <CreditCard className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">{title}</h2>
              <p className="text-[11px] text-slate-500">
                {domainName ? `Billing for ${domainName}` : 'Tenant-wide combined billing'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer flex items-center justify-center shrink-0"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 overflow-y-auto">
          <PaymentMethodSelector
            selectedPlan={selectedPlan}
            domainName={domainName}
            autoAttachDomainId={autoAttachDomainId}
            onSuccess={(pm) => {
              onSuccess(pm);
              onClose();
            }}
            onSkip={onClose}
            showSkip={true}
            submitLabel="Save Payment Method"
          />
        </div>
      </div>
    </div>
  );
};

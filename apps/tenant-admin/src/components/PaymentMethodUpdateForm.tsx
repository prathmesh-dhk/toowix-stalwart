import React, { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Loader2 } from 'lucide-react';

interface PaymentMethodUpdateFormProps {
  publishableKey: string;
  clientSecret: string;
  onDone: () => void;
}

const InnerForm: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    const { error: confirmError } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });

    if (confirmError) {
      setError(confirmError.message || 'Failed to update payment method.');
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <PaymentElement />
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!stripe || submitting}
          className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold shadow-xs transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Saving...</span>
            </>
          ) : (
            <span>Save Payment Method</span>
          )}
        </button>
      </div>
    </form>
  );
};

export const PaymentMethodUpdateForm: React.FC<PaymentMethodUpdateFormProps> = ({
  publishableKey,
  clientSecret,
  onDone,
}) => {
  const [stripePromise] = useState(() => loadStripe(publishableKey));

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <InnerForm onDone={onDone} />
    </Elements>
  );
};

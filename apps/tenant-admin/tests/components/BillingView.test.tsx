import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BillingView } from '../../src/components/BillingView';
import { api } from '../../src/api';
import { DomainItem, Plan } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: {
    getDomainBillingStatus: vi.fn(),
    listPlans: vi.fn(),
    listBillingInvoices: vi.fn(),
    startDomainCheckout: vi.fn(),
    getBillingConfig: vi.fn(),
    createPaymentMethodSetupIntent: vi.fn(),
    upgradeDomainPlan: vi.fn(),
    downgradeDomainPlan: vi.fn(),
    cancelDomainSubscription: vi.fn(),
  },
}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn().mockResolvedValue({}),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: any) => <div data-testid="stripe-elements">{children}</div>,
  PaymentElement: () => <div data-testid="stripe-payment-element" />,
  useStripe: () => ({ confirmSetup: vi.fn() }),
  useElements: () => ({}),
}));

const mockDomain: DomainItem = {
  id: 'dom-1',
  domainName: 'acmecorp.com',
  status: 'active',
  mailboxLimit: 10,
  employeeCount: 10,
  planId: 'plan-team',
  planName: 'Team',
  mailboxCount: 2,
  isPrimary: true,
};

const mockPlans: Plan[] = [
  { id: 'plan-team', name: 'Team', seatCount: 10, displayOrder: 1, isActive: true, isDefault: false, billingMode: 'fixed', monthlyPriceInPaise: 100000 },
  { id: 'plan-growth', name: 'Growth', seatCount: 25, displayOrder: 2, isActive: true, isDefault: false, billingMode: 'fixed', monthlyPriceInPaise: 200000 },
];

describe('BillingView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listPlans).mockResolvedValue({ plans: mockPlans });
    vi.mocked(api.listBillingInvoices).mockResolvedValue({ invoices: [] });
  });

  it('shows an empty state when there is no active domain', () => {
    render(<BillingView activeDomain={null} />);
    expect(screen.getByText('Add a domain to see billing.')).toBeInTheDocument();
  });

  it('shows "Add Payment Method" when the domain has no subscription yet', async () => {
    vi.mocked(api.getDomainBillingStatus).mockResolvedValue({
      domainId: 'dom-1',
      domainName: 'acmecorp.com',
      subscription: null,
    });

    render(<BillingView activeDomain={mockDomain} />);

    expect(await screen.findByText('No Subscription')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add payment method/i })).toBeInTheDocument();
  });

  it('redirects to Stripe Checkout when "Add Payment Method" is clicked', async () => {
    vi.mocked(api.getDomainBillingStatus).mockResolvedValue({
      domainId: 'dom-1',
      domainName: 'acmecorp.com',
      subscription: null,
    });
    vi.mocked(api.startDomainCheckout).mockResolvedValue({ url: 'https://checkout.stripe.com/test-session' });

    delete (window as any).location;
    (window as any).location = { href: '' };

    render(<BillingView activeDomain={mockDomain} />);
    const btn = await screen.findByRole('button', { name: /add payment method/i });
    await userEvent.click(btn);

    await waitFor(() => {
      expect(api.startDomainCheckout).toHaveBeenCalledWith('dom-1');
      expect(window.location.href).toBe('https://checkout.stripe.com/test-session');
    });
  });

  it('shows plan, status and next-charge date for an active subscription', async () => {
    vi.mocked(api.getDomainBillingStatus).mockResolvedValue({
      domainId: 'dom-1',
      domainName: 'acmecorp.com',
      subscription: {
        status: 'active',
        planId: 'plan-team',
        currentPeriodEnd: '2026-10-15T00:00:00.000Z',
        trialEnd: null,
        gracePeriodEndsAt: null,
        cancelAtPeriodEnd: false,
      },
    });

    render(<BillingView activeDomain={mockDomain} />);

    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByText('Subscription is active and in good standing.')).toBeInTheDocument();
  });

  it('shows the payment-issue warning during grace and lets the tenant open the payment-method form', async () => {
    vi.mocked(api.getDomainBillingStatus).mockResolvedValue({
      domainId: 'dom-1',
      domainName: 'acmecorp.com',
      subscription: {
        status: 'grace',
        planId: 'plan-team',
        currentPeriodEnd: '2026-10-15T00:00:00.000Z',
        trialEnd: null,
        gracePeriodEndsAt: '2026-09-22T00:00:00.000Z',
        cancelAtPeriodEnd: false,
      },
    });
    vi.mocked(api.getBillingConfig).mockResolvedValue({ publishableKey: 'pk_test_123' });
    vi.mocked(api.createPaymentMethodSetupIntent).mockResolvedValue({ clientSecret: 'seti_test_secret' });

    render(<BillingView activeDomain={mockDomain} />);

    expect(await screen.findByText('Payment Issue')).toBeInTheDocument();
    expect(screen.getByText(/your last payment failed/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /update payment method/i }));

    expect(await screen.findByTestId('stripe-payment-element')).toBeInTheDocument();
  });

  it('shows the suspended banner when the domain is suspended for non-payment', async () => {
    vi.mocked(api.getDomainBillingStatus).mockResolvedValue({
      domainId: 'dom-1',
      domainName: 'acmecorp.com',
      subscription: {
        status: 'suspended',
        planId: 'plan-team',
        currentPeriodEnd: '2026-10-15T00:00:00.000Z',
        trialEnd: null,
        gracePeriodEndsAt: null,
        cancelAtPeriodEnd: false,
      },
    });

    render(<BillingView activeDomain={mockDomain} />);
    expect(await screen.findByText(/mail service for this domain is suspended/i)).toBeInTheDocument();
  });

  it('cancels the subscription after user confirmation', async () => {
    vi.mocked(api.getDomainBillingStatus).mockResolvedValue({
      domainId: 'dom-1',
      domainName: 'acmecorp.com',
      subscription: {
        status: 'active',
        planId: 'plan-team',
        currentPeriodEnd: '2026-10-15T00:00:00.000Z',
        trialEnd: null,
        gracePeriodEndsAt: null,
        cancelAtPeriodEnd: false,
      },
    });
    vi.mocked(api.cancelDomainSubscription).mockResolvedValue({ success: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<BillingView activeDomain={mockDomain} />);
    await screen.findByText('Active');

    await userEvent.click(screen.getByRole('button', { name: /cancel subscription/i }));

    await waitFor(() => {
      expect(api.cancelDomainSubscription).toHaveBeenCalledWith('dom-1');
    });
  });

  it('lists invoice history', async () => {
    vi.mocked(api.getDomainBillingStatus).mockResolvedValue({
      domainId: 'dom-1',
      domainName: 'acmecorp.com',
      subscription: {
        status: 'active',
        planId: 'plan-team',
        currentPeriodEnd: '2026-10-15T00:00:00.000Z',
        trialEnd: null,
        gracePeriodEndsAt: null,
        cancelAtPeriodEnd: false,
      },
    });
    vi.mocked(api.listBillingInvoices).mockResolvedValue({
      invoices: [
        {
          id: 'in_1',
          status: 'paid',
          amountPaid: 100000,
          currency: 'inr',
          createdAt: '2026-09-01T00:00:00.000Z',
          hostedInvoiceUrl: 'https://invoice.stripe.com/test',
          invoicePdf: null,
        },
      ],
    });

    render(<BillingView activeDomain={mockDomain} />);

    expect(await screen.findByText('paid')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view/i })).toHaveAttribute('href', 'https://invoice.stripe.com/test');
  });
});

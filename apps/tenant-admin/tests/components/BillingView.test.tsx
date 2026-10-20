import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BillingView } from '../../src/components/BillingView';
import { api } from '../../src/api';
import { CartData, Plan, TenantBillingSummary } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: {
    getTenantBillingSummary: vi.fn(),
    getCart: vi.fn(),
    listPlans: vi.fn(),
    listBillingInvoices: vi.fn(),
    startCardUpdate: vi.fn(),
    upgradeDomainPlan: vi.fn(),
    downgradeDomainPlan: vi.fn(),
    cancelDomainSubscription: vi.fn(),
    cancelTenantSubscription: vi.fn(),
    listPaymentMethods: vi.fn().mockResolvedValue({ paymentMethods: [], defaultPaymentMethodId: null }),
    getBillingConfig: vi.fn().mockResolvedValue({ publishableKey: '', billingEnabled: false }),
    createTenantSetupIntent: vi.fn().mockResolvedValue({ clientSecret: 'bypassed' }),
    savePaymentMethod: vi.fn(),
    validateCoupon: vi.fn(),
    redeemCoupon: vi.fn(),
  },
}));

const plans: Plan[] = [
  { id: 'plan-starter', name: 'Starter', seatCount: 10, displayOrder: 1, isActive: true, isDefault: false, billingMode: 'fixed', monthlyPriceInPaise: 10000 },
  { id: 'plan-business', name: 'Business', seatCount: 50, displayOrder: 2, isActive: true, isDefault: false, billingMode: 'fixed', monthlyPriceInPaise: 20000 },
];

const cart: CartData = {
  trial: { started: true, startedAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-31T00:00:00.000Z', daysRemaining: 40, isTrialing: true },
  hasPaymentMethod: true,
  paymentMethod: { brand: 'visa', last4: '4242' },
  subscriptionEnded: false,
  requiresActivation: false,
  pendingMailboxes: [],
  domains: [
    { domainId: 'dom-1', domainName: 'acme.com', planId: 'plan-starter', planName: 'Starter', activeUsers: 5, pendingUsers: 0, maxUsers: 10, ratePaise: 10000, monthlyPaise: 50000 },
    { domainId: 'dom-2', domainName: 'acme.in', planId: 'plan-business', planName: 'Business', activeUsers: 12, pendingUsers: 0, maxUsers: 50, ratePaise: 20000, monthlyPaise: 240000 },
  ],
  estimatedMonthlyPaise: 290000,
  previousEstimatedMonthlyPaise: 290000,
  dueTodayPaise: 0,
  recentChanges: [],
};

const summary: TenantBillingSummary = {
  hasSubscription: true,
  status: 'trialing',
  currentPeriodEnd: '2026-10-31T00:00:00.000Z',
  trialEnd: '2026-10-31T00:00:00.000Z',
  trialStartedAt: '2026-09-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  paymentActionUrl: null,
  totalMonthlyPaise: 290000,
  domains: [],
};

describe('BillingView (company-wide)', () => {
  const onCartUpdated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getCart).mockResolvedValue(cart);
    vi.mocked(api.getTenantBillingSummary).mockResolvedValue(summary);
    vi.mocked(api.listPlans).mockResolvedValue({ plans });
    vi.mocked(api.listBillingInvoices).mockResolvedValue({ invoices: [] });
    vi.mocked(api.listPaymentMethods).mockResolvedValue({ paymentMethods: [], defaultPaymentMethodId: null });
  });

  it('shows one trial, one card and every domain with users/limit and monthly subtotal', async () => {
    render(<BillingView cart={cart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);

    expect(await screen.findByText('60-day trial')).toBeInTheDocument();
    expect(screen.getByText('visa •••• 4242')).toBeInTheDocument();
    expect(screen.getByText('acme.com')).toBeInTheDocument();
    expect(screen.getByText('acme.in')).toBeInTheDocument();
    expect(screen.getByText(/5 \/ 10 users/)).toBeInTheDocument();
    expect(screen.getByText(/12 \/ 50 users/)).toBeInTheDocument();
    expect(screen.getAllByText(/₹2,900/).length).toBeGreaterThan(0);
  });

  it('offers to activate waiting mailboxes when the trial has not started', async () => {
    const waiting: CartData = {
      ...cart,
      trial: { started: false, startedAt: null, endsAt: null, daysRemaining: 0, isTrialing: false },
      hasPaymentMethod: false,
      paymentMethod: null,
      requiresActivation: true,
      pendingMailboxes: [{ id: 'm1', address: 'a@acme.com', domainId: 'dom-1', domainName: 'acme.com', planName: 'Starter', ratePaise: 10000, createdAt: '2026-09-24T00:00:00.000Z' }],
    };
    vi.mocked(api.getCart).mockResolvedValue(waiting);
    const onOpenCart = vi.fn();

    render(<BillingView cart={waiting} onOpenCart={onOpenCart} onCartUpdated={onCartUpdated} />);

    await userEvent.click(await screen.findByRole('button', { name: /activate 1 waiting mailbox/i }));
    expect(onOpenCart).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /change payment method/i })).not.toBeInTheDocument();
  });

  it('Change payment method opens the hosted Stripe card screen', async () => {
    vi.mocked(api.startCardUpdate).mockResolvedValue({ url: 'https://checkout.stripe.com/card-session' });
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, href: '' } });
    render(<BillingView cart={cart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);

    await userEvent.click(await screen.findByRole('button', { name: /change payment method/i }));
    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/card-session'));
    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });

  it('shows a prominent payment-failed banner', async () => {
    vi.mocked(api.getTenantBillingSummary).mockResolvedValue({ ...summary, status: 'past_due' });
    render(<BillingView cart={cart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);
    expect(await screen.findByText(/Payment failed\./)).toBeInTheDocument();
  });

  it('asks the Tenant Admin to authenticate a 3-D Secure payment instead of showing payment failed', async () => {
    vi.mocked(api.getTenantBillingSummary).mockResolvedValue({
      ...summary,
      status: 'grace',
      paymentActionUrl: 'https://invoice.stripe.com/i/in_3ds',
    });
    render(<BillingView cart={cart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);
    expect(await screen.findByRole('link', { name: /Authenticate payment/ })).toHaveAttribute('href', 'https://invoice.stripe.com/i/in_3ds');
    expect(screen.queryByText(/Payment failed\./)).not.toBeInTheDocument();
  });

  it('once suspended, shows only the suspension banner even if a 3-D Secure link is pending', async () => {
    vi.mocked(api.getTenantBillingSummary).mockResolvedValue({
      ...summary,
      status: 'suspended',
      paymentActionUrl: 'https://invoice.stripe.com/i/in_3ds',
    });
    render(<BillingView cart={cart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);
    expect(await screen.findByText(/suspended due to non-payment/)).toBeInTheDocument();
    expect(screen.queryByText(/Mail keeps working/)).not.toBeInTheDocument();
  });

  it('falls back to the summary for each domain when the cart has no domains', async () => {
    const emptyCart: CartData = { ...cart, domains: [] };
    vi.mocked(api.getCart).mockResolvedValue(emptyCart);
    vi.mocked(api.getTenantBillingSummary).mockResolvedValue({
      ...summary,
      domains: [
        { domainId: 'dom-1', domainName: 'acme.com', planName: 'Starter', seatCount: 10, activeUserCount: 3, maxUsers: 10, pricePerUserMonthlyPaise: 10000, monthlySubtotalPaise: 30000 },
      ],
    });
    render(<BillingView cart={emptyCart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);

    expect(await screen.findByText(/3 \/ 10 users/)).toBeInTheDocument();
    expect(screen.getByText(/₹300/)).toBeInTheDocument();
  });

  it('renders domain plans as clean badges and does not allow inline plan changes', async () => {
    render(<BillingView cart={cart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);

    expect(await screen.findByText('Starter')).toBeInTheDocument();
    expect(screen.getByText('Business')).toBeInTheDocument();
    expect(screen.queryByLabelText(/change plan for/i)).not.toBeInTheDocument();
  });

  it('cancels the whole subscription at period end after confirmation, without removing domains one by one', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.cancelTenantSubscription).mockResolvedValue({ success: true });
    render(<BillingView cart={cart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);

    await userEvent.click(await screen.findByRole('button', { name: /cancel subscription/i }));
    await waitFor(() => expect(api.cancelTenantSubscription).toHaveBeenCalledTimes(1));
    expect(api.cancelDomainSubscription).not.toHaveBeenCalled();
  });

  it('shows the error when cancelling fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.cancelTenantSubscription).mockRejectedValue(new Error('Stripe is unavailable'));
    render(<BillingView cart={cart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);

    await userEvent.click(await screen.findByRole('button', { name: /cancel subscription/i }));
    expect(await screen.findByText('Stripe is unavailable')).toBeInTheDocument();
  });

  it('lists invoice history', async () => {
    vi.mocked(api.listBillingInvoices).mockResolvedValue({
      invoices: [
        { id: 'in_1', status: 'paid', amountPaid: 320000, currency: 'inr', createdAt: '2026-09-01T00:00:00.000Z', hostedInvoiceUrl: 'https://invoice.stripe.com/test', invoicePdf: null },
      ],
    });
    render(<BillingView cart={cart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);

    expect(await screen.findByText('paid')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view/i })).toHaveAttribute('href', 'https://invoice.stripe.com/test');
  });

  it('renders domain-scoped billing view when activeDomain is provided', async () => {
    const activeDomain = {
      id: 'dom-1',
      domainName: 'acme.com',
      status: 'active',
      mailboxCount: 5,
      mailboxLimit: 10,
      planId: 'plan-starter',
      planName: 'Starter',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    } as any;

    render(<BillingView activeDomain={activeDomain} cart={cart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);

    // Domain-scoped header & tier
    expect(await screen.findByText('acme.com')).toBeInTheDocument();
    expect(screen.getByText('Starter')).toBeInTheDocument();
    expect(screen.getByText(/5 \/ 10 seats/)).toBeInTheDocument();
    expect(screen.getByText('Seat Utilization & Quota Limits')).toBeInTheDocument();
    expect(screen.getByText('Organization Master Subscription')).toBeInTheDocument();

    // Does NOT render the other domain or the 18-domain table
    expect(screen.queryByText('acme.in')).not.toBeInTheDocument();
    expect(screen.queryByText('Domains & plans')).not.toBeInTheDocument();
  });
});

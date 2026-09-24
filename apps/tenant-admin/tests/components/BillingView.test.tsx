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
  cancelAtPeriodEnd: false,
  domains: [],
} as any;

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
    vi.mocked(api.getTenantBillingSummary).mockResolvedValue({ ...summary, status: 'past_due' } as any);
    render(<BillingView cart={cart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);
    expect(await screen.findByText(/Payment failed\./)).toBeInTheDocument();
  });

  it('changes a domain plan independently of the others', async () => {
    vi.mocked(api.upgradeDomainPlan).mockResolvedValue({} as any);
    render(<BillingView cart={cart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);

    await userEvent.selectOptions(await screen.findByLabelText('Change plan for acme.com'), 'plan-business');
    await waitFor(() => expect(api.upgradeDomainPlan).toHaveBeenCalledWith('dom-1', 'plan-business'));
  });

  it('cancels every domain subscription after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.cancelDomainSubscription).mockResolvedValue({ success: true });
    render(<BillingView cart={cart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);

    await userEvent.click(await screen.findByRole('button', { name: /cancel subscription/i }));
    await waitFor(() => {
      expect(api.cancelDomainSubscription).toHaveBeenCalledWith('dom-1');
      expect(api.cancelDomainSubscription).toHaveBeenCalledWith('dom-2');
    });
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
});

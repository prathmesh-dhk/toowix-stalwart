import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
    keepCurrentPlan: vi.fn(),
    cancelDomainSubscription: vi.fn(),
    selectDomainPlan: vi.fn(),
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
  gracePeriodEndsAt: null,
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
    // No Grace Period end yet: the undated wording stays.
    expect(screen.getByText(/Mail keeps working for now/)).toBeInTheDocument();
  });

  it('the payment-failed banner says when mail stops, with Update Card beside it', async () => {
    vi.mocked(api.getTenantBillingSummary).mockResolvedValue({ ...summary, status: 'grace', gracePeriodEndsAt: '2026-11-02T00:00:00.000Z' });
    render(<BillingView cart={cart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);
    expect(await screen.findByText(/Mail stops on 2 Nov 2026 unless you pay\./)).toBeInTheDocument();
    expect(screen.queryByText(/Mail keeps working for now/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update Card' })).toBeInTheDocument();
  });

  it('says mail stops today once the Grace Period end has passed but the sweep has not suspended yet', async () => {
    vi.mocked(api.getTenantBillingSummary).mockResolvedValue({ ...summary, status: 'grace', gracePeriodEndsAt: new Date(Date.now() - 60000).toISOString() });
    render(<BillingView cart={cart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);
    expect(await screen.findByText(/Mail stops today unless you pay\./)).toBeInTheDocument();
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
        { domainId: 'dom-1', domainName: 'acme.com', planId: 'plan-starter', planName: 'Starter', seatCount: 10, activeUserCount: 3, maxUsers: 10, pricePerUserMonthlyPaise: 10000, monthlySubtotalPaise: 30000, pendingDowngrade: null },
      ],
    });
    render(<BillingView cart={emptyCart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);

    expect(await screen.findByText(/3 \/ 10 users/)).toBeInTheDocument();
    expect(screen.getByText(/₹300/)).toBeInTheDocument();
  });

  it('renders domain plans as clean badges, with no Change plan while billing is disabled', async () => {
    render(<BillingView cart={cart} onOpenCart={vi.fn()} onCartUpdated={onCartUpdated} />);

    expect(await screen.findByText('Starter')).toBeInTheDocument();
    expect(screen.getByText('Business')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /change plan/i })).not.toBeInTheDocument();
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

describe("BillingView: changing a domain's Plan", () => {
  const periodEnd = '2026-11-30T00:00:00.000Z';
  const changePlans: Plan[] = [
    { id: 'plan-mini', name: 'Mini', seatCount: 3, displayOrder: 0, isActive: true, isDefault: false, billingMode: 'metered', monthlyPriceInPaise: 5000 },
    { id: 'plan-basic', name: 'Basic', seatCount: 10, displayOrder: 1, isActive: true, isDefault: false, billingMode: 'metered', monthlyPriceInPaise: 8000 },
    { id: 'plan-starter', name: 'Starter', seatCount: 10, displayOrder: 2, isActive: true, isDefault: false, billingMode: 'metered', monthlyPriceInPaise: 10000 },
    { id: 'plan-business', name: 'Business', seatCount: 50, displayOrder: 3, isActive: true, isDefault: false, billingMode: 'metered', monthlyPriceInPaise: 20000 },
    { id: 'plan-retired', name: 'Retired', seatCount: 50, displayOrder: 4, isActive: false, isDefault: false, billingMode: 'metered', monthlyPriceInPaise: 1000 },
  ];
  const billedDomain = (over: Partial<TenantBillingSummary['domains'][number]> = {}): TenantBillingSummary['domains'][number] => ({
    domainId: 'dom-1', domainName: 'acme.com', planId: 'plan-starter', planName: 'Starter', seatCount: 10, activeUserCount: 5, maxUsers: 10,
    pricePerUserMonthlyPaise: 10000, monthlySubtotalPaise: 50000, cancelled: false, pendingDowngrade: null, gracePeriodEndsAt: null, ...over,
  });
  const billedSummary = (over: Partial<TenantBillingSummary['domains'][number]> = {}): TenantBillingSummary => ({
    ...summary, status: 'active', currentPeriodEnd: periodEnd, domains: [billedDomain(over)],
  });
  const oneDomainCart: CartData = { ...cart, domains: [cart.domains[0]] };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getBillingConfig).mockResolvedValue({ publishableKey: '', billingEnabled: true });
    vi.mocked(api.getCart).mockResolvedValue(oneDomainCart);
    vi.mocked(api.getTenantBillingSummary).mockResolvedValue(billedSummary());
    vi.mocked(api.listPlans).mockResolvedValue({ plans: changePlans });
    vi.mocked(api.listBillingInvoices).mockResolvedValue({ invoices: [] });
    vi.mocked(api.listPaymentMethods).mockResolvedValue({ paymentMethods: [], defaultPaymentMethodId: null });
  });

  // No cart prop: the view then shows the cart it reloads after a change, as the app's parent does via onCartUpdated.
  const renderOrgView = () => render(<BillingView onOpenCart={vi.fn()} />);
  const rowPlan = (name: string) => within(screen.getByRole('table')).getByText(name);
  const openDialog = async () => {
    await userEvent.click(await screen.findByRole('button', { name: /change plan/i }));
    return screen.getByRole('dialog');
  };
  const choose = async (name: string) => {
    const dialog = await openDialog();
    await userEvent.click(option(dialog, name));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    return dialog;
  };
  const option = (dialog: HTMLElement, name: string) => within(dialog).getByRole('button', { name: new RegExp(`^${name}\\b`) });

  it("lists every active Plan with its price per Active User and this domain's monthly cost, current Plan marked", async () => {
    renderOrgView();
    const dialog = await openDialog();

    expect(within(dialog).queryByText('Retired')).not.toBeInTheDocument();
    // acme.com has 5 Active Users.
    expect(option(dialog, 'Business')).toHaveTextContent('₹200 / Active User');
    expect(option(dialog, 'Business')).toHaveTextContent('₹1,000 / month');
    expect(option(dialog, 'Basic')).toHaveTextContent('₹400 / month');
    expect(option(dialog, 'Starter')).toHaveTextContent('Current plan');
    expect(option(dialog, 'Starter')).toBeDisabled();
    expect(option(dialog, 'Business')).toHaveTextContent('Starts now; the difference is prorated on your next invoice');
    expect(option(dialog, 'Basic')).toHaveTextContent('Starts on 30 Nov 2026');
  });

  it("disables a Plan whose user limit is below the domain's Active Users, with the reason", async () => {
    renderOrgView();
    const dialog = await openDialog();

    expect(option(dialog, 'Mini')).toBeDisabled();
    expect(option(dialog, 'Mini')).toHaveTextContent('Allows up to 3 Active Users; acme.com has 5');
    expect(option(dialog, 'Basic')).toBeEnabled();
  });

  it('prices against the billed subscription, not the cart', async () => {
    vi.mocked(api.getTenantBillingSummary).mockResolvedValue(billedSummary({ activeUserCount: 2 }));
    renderOrgView();
    const dialog = await openDialog();

    expect(option(dialog, 'Business')).toHaveTextContent('₹400 / month');
    expect(option(dialog, 'Mini')).toBeEnabled();
  });

  it('changes nothing until the choice is confirmed', async () => {
    renderOrgView();
    const dialog = await openDialog();
    await userEvent.click(option(dialog, 'Business'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.upgradeDomainPlan).not.toHaveBeenCalled();
  });

  it('is offered in the single-domain view too', async () => {
    const activeDomain = { id: 'dom-1', domainName: 'acme.com', status: 'active', mailboxCount: 5, mailboxLimit: 10, planId: 'plan-starter', planName: 'Starter' } as any;
    render(<BillingView activeDomain={activeDomain} onOpenCart={vi.fn()} />);
    expect(option(await openDialog(), 'Business')).toBeEnabled();
  });

  it('is hidden when the domain has no billed subscription yet', async () => {
    vi.mocked(api.getTenantBillingSummary).mockResolvedValue({ ...summary, domains: [] });
    renderOrgView();
    expect(await screen.findByText('acme.com')).toBeInTheDocument();
    await waitFor(() => expect(api.getBillingConfig).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /change plan/i })).not.toBeInTheDocument();
  });

  it('an upgrade calls the upgrade endpoint, shows the new Plan straight away and clears a pending downgrade', async () => {
    vi.mocked(api.getTenantBillingSummary).mockResolvedValue(
      billedSummary({ pendingDowngrade: { planId: 'plan-basic', planName: 'Basic', effectiveAt: periodEnd } })
    );
    vi.mocked(api.upgradeDomainPlan).mockImplementation(async () => {
      vi.mocked(api.getCart).mockResolvedValue({ ...oneDomainCart, domains: [{ ...oneDomainCart.domains[0], planId: 'plan-business', planName: 'Business', ratePaise: 20000 }] });
      vi.mocked(api.getTenantBillingSummary).mockResolvedValue(billedSummary({ planId: 'plan-business', planName: 'Business' }));
      return { success: true };
    });
    renderOrgView();
    expect(await screen.findByText('Moves to Basic on 30 Nov 2026')).toBeInTheDocument();

    await choose('Business');

    expect(api.upgradeDomainPlan).toHaveBeenCalledWith('dom-1', 'plan-business');
    expect(api.downgradeDomainPlan).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await within(screen.getByRole('table')).findByText('Business')).toBeInTheDocument();
    expect(screen.queryByText(/Moves to/)).not.toBeInTheDocument();
  });

  it('a downgrade calls the downgrade endpoint and the row shows the pending move; a second downgrade replaces it', async () => {
    vi.mocked(api.downgradeDomainPlan).mockImplementation(async (_domainId, planId) => {
      vi.mocked(api.getTenantBillingSummary).mockResolvedValue(
        billedSummary({ activeUserCount: 2, pendingDowngrade: { planId, planName: planId === 'plan-basic' ? 'Basic' : 'Mini', effectiveAt: periodEnd } })
      );
      return { success: true };
    });
    vi.mocked(api.getTenantBillingSummary).mockResolvedValue(billedSummary({ activeUserCount: 2 }));
    renderOrgView();

    await choose('Basic');
    expect(api.downgradeDomainPlan).toHaveBeenCalledWith('dom-1', 'plan-basic');
    expect(api.upgradeDomainPlan).not.toHaveBeenCalled();
    expect(await screen.findByText('Moves to Basic on 30 Nov 2026')).toBeInTheDocument();
    // Today's charges stay on the current Plan.
    expect(rowPlan('Starter')).toBeInTheDocument();

    await choose('Mini');
    expect(await screen.findByText('Moves to Mini on 30 Nov 2026')).toBeInTheDocument();
    expect(screen.queryByText(/Moves to Basic/)).not.toBeInTheDocument();
  });

  it('Keep current plan on the pending badge cancels the downgrade and the badge disappears', async () => {
    vi.mocked(api.getTenantBillingSummary).mockResolvedValue(
      billedSummary({ pendingDowngrade: { planId: 'plan-basic', planName: 'Basic', effectiveAt: periodEnd } })
    );
    vi.mocked(api.keepCurrentPlan).mockImplementation(async () => {
      vi.mocked(api.getTenantBillingSummary).mockResolvedValue(billedSummary());
      return { success: true };
    });
    renderOrgView();
    expect(await screen.findByText('Moves to Basic on 30 Nov 2026')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Keep current plan' }));

    expect(api.keepCurrentPlan).toHaveBeenCalledWith('dom-1');
    await waitFor(() => expect(screen.queryByText(/Moves to/)).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Keep current plan' })).not.toBeInTheDocument();
    expect(rowPlan('Starter')).toBeInTheDocument();
  });

  it('a refusal shows the backend message and leaves the Plan unchanged', async () => {
    vi.mocked(api.downgradeDomainPlan).mockRejectedValue(
      new Error('Cannot downgrade to Basic: domain has 11 active mailboxes, which exceeds the plan limit of 10.')
    );
    renderOrgView();
    const dialog = await choose('Basic');

    expect(await within(dialog).findByText(/exceeds the plan limit of 10/)).toBeInTheDocument();
    expect(rowPlan('Starter')).toBeInTheDocument();
    expect(screen.queryByText(/Moves to/)).not.toBeInTheDocument();
  });

  describe('cancelling a domain and choosing a plan again', () => {
    const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr') as HTMLElement;
    const twoBilled = (first: Partial<TenantBillingSummary['domains'][number]> = {}): TenantBillingSummary => ({
      ...billedSummary(first),
      domains: [billedDomain(first), billedDomain({ domainId: 'dom-2', domainName: 'acme.in', planId: 'plan-business', planName: 'Business' })],
    });

    it('with other domains billed, says mail stops now; confirming cancels the domain and the row shows cancelled', async () => {
      vi.mocked(api.getCart).mockResolvedValue(cart);
      vi.mocked(api.getTenantBillingSummary).mockResolvedValue(twoBilled());
      vi.mocked(api.cancelDomainSubscription).mockImplementation(async () => {
        vi.mocked(api.getTenantBillingSummary).mockResolvedValue(twoBilled({ cancelled: true, monthlySubtotalPaise: 0 }));
        return { success: true };
      });
      renderOrgView();

      await userEvent.click(within(await rowOf('acme.com')).getByRole('button', { name: 'Cancel this domain' }));
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent("acme.com's mail stops now and it comes off your bill.");
      await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

      expect(api.cancelDomainSubscription).toHaveBeenCalledWith('dom-1');
      expect(api.cancelTenantSubscription).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      const row = await rowOf('acme.com');
      expect(await within(row).findByText('Cancelled')).toBeInTheDocument();
      expect(row).toHaveTextContent('₹0');
      expect(within(row).getByRole('button', { name: 'Choose a plan again' })).toBeInTheDocument();
      expect(within(row).queryByRole('button', { name: /change plan|cancel this domain/i })).not.toBeInTheDocument();
    });

    it('as the only billed domain, says the subscription ends at period end and mail works until then', async () => {
      renderOrgView();

      await userEvent.click(await screen.findByRole('button', { name: 'Cancel this domain' }));

      expect(screen.getByRole('dialog')).toHaveTextContent(
        'This cancels your subscription at the end of the period, on 30 Nov 2026. Mail keeps working until then.'
      );
    });

    it('closing the confirm cancels nothing', async () => {
      renderOrgView();
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel this domain' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(api.cancelDomainSubscription).not.toHaveBeenCalled();
    });

    it('Choose a plan again picks a Plan through Plan selection and the domain is billed again', async () => {
      vi.mocked(api.getTenantBillingSummary).mockResolvedValue(twoBilled({ cancelled: true, monthlySubtotalPaise: 0 }));
      vi.mocked(api.selectDomainPlan).mockImplementation(async () => {
        vi.mocked(api.getTenantBillingSummary).mockResolvedValue(twoBilled({ planId: 'plan-business', planName: 'Business' }));
        return { success: true } as any;
      });
      renderOrgView();

      await userEvent.click(await screen.findByRole('button', { name: 'Choose a plan again' }));
      const dialog = screen.getByRole('dialog');
      // Its old Plan is a choice like any other.
      expect(option(dialog, 'Starter')).toBeEnabled();
      expect(option(dialog, 'Business')).toHaveTextContent('Billed from today; its mail switches back on');
      await userEvent.click(option(dialog, 'Business'));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

      expect(api.selectDomainPlan).toHaveBeenCalledWith('dom-1', 'plan-business');
      expect(api.upgradeDomainPlan).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(await screen.findByRole('button', { name: /change plan/i })).toBeInTheDocument();
      expect(screen.queryByText('Cancelled')).not.toBeInTheDocument();
    });

    it('is offered in the single-domain view too', async () => {
      const activeDomain = { id: 'dom-1', domainName: 'acme.com', status: 'active', mailboxCount: 5, mailboxLimit: 10, planId: 'plan-starter', planName: 'Starter' } as any;
      render(<BillingView activeDomain={activeDomain} onOpenCart={vi.fn()} />);
      expect(await screen.findByRole('button', { name: 'Cancel this domain' })).toBeInTheDocument();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CartPage } from '../../src/components/cart/CartPage';
import { CartNavButton, cartBadgeCount } from '../../src/components/cart/CartNavButton';
import { api } from '../../src/api';
import { CartData } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: {
    getCart: vi.fn(),
    startCartCheckout: vi.fn(),
    completeCartCheckout: vi.fn(),
    completeCardUpdate: vi.fn(),
    activateCart: vi.fn(),
    validateCoupon: vi.fn(),
    redeemCoupon: vi.fn(),
    listPaymentMethods: vi.fn().mockResolvedValue({ paymentMethods: [], defaultPaymentMethodId: null }),
    getBillingConfig: vi.fn().mockResolvedValue({ publishableKey: '', billingEnabled: false }),
    createTenantSetupIntent: vi.fn().mockResolvedValue({ clientSecret: 'bypassed' }),
    savePaymentMethod: vi.fn(),
  },
}));

const baseCart: CartData = {
  trial: { started: false, startedAt: null, endsAt: null, daysRemaining: 0, isTrialing: false },
  hasPaymentMethod: false,
  paymentMethod: null,
  requiresActivation: false,
  pendingMailboxes: [],
  domains: [],
  estimatedMonthlyPaise: 0,
  previousEstimatedMonthlyPaise: 0,
  dueTodayPaise: 0,
  recentChanges: [],
};

const pendingCart: CartData = {
  ...baseCart,
  requiresActivation: true,
  pendingMailboxes: [
    { id: 'mb-1', address: 'john@acme.com', domainId: 'dom-1', domainName: 'acme.com', planName: 'Starter', ratePaise: 10000, createdAt: new Date().toISOString() },
    { id: 'mb-2', address: 'raj@acme.in', domainId: 'dom-2', domainName: 'acme.in', planName: 'Business', ratePaise: 20000, createdAt: new Date().toISOString() },
  ],
  domains: [
    {
      domainId: 'dom-1', domainName: 'acme.com', planId: 'p1', planName: 'Starter', activeUsers: 0, pendingUsers: 1, maxUsers: 10, ratePaise: 10000, monthlyPaise: 10000,
      users: [{ id: 'mb-1', address: 'john@acme.com', status: 'suspended', pendingActivation: true }],
    },
    {
      domainId: 'dom-2', domainName: 'acme.in', planId: 'p2', planName: 'Business', activeUsers: 0, pendingUsers: 1, maxUsers: 50, ratePaise: 20000, monthlyPaise: 20000,
      users: [{ id: 'mb-2', address: 'raj@acme.in', status: 'suspended', pendingActivation: true }],
    },
  ],
  estimatedMonthlyPaise: 30000,
};

describe('CartPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/cart');
    vi.mocked(api.getCart).mockResolvedValue(pendingCart);
    vi.mocked(api.listPaymentMethods).mockResolvedValue({ paymentMethods: [], defaultPaymentMethodId: null });
    vi.mocked(api.getBillingConfig).mockResolvedValue({ publishableKey: '', billingEnabled: false });
    vi.mocked(api.createTenantSetupIntent).mockResolvedValue({ clientSecret: 'bypassed' });
  });

  it('lists every domain with its plan and users, and totals them in the order summary', async () => {
    render(<CartPage onBack={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'acme.com' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'acme.in' })).toBeInTheDocument();
    expect(screen.getByText('john@acme.com')).toBeInTheDocument();
    expect(screen.getByText('raj@acme.in')).toBeInTheDocument();
    expect(screen.getAllByText('waiting for activation')).toHaveLength(2);
    expect(screen.getByText(/2 users across 2 domains/)).toBeInTheDocument();
    expect(screen.getByText('₹300')).toBeInTheDocument();
    expect(screen.getByText(/Nothing is charged today/i)).toBeInTheDocument();
  });

  it('Ready for Checkout sends the tenant to the hosted Stripe screen', async () => {
    vi.mocked(api.startCartCheckout).mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_test' });
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, href: '', search: '', pathname: '/cart' } });

    render(<CartPage onBack={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /ready for checkout/i }));

    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/c/pay/cs_test'));
    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });

  it('without Stripe, checkout opens the sandbox card form and activation starts the trial', async () => {
    const activated: CartData = {
      ...pendingCart,
      requiresActivation: false,
      pendingMailboxes: [],
      trial: { started: true, startedAt: new Date().toISOString(), endsAt: new Date(Date.now() + 60 * 86400000).toISOString(), daysRemaining: 60, isTrialing: true },
    };
    vi.mocked(api.startCartCheckout).mockResolvedValue({ sandbox: true });
    vi.mocked(api.savePaymentMethod).mockResolvedValue({
      success: true,
      paymentMethod: { id: 'pm_1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030, isDefault: true },
    });
    vi.mocked(api.activateCart).mockResolvedValue({ success: true, activatedMailboxes: 2, trialEndsAt: activated.trial.endsAt!, cart: activated });

    render(<CartPage onBack={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /ready for checkout/i }));

    const dialog = await screen.findByRole('dialog', { name: /card confirmation/i });
    await userEvent.type(await within(dialog).findByPlaceholderText(/e\.g\. Rahul Sharma/i), 'Jane Doe');
    await userEvent.type(within(dialog).getByPlaceholderText('4242 4242 4242 4242'), '4242424242424242');
    await userEvent.type(within(dialog).getByPlaceholderText('MM/YY'), '1230');
    await userEvent.type(within(dialog).getByPlaceholderText('123'), '123');
    await userEvent.type(within(dialog).getByPlaceholderText('400001'), '400001');
    await userEvent.click(within(dialog).getByRole('button', { name: /confirm card & start trial/i }));

    await waitFor(() => expect(api.activateCart).toHaveBeenCalledWith(expect.objectContaining({ paymentMethodId: 'pm_1' })));
    expect(await screen.findByText(/your 60-day free trial has started/i)).toBeInTheDocument();
    expect(screen.getByText(/60-day trial · 60 days left/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ready for checkout/i })).not.toBeInTheDocument();
  });

  it('a valid promo code shows the extra trial days and is sent with the checkout request', async () => {
    vi.mocked(api.validateCoupon).mockResolvedValue({ valid: true, code: 'STARTUP30', extraTrialDays: 30, message: 'ok' });
    vi.mocked(api.startCartCheckout).mockResolvedValue({ sandbox: true });
    render(<CartPage onBack={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: /have a promo code/i }));
    await userEvent.type(screen.getByLabelText('Promo code'), 'startup30');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));

    expect(await screen.findByText(/\+30 trial days/)).toBeInTheDocument();
    expect(screen.getByText('90 days')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /ready for checkout/i }));
    await waitFor(() => expect(api.startCartCheckout).toHaveBeenCalledWith('STARTUP30'));
  });

  it('returning from the Stripe card screen saves the new card and confirms it', async () => {
    vi.mocked(api.completeCardUpdate).mockResolvedValue({ success: true, cart: pendingCart });
    window.history.replaceState({}, '', '/cart?card=success&session_id=cs_card_1');

    render(<CartPage onBack={vi.fn()} />);

    await waitFor(() => expect(api.completeCardUpdate).toHaveBeenCalledWith('cs_card_1'));
    expect(await screen.findByText(/payment method has been updated/i)).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('returning from Stripe with a session completes the checkout and clears the URL', async () => {
    const activated: CartData = {
      ...pendingCart,
      requiresActivation: false,
      pendingMailboxes: [],
      trial: { started: true, startedAt: new Date().toISOString(), endsAt: new Date(Date.now() + 60 * 86400000).toISOString(), daysRemaining: 60, isTrialing: true },
    };
    vi.mocked(api.completeCartCheckout).mockResolvedValue({ success: true, activatedMailboxes: 2, trialEndsAt: activated.trial.endsAt!, cart: activated });
    window.history.replaceState({}, '', '/cart?checkout=success&session_id=cs_test_123');

    render(<CartPage onBack={vi.fn()} />);

    await waitFor(() => expect(api.completeCartCheckout).toHaveBeenCalledWith('cs_test_123'));
    expect(await screen.findByText(/card confirmed/i)).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('a cancelled Stripe checkout says nothing was charged', async () => {
    window.history.replaceState({}, '', '/cart?checkout=cancelled');
    render(<CartPage onBack={vi.fn()} />);
    expect(await screen.findByText(/nothing was charged/i)).toBeInTheDocument();
  });

  it('once the trial runs it is a tracker: no checkout button, back to dashboard instead', async () => {
    const running: CartData = { ...pendingCart, requiresActivation: false, pendingMailboxes: [], trial: { started: true, startedAt: 'x', endsAt: new Date(Date.now() + 43 * 86400000).toISOString(), daysRemaining: 43, isTrialing: true }, paymentMethod: { brand: 'visa', last4: '4242' }, hasPaymentMethod: true };
    vi.mocked(api.getCart).mockResolvedValue(running);
    const onBack = vi.fn();
    render(<CartPage onBack={onBack} />);

    expect(await screen.findByText(/60-day trial · 43 days left/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ready for checkout/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /back to dashboard/i })[1]);
    expect(onBack).toHaveBeenCalled();
  });
});

describe('CartNavButton badge', () => {
  it('counts mailboxes waiting for activation', () => {
    expect(cartBadgeCount(pendingCart, null)).toBe(2);
  });

  it('after activation counts only billing changes newer than the last visit', () => {
    const cart: CartData = {
      ...baseCart,
      trial: { started: true, startedAt: 'x', endsAt: 'y', daysRemaining: 10, isTrialing: true },
      recentChanges: [
        { id: 'a', at: '2026-09-20T00:00:00.000Z', kind: 'USER_ADDED', label: 'a', domainName: null, monthlyDeltaPaise: 0 },
        { id: 'b', at: '2026-09-24T00:00:00.000Z', kind: 'USER_ADDED', label: 'b', domainName: null, monthlyDeltaPaise: 0 },
      ],
    };
    expect(cartBadgeCount(cart, '2026-09-22T00:00:00.000Z')).toBe(1);
    expect(cartBadgeCount(cart, null)).toBe(2);
  });

  it('shows the pending count on the button', () => {
    render(<CartNavButton cart={pendingCart} lastSeenAt={null} onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /cart/i })).toHaveTextContent('2');
  });
});

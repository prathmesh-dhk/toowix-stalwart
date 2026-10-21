import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { CartData } from '../../src/types';

const cart = vi.hoisted((): CartData => ({
  trial: { started: true, startedAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-30T00:00:00.000Z', daysRemaining: 40, isTrialing: true },
  hasPaymentMethod: true,
  paymentMethod: { brand: 'visa', last4: '4242' },
  subscriptionEnded: false,
  requiresActivation: false,
  pendingMailboxes: [],
  domains: [],
  estimatedMonthlyPaise: 0,
  previousEstimatedMonthlyPaise: 0,
  dueTodayPaise: 0,
  recentChanges: [],
}));

// Every call the pages behind the Cart make stays pending; only who's signed in and the cart answer.
vi.mock('../../src/api', () => {
  const answers: Record<string, unknown> = {
    getMe: { user: { id: 'u1', email: 'admin@acme.com', role: 'TENANT_ADMIN', tenantId: 't1', tenantName: 'Acme' } },
    getCart: cart,
  };
  return {
    getStoredToken: () => 'token',
    clearStoredToken: vi.fn(),
    api: new Proxy({}, { get: (_t, name: string) => vi.fn(() => (name in answers ? Promise.resolve(answers[name]) : new Promise(() => {}))) }),
  };
});

import { AppContent } from '../../src/App';

const Where = () => <div data-testid="where">{useLocation().pathname}</div>;

describe('Cart: Back to dashboard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('after returning from Stripe Checkout, goes to the dashboard instead of back to the paid Checkout page', async () => {
    // Stripe's redirect is a fresh page load: the Cart is the first page in the app's history,
    // with the paid Checkout page (and whatever came before it) behind it in the browser's.
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
    render(
      <MemoryRouter initialEntries={['/cart?checkout=success&session_id=cs_test_1']}>
        <AppContent />
        <Where />
      </MemoryRouter>
    );

    await userEvent.click((await screen.findAllByRole('button', { name: /back to dashboard/i }))[0]);

    expect(screen.getByTestId('where')).toHaveTextContent('/overview');
  });

  it('opened from inside the app, goes back to the page it was opened from', async () => {
    render(
      <MemoryRouter initialEntries={['/billing', '/cart']} initialIndex={1}>
        <AppContent />
        <Where />
      </MemoryRouter>
    );

    await userEvent.click((await screen.findAllByRole('button', { name: /back to dashboard/i }))[0]);

    expect(screen.getByTestId('where')).toHaveTextContent('/billing');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DomainSetupModal } from '../../src/components/DomainSetupModal';
import { api } from '../../src/api';

vi.mock('../../src/api', () => ({
  api: {
    createTenantDomain: vi.fn(),
    connectDnsProviderCredential: vi.fn(),
    useSavedDnsProviderCredential: vi.fn(),
    listTenantDnsCredentials: vi.fn(),
    saveTenantDnsCredential: vi.fn(),
    deleteTenantDnsCredential: vi.fn(),
    getDomainDnsStatus: vi.fn(),
    listPlans: vi.fn(),
    startDomainCheckout: vi.fn(),
    selectDomainPlan: vi.fn(),
    detectDnsProvider: vi.fn(),
    checkDomainAvailability: vi.fn(),
    deleteDomain: vi.fn(),
    listPaymentMethods: vi.fn(),
    getBillingConfig: vi.fn(),
    attachDomainWithSavedPayment: vi.fn(),
  },
}));

const MOCK_PLANS = [
  { id: 'plan-starter', name: 'Starter', badge: null, description: 'Email only — up to 10 mailboxes', seatCount: 10, displayOrder: 1, isActive: true, isDefault: false, billingMode: 'metered' as const, monthlyPriceInPaise: 4900, storageQuotaGb: 5, apps: [] },
  { id: 'plan-pro', name: 'Pro', badge: 'Most Popular', description: 'Email + Toowix Suite — up to 20 mailboxes', seatCount: 20, displayOrder: 2, isActive: true, isDefault: true, billingMode: 'metered' as const, monthlyPriceInPaise: 9900, storageQuotaGb: 20, apps: ['meet', 'sign'] },
  { id: 'plan-enterprise', name: 'Enterprise', badge: null, description: 'Unlimited mailboxes — full Toowix Suite + 30 GB', seatCount: 9999, displayOrder: 3, isActive: true, isDefault: false, billingMode: 'metered' as const, monthlyPriceInPaise: 14900, storageQuotaGb: 30, apps: ['meet', 'sign'] },
];

/** Domain as returned by createTenantDomain — no plan yet; the wizard only asks for one after DNS. */
function planlessDomain(id: string, domainName: string) {
  return {
    id,
    domainName,
    status: 'active',
    dnsStatus: 'not_started' as const,
    mailboxLimit: 10,
    employeeCount: 10,
    planId: null,
    planName: null,
    mailboxCount: 0,
    isPrimary: false,
  };
}

/** Types the domain name on step 1 and submits it — creates the domain and moves past it. */
async function enterDomainAndContinue(domain: string) {
  const input = screen.getByPlaceholderText(/enter your domain name|acme-tech\.com/i);
  await userEvent.type(input, domain);
  await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));
}

describe('DomainSetupModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
    vi.mocked(api.listPlans).mockResolvedValue({ plans: MOCK_PLANS });
    vi.mocked(api.listTenantDnsCredentials).mockResolvedValue({ credentials: [] });
    vi.mocked(api.getDomainDnsStatus).mockResolvedValue({
      dnsStatus: 'not_started',
      dnsRecords: [],
      dnsConflicts: [],
      dnsZoneFile: null,
    });
    // Default: no provider detected, so existing tests keep landing on the
    // method-picker step exactly as before this feature was added.
    vi.mocked(api.detectDnsProvider).mockResolvedValue({ provider: null, nameservers: [] });
    vi.mocked(api.checkDomainAvailability).mockResolvedValue({ available: true });
    vi.mocked(api.deleteDomain).mockResolvedValue({ success: true, domainName: 'x' });
    vi.mocked(api.selectDomainPlan).mockResolvedValue({
      success: true,
      domain: { id: 'dom-x', domainName: 'x', mailboxLimit: 20, employeeCount: 20, planId: 'plan-pro', planName: 'Pro' },
    });
    vi.mocked(api.listPaymentMethods).mockResolvedValue({
      paymentMethods: [{ id: 'pm_saved', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030, isDefault: true }],
      defaultPaymentMethodId: 'pm_saved',
    });
    vi.mocked(api.getBillingConfig).mockResolvedValue({ publishableKey: '', billingEnabled: false });
    vi.mocked(api.attachDomainWithSavedPayment).mockResolvedValue({ success: true, status: 'trialing' });
  });

  it('blocks advancing past the domain step when the domain is already taken, without creating a domain', async () => {
    vi.mocked(api.checkDomainAvailability).mockResolvedValue({ available: false });

    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/enter your domain name|acme-tech\.com/i), 'takenbrand.com');
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    expect(api.checkDomainAvailability).toHaveBeenCalledWith('takenbrand.com');
    expect(await screen.findByText(/already registered on toowix/i)).toBeInTheDocument();
    expect(screen.queryByText('How do you want to set up DNS?')).not.toBeInTheDocument();
    expect(api.createTenantDomain).not.toHaveBeenCalled();
  });

  it('creates the domain with no plan yet, then lands on the method picker when no DNS provider is detected', async () => {
    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: planlessDomain('dom-new-0', 'acme-tech.com'),
    });

    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);

    expect(screen.getByText(/Let's start with a name for your domain/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/enter your domain name|acme-tech\.com/i)).toBeInTheDocument();

    await enterDomainAndContinue('acme-tech.com');

    await waitFor(() => expect(api.createTenantDomain).toHaveBeenCalledWith({ domainName: 'acme-tech.com' }));
    expect(api.detectDnsProvider).toHaveBeenCalledWith('acme-tech.com');
    expect(await screen.findByText('How do you want to set up DNS?')).toBeInTheDocument();
  });

  it('creates the domain, auto-detects GoDaddy, connects it, and only asks for a plan after DNS is set up', async () => {
    const onClose = vi.fn();
    const onDomainAdded = vi.fn();

    vi.mocked(api.detectDnsProvider).mockResolvedValueOnce({
      provider: 'godaddy',
      nameservers: ['ns1.domaincontrol.com', 'ns2.domaincontrol.com'],
    });
    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: planlessDomain('dom-new-1', 'newbrand.io'),
    });
    vi.mocked(api.connectDnsProviderCredential).mockResolvedValueOnce({
      success: true,
      verifiedProviderDomain: 'newbrand.io',
      connectedAt: new Date().toISOString(),
    });
    vi.mocked(api.selectDomainPlan).mockResolvedValueOnce({
      success: true,
      domain: { id: 'dom-new-1', domainName: 'newbrand.io', mailboxLimit: 20, employeeCount: 20, planId: 'plan-pro', planName: 'Pro' },
    });

    render(<DomainSetupModal isOpen={true} onClose={onClose} onDomainAdded={onDomainAdded} />);

    // Step 1: domain name — creates the domain immediately (no plan yet).
    await enterDomainAndContinue('newbrand.io');
    await waitFor(() => expect(api.createTenantDomain).toHaveBeenCalledWith({ domainName: 'newbrand.io' }));
    expect(api.detectDnsProvider).toHaveBeenCalledWith('newbrand.io');

    // Method picker is skipped — GoDaddy was auto-detected from nameservers,
    // so the wizard lands directly on its credential form.
    expect(screen.queryByText('How do you want to set up DNS?')).not.toBeInTheDocument();
    expect(await screen.findByText(/^Connect GoDaddy$/)).toBeInTheDocument();
    expect(screen.getByText(/we detected/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/GoDaddy API Key/i), 'test-key');
    await userEvent.type(screen.getByLabelText(/GoDaddy API Secret/i), 'test-secret');
    await userEvent.click(screen.getByRole('button', { name: /verify . connect/i }));

    expect(api.connectDnsProviderCredential).toHaveBeenCalledWith(
      'dom-new-1',
      {
        provider: 'godaddy',
        apiKey: 'test-key',
        apiSecret: 'test-secret',
      },
      true
    );

    // Wizard auto-advances to status step immediately after credential verification
    expect(await screen.findByText('DNS Setup — newbrand.io')).toBeInTheDocument();
    // No plan asked for yet — that's the whole point of the reorder.
    expect(screen.queryByText('Choose a plan')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /continue to plan selection/i }));

    expect(await screen.findByText('Choose a plan')).toBeInTheDocument();
    await screen.findAllByText('Pro'); // default-selected (Pro is isDefault: true)
    await userEvent.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() => expect(api.selectDomainPlan).toHaveBeenCalledWith('dom-new-1', 'plan-pro'));

    // Wizard finishes right after plan selection — no payment step, payment is
    // deferred to the Billing tab / first mailbox creation.
    expect(api.attachDomainWithSavedPayment).not.toHaveBeenCalled();

    expect(onDomainAdded).toHaveBeenCalledWith(
      expect.objectContaining({
        domainName: 'newbrand.io',
        mailboxLimit: 20,
        planName: 'Pro',
        dnsStatus: 'not_started',
      })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('switches to Hostinger and connects with a single API token (method picker used to override an undetected provider)', async () => {
    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: planlessDomain('dom-new-2', 'otherbrand.io'),
    });
    vi.mocked(api.connectDnsProviderCredential).mockResolvedValueOnce({
      success: true,
      verifiedProviderDomain: 'otherbrand.io',
      connectedAt: new Date().toISOString(),
    });

    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);

    await enterDomainAndContinue('otherbrand.io');
    expect(await screen.findByText('How do you want to set up DNS?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^hostinger$/i }));
    await userEvent.type(screen.getByLabelText(/Hostinger API Token/i), 'hostinger-tok');
    await userEvent.click(screen.getByRole('button', { name: /verify . connect/i }));

    expect(api.connectDnsProviderCredential).toHaveBeenCalledWith(
      'dom-new-2',
      {
        provider: 'hostinger',
        token: 'hostinger-tok',
      },
      true
    );
    // Wizard auto-advances to status step — no intermediate "connected" screen
    expect(await screen.findByText(/DNS Setup/i)).toBeInTheDocument();
  });

  it('switches to Cloudflare and connects with a single API token', async () => {
    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: planlessDomain('dom-new-3', 'thirdbrand.dev'),
    });
    vi.mocked(api.connectDnsProviderCredential).mockResolvedValueOnce({
      success: true,
      verifiedProviderDomain: 'thirdbrand.dev',
      connectedAt: new Date().toISOString(),
    });

    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);

    await enterDomainAndContinue('thirdbrand.dev');
    expect(await screen.findByText('How do you want to set up DNS?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^cloudflare$/i }));
    await userEvent.type(screen.getByLabelText(/Cloudflare API Token/i), 'cf-tok');
    await userEvent.click(screen.getByRole('button', { name: /verify . connect/i }));

    expect(api.connectDnsProviderCredential).toHaveBeenCalledWith(
      'dom-new-3',
      {
        provider: 'cloudflare',
        token: 'cf-tok',
      },
      true
    );
    // Wizard auto-advances to status step — no intermediate "connected" screen
    expect(await screen.findByText(/DNS Setup/i)).toBeInTheDocument();
  });

  it('supports the manual DNS setup path with no credential, showing zone file', async () => {
    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: planlessDomain('dom-new-4', 'manualbrand.io'),
    });
    vi.mocked(api.getDomainDnsStatus).mockResolvedValue({
      dnsStatus: 'activating',
      dnsRecords: [{ type: 'MX', name: '@', value: 'mail.toowix.com', priority: 10, ttl: 3600, purpose: 'MX' }],
      dnsConflicts: [],
      dnsZoneFile: 'manualbrand.io. IN MX 10 mail.toowix.com.',
    });

    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);

    await enterDomainAndContinue('manualbrand.io');

    // Method picker is shown — nothing was auto-detected (default mock).
    expect(await screen.findByText('How do you want to set up DNS?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Manual DNS Setup/i }));

    expect(api.connectDnsProviderCredential).not.toHaveBeenCalled();
    expect(await screen.findByText('DNS Setup — manualbrand.io')).toBeInTheDocument();
    expect(await screen.findByText('DNS Zone File')).toBeInTheDocument();
    expect(screen.getByText(/manualbrand\.io\. IN MX 10 mail\.toowix\.com\./)).toBeInTheDocument();
  });

  it('polls DNS status for the created domain with the domain id (not a click event)', async () => {
    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: planlessDomain('64b7f0f0f0f0f0f0f0f0f0a1', 'refreshme.io'),
    });

    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);
    await enterDomainAndContinue('refreshme.io');
    await screen.findByText('How do you want to set up DNS?');
    await userEvent.click(screen.getByRole('button', { name: /Manual DNS Setup/i }));
    await screen.findByText('DNS Setup — refreshme.io');

    // The id must be the domain's id, never a click/PointerEvent leaking through — the server
    // rejects "/domains/[object PointerEvent]/…" as "Domain ID is missing or malformed".
    await waitFor(() => expect(api.getDomainDnsStatus).toHaveBeenCalledWith('64b7f0f0f0f0f0f0f0f0f0a1'));
    for (const [arg] of vi.mocked(api.getDomainDnsStatus).mock.calls) expect(typeof arg).toBe('string');
    expect(screen.queryByText(/missing or malformed/i)).not.toBeInTheDocument();
  });

  it('finishes the wizard right after plan selection — no payment step, payment is deferred', async () => {
    const onDomainAdded = vi.fn();
    const onClose = vi.fn();

    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: planlessDomain('dom-new-5', 'payable.io'),
    });
    vi.mocked(api.selectDomainPlan).mockResolvedValueOnce({
      success: true,
      domain: { id: 'dom-new-5', domainName: 'payable.io', mailboxLimit: 20, employeeCount: 20, planId: 'plan-pro', planName: 'Pro' },
    });

    render(<DomainSetupModal isOpen={true} onClose={onClose} onDomainAdded={onDomainAdded} />);

    await enterDomainAndContinue('payable.io');
    await screen.findByText('How do you want to set up DNS?');
    await userEvent.click(screen.getByRole('button', { name: /Manual DNS Setup/i }));
    await screen.findByText('DNS Setup — payable.io');

    await userEvent.click(screen.getByRole('button', { name: /continue to plan selection/i }));
    await screen.findByText('Choose a plan');
    await userEvent.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() => expect(onDomainAdded).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText('Add a payment method')).not.toBeInTheDocument();
    expect(api.attachDomainWithSavedPayment).not.toHaveBeenCalled();
    expect(api.deleteDomain).not.toHaveBeenCalled();
  });

  it('going back from the plan step to status, then re-selecting the same plan, finishes without re-requesting plan assignment', async () => {
    const onDomainAdded = vi.fn();
    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: planlessDomain('dom-backnav-plan', 'backplan.io'),
    });
    vi.mocked(api.selectDomainPlan).mockResolvedValueOnce({
      success: true,
      domain: { ...planlessDomain('dom-backnav-plan', 'backplan.io'), planId: 'plan-pro' },
    });

    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={onDomainAdded} />);
    await enterDomainAndContinue('backplan.io');
    await screen.findByText('How do you want to set up DNS?');
    await userEvent.click(screen.getByRole('button', { name: /Manual DNS Setup/i }));
    await screen.findByText('DNS Setup — backplan.io');

    await userEvent.click(screen.getByRole('button', { name: /continue to plan selection/i }));
    expect(await screen.findByText('Choose a plan')).toBeInTheDocument();

    // Back to status, then forward to plan again — selectDomainPlan hasn't been called yet.
    await userEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(await screen.findByText('DNS Setup — backplan.io')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /continue to plan selection/i }));
    expect(await screen.findByText('Choose a plan')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /finish setup/i }));
    await waitFor(() => expect(onDomainAdded).toHaveBeenCalled());
    expect(api.selectDomainPlan).toHaveBeenCalledTimes(1);
  });

  it('lets "Back" from an auto-skipped setup step reach the method picker as an override', async () => {
    vi.mocked(api.detectDnsProvider).mockResolvedValueOnce({
      provider: 'cloudflare',
      nameservers: ['aida.ns.cloudflare.com', 'walt.ns.cloudflare.com'],
    });
    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: planlessDomain('dom-back-0', 'backnav.io'),
    });

    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);

    await enterDomainAndContinue('backnav.io');

    // Auto-skipped straight to Cloudflare's form.
    expect(await screen.findByText(/^Connect Cloudflare$/)).toBeInTheDocument();

    // "Back" reaches the method picker, so a wrong auto-detection is always
    // one click away from being overridden.
    await userEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(await screen.findByText('How do you want to set up DNS?')).toBeInTheDocument();
  });

  it('finishes DNS setup directly (no status/zone-file screen) when using a saved provider key, and only then asks for a plan', async () => {
    vi.mocked(api.detectDnsProvider).mockResolvedValueOnce({
      provider: 'godaddy',
      nameservers: ['ns01.domaincontrol.com', 'ns02.domaincontrol.com'],
    });
    vi.mocked(api.listTenantDnsCredentials).mockResolvedValueOnce({
      credentials: [
        {
          id: 'cred-1',
          tenantId: 'tenant-1',
          provider: 'godaddy',
          keyPreview: 'UZ78...90AB',
          verifiedProviderDomain: 'dhkinnovations.com',
          isActive: true,
          createdAt: '2026-09-18T10:00:00Z',
          updatedAt: '2026-09-18T10:00:00Z',
        },
      ],
    });
    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: planlessDomain('dom-saved-1', 'dhkinnovations.com'),
    });
    vi.mocked(api.useSavedDnsProviderCredential).mockResolvedValueOnce({
      success: true,
      verifiedProviderDomain: 'dhkinnovations.com',
      recordsSynced: 5,
      syncPending: false,
    });

    const onDomainAdded = vi.fn();
    const onClose = vi.fn();
    render(<DomainSetupModal isOpen={true} onClose={onClose} onDomainAdded={onDomainAdded} />);

    await enterDomainAndContinue('dhkinnovations.com');

    // Land on Connect GoDaddy with saved key button
    expect(await screen.findByText(/^Connect GoDaddy$/)).toBeInTheDocument();
    const useSavedBtn = await screen.findByText(/Use saved GoDaddy key/i);
    await userEvent.click(useSavedBtn);

    expect(api.useSavedDnsProviderCredential).toHaveBeenCalledWith('dom-saved-1', 'godaddy');
    // Must NOT land on status/zone file step — goes straight to plan selection instead.
    expect(screen.queryByText(/DNS Setup — dhkinnovations.com/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/DNS Zone File/i)).not.toBeInTheDocument();
    expect(await screen.findByText('Choose a plan')).toBeInTheDocument();
    expect(onDomainAdded).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(api.deleteDomain).not.toHaveBeenCalled();
  });

  describe('cancelling the wizard', () => {
    const exitWizard = () => userEvent.click(screen.getByRole('button', { name: /exit domain setup/i }));

    it('deletes a domain that was already created (in Mongo and Stalwart) and does not add it to the tenant', async () => {
      vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
        success: true,
        domain: planlessDomain('dom-abandoned-1', 'abandoned.io'),
      });
      const onDomainAdded = vi.fn();
      const onClose = vi.fn();

      render(<DomainSetupModal isOpen={true} onClose={onClose} onDomainAdded={onDomainAdded} />);
      await enterDomainAndContinue('abandoned.io');
      await screen.findByText('How do you want to set up DNS?');
      await userEvent.click(screen.getByRole('button', { name: /Manual DNS Setup/i }));
      expect(await screen.findByText('DNS Setup — abandoned.io')).toBeInTheDocument();

      await exitWizard();

      expect(api.deleteDomain).toHaveBeenCalledTimes(1);
      expect(api.deleteDomain).toHaveBeenCalledWith('dom-abandoned-1');
      expect(onDomainAdded).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('deletes the domain when cancelled right after it was created, before any DNS method was chosen', async () => {
      vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
        success: true,
        domain: planlessDomain('dom-neverwritten-1', 'neverwritten.io'),
      });
      const onClose = vi.fn();
      render(<DomainSetupModal isOpen={true} onClose={onClose} onDomainAdded={vi.fn()} />);

      await enterDomainAndContinue('neverwritten.io');
      await screen.findByText('How do you want to set up DNS?');
      await exitWizard();

      expect(api.deleteDomain).toHaveBeenCalledWith('dom-neverwritten-1');
      expect(onClose).toHaveBeenCalled();
    });

    it('still closes, and does not crash, if cleaning up the domain fails', async () => {
      vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
        success: true,
        domain: planlessDomain('dom-abandoned-2', 'flaky.io'),
      });
      vi.mocked(api.deleteDomain).mockRejectedValueOnce(new Error('network down'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onClose = vi.fn();

      render(<DomainSetupModal isOpen={true} onClose={onClose} onDomainAdded={vi.fn()} />);
      await enterDomainAndContinue('flaky.io');
      await screen.findByText('How do you want to set up DNS?');
      await userEvent.click(screen.getByRole('button', { name: /Manual DNS Setup/i }));
      await screen.findByText('DNS Setup — flaky.io');

      await exitWizard();

      expect(onClose).toHaveBeenCalled();
      await waitFor(() => expect(warn).toHaveBeenCalled());
      warn.mockRestore();
    });

    it('deletes the domain if the wizard was closed while it was still being created', async () => {
      // Creation includes Stalwart DKIM polling, so it can take several seconds — long enough to cancel.
      let finishCreation!: (value: any) => void;
      vi.mocked(api.createTenantDomain).mockReturnValueOnce(new Promise((resolve) => (finishCreation = resolve)) as any);
      const onDomainAdded = vi.fn();

      render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={onDomainAdded} />);
      await enterDomainAndContinue('inflight.io');
      await waitFor(() => expect(api.createTenantDomain).toHaveBeenCalled());

      await exitWizard(); // cancel while the request is still running
      expect(api.deleteDomain).not.toHaveBeenCalled(); // nothing to delete yet

      finishCreation({ success: true, domain: planlessDomain('dom-inflight-1', 'inflight.io') });

      await waitFor(() => expect(api.deleteDomain).toHaveBeenCalledWith('dom-inflight-1'));
      expect(onDomainAdded).not.toHaveBeenCalled();
    });
  });

  describe('going back to the domain step', () => {
    const domainField = () => screen.getByPlaceholderText(/enter your domain name|acme-tech.com/i);

    /** Goes forward to the DNS status step, where the wizard has already created the domain. */
    const reachStatusStep = async (domain: string) => {
      await enterDomainAndContinue(domain);
      await screen.findByText('How do you want to set up DNS?');
      await userEvent.click(screen.getByRole('button', { name: /Manual DNS Setup/i }));
      await screen.findByText(`DNS Setup — ${domain}`);
    };

    const backToDomainStep = async () => {
      for (let i = 0; i < 6 && !screen.queryByText(/name for your domain/i); i++) {
        await userEvent.click(screen.getByRole('button', { name: /^back$/i }));
      }
      expect(screen.getByText(/name for your domain/i)).toBeInTheDocument();
    };

    it('continues with the same domain again — your own domain is not "taken by another organization"', async () => {
      vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
        success: true,
        domain: planlessDomain('dom-back-1', 'again.io'),
      });
      // Free the first time; once created it exists — and it is yours.
      vi.mocked(api.checkDomainAvailability)
        .mockResolvedValueOnce({ available: true })
        .mockResolvedValue({ available: false, ownedByYou: true });

      render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);
      await reachStatusStep('again.io');
      await backToDomainStep();

      await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));

      expect(await screen.findByText('How do you want to set up DNS?')).toBeInTheDocument();
      expect(screen.queryByText(/already registered/i)).not.toBeInTheDocument();

      // Same domain: it is kept and reused, not deleted and not created a second time.
      await userEvent.click(screen.getByRole('button', { name: /Manual DNS Setup/i }));
      await screen.findByText('DNS Setup — again.io');
      expect(api.deleteDomain).not.toHaveBeenCalled();
      expect(api.createTenantDomain).toHaveBeenCalledTimes(1);
    });

    it('discards the old domain and sets up the new name when the domain is changed', async () => {
      vi.mocked(api.createTenantDomain)
        .mockResolvedValueOnce({ success: true, domain: planlessDomain('dom-first-1', 'first.io') })
        .mockResolvedValueOnce({ success: true, domain: planlessDomain('dom-second-1', 'second.io') });

      render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);
      await reachStatusStep('first.io');
      await backToDomainStep();

      await userEvent.clear(domainField());
      await userEvent.type(domainField(), 'second.io');
      await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));
      await waitFor(() => expect(api.createTenantDomain).toHaveBeenLastCalledWith(expect.objectContaining({ domainName: 'second.io' })));

      // first.io must not linger in Stalwart under a wizard that has moved on to second.io.
      expect(api.deleteDomain).toHaveBeenCalledWith('dom-first-1');

      expect(await screen.findByText('How do you want to set up DNS?')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /Manual DNS Setup/i }));
      expect(await screen.findByText('DNS Setup — second.io')).toBeInTheDocument();
    });

    it('says a domain you already added is yours, instead of blaming another organization', async () => {
      vi.mocked(api.checkDomainAvailability).mockResolvedValue({ available: false, ownedByYou: true });

      render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);
      await userEvent.type(domainField(), 'mine.io');
      await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));

      expect(await screen.findByText(/already added this domain/i)).toBeInTheDocument();
      expect(screen.queryByText(/another organization/i)).not.toBeInTheDocument();
      expect(screen.queryByText('How do you want to set up DNS?')).not.toBeInTheDocument();
    });
  });
});

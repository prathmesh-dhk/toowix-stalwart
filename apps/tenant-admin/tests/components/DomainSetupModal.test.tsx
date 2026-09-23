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
    detectDnsProvider: vi.fn(),
    checkDomainAvailability: vi.fn(),
    deleteDomain: vi.fn(),
  },
}));

const MOCK_PLANS = [
  { id: 'plan-starter', name: 'Starter', badge: null, description: 'Email only — up to 10 mailboxes', seatCount: 10, displayOrder: 1, isActive: true, isDefault: false, billingMode: 'metered' as const, monthlyPriceInPaise: 4900, storageQuotaGb: 5, apps: [] },
  { id: 'plan-pro', name: 'Pro', badge: 'Most Popular', description: 'Email + Toowix Suite — up to 20 mailboxes', seatCount: 20, displayOrder: 2, isActive: true, isDefault: true, billingMode: 'metered' as const, monthlyPriceInPaise: 9900, storageQuotaGb: 20, apps: ['meet', 'sign'] },
  { id: 'plan-enterprise', name: 'Enterprise', badge: null, description: 'Unlimited mailboxes — full Toowix Suite + 30 GB', seatCount: 9999, displayOrder: 3, isActive: true, isDefault: false, billingMode: 'metered' as const, monthlyPriceInPaise: 14900, storageQuotaGb: 30, apps: ['meet', 'sign'] },
];

/** Types the domain name on step 1 and advances to the plan step. */
async function enterDomainAndContinue(domain: string) {
  const input = screen.getByPlaceholderText(/enter your domain name|acme-tech\.com/i);
  await userEvent.type(input, domain);
  await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));
  await screen.findByText('Choose a plan');
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
  });

  it('blocks advancing past the domain step when the domain is already taken, without touching plan/provider steps', async () => {
    vi.mocked(api.checkDomainAvailability).mockResolvedValue({ available: false });

    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/enter your domain name|acme-tech\.com/i), 'takenbrand.com');
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    expect(api.checkDomainAvailability).toHaveBeenCalledWith('takenbrand.com');
    expect(await screen.findByText(/already registered on toowix/i)).toBeInTheDocument();
    expect(screen.queryByText('Choose a plan')).not.toBeInTheDocument();
    expect(api.createTenantDomain).not.toHaveBeenCalled();
  });

  it('renders the domain step, then the fetched plan tiers (Starter, Pro, Enterprise) on the next step', async () => {
    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);

    expect(screen.getByText(/Let's start with a name for your domain/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/enter your domain name|acme-tech\.com/i)).toBeInTheDocument();
    // Plan tiers are not shown until the domain step is completed.
    expect(screen.queryByText('Pro')).not.toBeInTheDocument();

    await enterDomainAndContinue('acme-tech.com');

    expect(await screen.findByText('Starter')).toBeInTheDocument();
    expect(screen.getAllByText('Pro').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Enterprise').length).toBeGreaterThanOrEqual(1);
  });

  it('creates an unprovisioned domain by planId, then connects GoDaddy after auto-detecting it from nameservers', async () => {
    const onClose = vi.fn();
    const onDomainAdded = vi.fn();

    vi.mocked(api.detectDnsProvider).mockResolvedValueOnce({
      provider: 'godaddy',
      nameservers: ['ns1.domaincontrol.com', 'ns2.domaincontrol.com'],
    });
    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: {
        id: 'dom-new-1',
        domainName: 'newbrand.io',
        status: 'active',
        dnsStatus: 'not_started',
        mailboxLimit: 20,
        employeeCount: 20,
        planId: 'plan-pro',
        planName: 'Pro',
        mailboxCount: 0,
        isPrimary: false,
      },
    });
    vi.mocked(api.connectDnsProviderCredential).mockResolvedValueOnce({
      success: true,
      verifiedProviderDomain: 'newbrand.io',
      connectedAt: new Date().toISOString(),
    });

    render(<DomainSetupModal isOpen={true} onClose={onClose} onDomainAdded={onDomainAdded} />);

    // Step 1: domain name
    await enterDomainAndContinue('newbrand.io');
    expect(api.detectDnsProvider).toHaveBeenCalledWith('newbrand.io');

    // Step 2: plan — Pro is the default plan (isDefault: true), so it's already selected. Just confirm step loaded then proceed.
    await screen.findByText('Starter');
    await screen.findAllByText('Pro');
    await userEvent.click(screen.getByRole('button', { name: /continue to dns setup/i }));

    // Before credentials are submitted, domain is NOT created yet (avoids orphan domains on cancel/interrupt)
    expect(api.createTenantDomain).not.toHaveBeenCalled();

    // Step 3 (method picker) is skipped — GoDaddy was auto-detected from
    // nameservers, so the wizard lands directly on its credential form.
    expect(screen.queryByText('How do you want to set up DNS?')).not.toBeInTheDocument();
    expect(await screen.findByText(/^Connect GoDaddy$/)).toBeInTheDocument();
    expect(screen.getByText(/we detected/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/GoDaddy API Key/i), 'test-key');
    await userEvent.type(screen.getByLabelText(/GoDaddy API Secret/i), 'test-secret');
    await userEvent.click(screen.getByRole('button', { name: /verify . connect/i }));

    expect(api.createTenantDomain).toHaveBeenCalledWith({
      domainName: 'newbrand.io',
      planId: 'plan-pro',
    });

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

    const completeBtn = screen.getByRole('button', { name: /^done$/i });
    await userEvent.click(completeBtn);

    expect(onDomainAdded).toHaveBeenCalledWith(
      expect.objectContaining({
        domainName: 'newbrand.io',
        mailboxLimit: 20,
        dnsStatus: 'not_started',
      })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('switches to Hostinger and connects with a single API token (method picker used to override an undetected provider)', async () => {
    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: {
        id: 'dom-new-2',
        domainName: 'otherbrand.io',
        status: 'active',
        dnsStatus: 'not_started',
        mailboxLimit: 20,
        employeeCount: 20,
        planId: 'plan-pro',
        planName: 'Pro',
        mailboxCount: 0,
        isPrimary: false,
      },
    });
    vi.mocked(api.connectDnsProviderCredential).mockResolvedValueOnce({
      success: true,
      verifiedProviderDomain: 'otherbrand.io',
      connectedAt: new Date().toISOString(),
    });

    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);

    await enterDomainAndContinue('otherbrand.io');
    await screen.findAllByText('Pro'); // default-selected (Pro is isDefault: true); findAll because WizardStepGraphic also shows it
    await userEvent.click(screen.getByRole('button', { name: /continue to dns setup/i }));

    await screen.findByText(/couldn't detect/i);
    await userEvent.click(screen.getByText('Connect a provider instead'));
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
      domain: {
        id: 'dom-new-3',
        domainName: 'thirdbrand.dev',
        status: 'active',
        dnsStatus: 'not_started',
        mailboxLimit: 20,
        employeeCount: 20,
        planId: 'plan-pro',
        planName: 'Pro',
        mailboxCount: 0,
        isPrimary: false,
      },
    });
    vi.mocked(api.connectDnsProviderCredential).mockResolvedValueOnce({
      success: true,
      verifiedProviderDomain: 'thirdbrand.dev',
      connectedAt: new Date().toISOString(),
    });

    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);

    await enterDomainAndContinue('thirdbrand.dev');
    await screen.findAllByText('Pro');
    await userEvent.click(screen.getByRole('button', { name: /continue to dns setup/i }));

    await screen.findByText(/couldn't detect/i);
    await userEvent.click(screen.getByText('Connect a provider instead'));
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
      domain: {
        id: 'dom-new-4',
        domainName: 'manualbrand.io',
        status: 'active',
        dnsStatus: 'not_started',
        mailboxLimit: 20,
        employeeCount: 20,
        planId: 'plan-pro',
        planName: 'Pro',
        mailboxCount: 0,
        isPrimary: false,
      },
    });
    vi.mocked(api.getDomainDnsStatus).mockResolvedValue({
      dnsStatus: 'activating',
      dnsRecords: [{ type: 'MX', name: '@', value: 'mail.toowix.com', priority: 10, ttl: 3600, purpose: 'MX' }],
      dnsConflicts: [],
      dnsZoneFile: 'manualbrand.io. IN MX 10 mail.toowix.com.',
    });

    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);

    await enterDomainAndContinue('manualbrand.io');
    await screen.findAllByText('Pro');
    await userEvent.click(screen.getByRole('button', { name: /continue to dns setup/i }));

    // Method picker is skipped — nothing was auto-detected (default mock),
    // so the wizard lands directly on the DNS records / status step.
    expect(screen.queryByText('How do you want to set up DNS?')).not.toBeInTheDocument();
    expect(await screen.findByText(/couldn't detect/i)).toBeInTheDocument();
    expect(api.connectDnsProviderCredential).not.toHaveBeenCalled();

    expect(await screen.findByText('DNS Setup — manualbrand.io')).toBeInTheDocument();
    expect(await screen.findByText('DNS Zone File')).toBeInTheDocument();
    expect(screen.getByText(/manualbrand\.io\. IN MX 10 mail\.toowix\.com\./)).toBeInTheDocument();
  });

  it('refreshes DNS status for the created domain when the refresh button is clicked (not with the click event)', async () => {
    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: {
        id: '64b7f0f0f0f0f0f0f0f0f0a1',
        domainName: 'refreshme.io',
        status: 'active',
        dnsStatus: 'not_started',
        mailboxLimit: 20,
        employeeCount: 20,
        planId: 'plan-pro',
        planName: 'Pro',
        mailboxCount: 0,
        isPrimary: false,
      },
    });

    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);
    await enterDomainAndContinue('refreshme.io');
    await screen.findAllByText('Pro');
    await userEvent.click(screen.getByRole('button', { name: /continue to dns setup/i }));
    await screen.findByText('DNS Setup — refreshme.io');

    vi.mocked(api.getDomainDnsStatus).mockClear();
    await userEvent.click(screen.getByRole('button', { name: /refresh status/i }));

    // The id must be the domain's id — a click event here becomes "/domains/[object PointerEvent]/…",
    // which the server rejects as "Domain ID is missing or malformed".
    await waitFor(() => expect(api.getDomainDnsStatus).toHaveBeenCalledWith('64b7f0f0f0f0f0f0f0f0f0a1'));
    for (const [arg] of vi.mocked(api.getDomainDnsStatus).mock.calls) expect(typeof arg).toBe('string');
    expect(screen.queryByText(/missing or malformed/i)).not.toBeInTheDocument();
  });

  it('offers a skippable "Add Payment Method" card on the status step that never blocks finishing', async () => {
    const onDomainAdded = vi.fn();
    const onClose = vi.fn();

    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: {
        id: 'dom-new-5',
        domainName: 'payable.io',
        status: 'active',
        dnsStatus: 'not_started',
        mailboxLimit: 20,
        employeeCount: 20,
        planId: 'plan-pro',
        planName: 'Pro',
        mailboxCount: 0,
        isPrimary: false,
      },
    });
    vi.mocked(api.startDomainCheckout).mockResolvedValue({ url: 'https://checkout.stripe.com/pay/test' });

    render(<DomainSetupModal isOpen={true} onClose={onClose} onDomainAdded={onDomainAdded} />);

    await enterDomainAndContinue('payable.io');
    await screen.findAllByText('Pro');
    await userEvent.click(screen.getByRole('button', { name: /continue to dns setup/i }));

    expect(await screen.findByText('DNS Setup — payable.io')).toBeInTheDocument();
    expect(screen.getByText('Add a payment method')).toBeInTheDocument();

    // Skipping does not block finishing the wizard.
    await userEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(screen.queryByText('Add a payment method')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^done$/i }));
    expect(onDomainAdded).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(api.startDomainCheckout).not.toHaveBeenCalled();
    expect(api.deleteDomain).not.toHaveBeenCalled();
  });

  it('lets "Back" from an auto-skipped setup step reach the method picker as an override', async () => {
    vi.mocked(api.detectDnsProvider).mockResolvedValueOnce({
      provider: 'cloudflare',
      nameservers: ['aida.ns.cloudflare.com', 'walt.ns.cloudflare.com'],
    });

    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);

    await enterDomainAndContinue('backnav.io');
    await screen.findAllByText('Pro');
    await userEvent.click(screen.getByRole('button', { name: /continue to dns setup/i }));

    // Auto-skipped straight to Cloudflare's form.
    expect(await screen.findByText(/^Connect Cloudflare$/)).toBeInTheDocument();

    // "Back" reaches the method picker (not the plan step), so a wrong
    // auto-detection is always one click away from being overridden.
    await userEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(await screen.findByText('How do you want to set up DNS?')).toBeInTheDocument();
  });

  it('finishes setup directly and returns to dashboard when using a saved provider key', async () => {
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
      domain: {
        id: 'dom-saved-1',
        domainName: 'dhkinnovations.com',
        status: 'active',
        dnsStatus: 'not_started',
        mailboxLimit: 20,
        employeeCount: 20,
        planId: 'plan-pro',
        planName: 'Pro',
        mailboxCount: 0,
        isPrimary: false,
      },
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
    await screen.findAllByText('Pro');
    await userEvent.click(screen.getByRole('button', { name: /continue to dns setup/i }));

    // Land on Connect GoDaddy with saved key button
    expect(await screen.findByText(/^Connect GoDaddy$/)).toBeInTheDocument();
    const useSavedBtn = await screen.findByText(/Use saved GoDaddy key/i);
    await userEvent.click(useSavedBtn);

    expect(api.useSavedDnsProviderCredential).toHaveBeenCalledWith('dom-saved-1', 'godaddy');
    // Must NOT land on status/zone file step
    expect(screen.queryByText(/DNS Setup — dhkinnovations.com/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/DNS Zone File/i)).not.toBeInTheDocument();

    // Must immediately finish and close
    expect(onDomainAdded).toHaveBeenCalledWith(
      expect.objectContaining({
        domainName: 'dhkinnovations.com',
      })
    );
    expect(onClose).toHaveBeenCalled();
    expect(api.deleteDomain).not.toHaveBeenCalled();
  });

  describe('cancelling the wizard', () => {
    const exitWizard = () => userEvent.click(screen.getByRole('button', { name: /exit domain setup/i }));

    it('deletes a domain that was already created (in Mongo and Stalwart) and does not add it to the tenant', async () => {
      vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: {
        id: 'dom-abandoned-1',
        domainName: 'abandoned.io',
        status: 'active',
        dnsStatus: 'not_started',
        mailboxLimit: 20,
        employeeCount: 20,
        planId: 'plan-pro',
        planName: 'Pro',
        mailboxCount: 0,
        isPrimary: false,
      },
    });
      const onDomainAdded = vi.fn();
      const onClose = vi.fn();

      render(<DomainSetupModal isOpen={true} onClose={onClose} onDomainAdded={onDomainAdded} />);
      await enterDomainAndContinue('abandoned.io');
      await screen.findAllByText('Pro');
      await userEvent.click(screen.getByRole('button', { name: /continue to dns setup/i }));
      expect(await screen.findByText('DNS Setup — abandoned.io')).toBeInTheDocument();

      await exitWizard();

      expect(api.deleteDomain).toHaveBeenCalledTimes(1);
      expect(api.deleteDomain).toHaveBeenCalledWith('dom-abandoned-1');
      expect(onDomainAdded).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('deletes nothing when it is cancelled before any domain was created', async () => {
      const onClose = vi.fn();
      render(<DomainSetupModal isOpen={true} onClose={onClose} onDomainAdded={vi.fn()} />);

      await enterDomainAndContinue('neverwritten.io');
      await screen.findAllByText('Pro');
      await exitWizard();

      expect(api.createTenantDomain).not.toHaveBeenCalled();
      expect(api.deleteDomain).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('still closes, and does not crash, if cleaning up the domain fails', async () => {
      vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: {
        id: 'dom-abandoned-2',
        domainName: 'flaky.io',
        status: 'active',
        dnsStatus: 'not_started',
        mailboxLimit: 20,
        employeeCount: 20,
        planId: 'plan-pro',
        planName: 'Pro',
        mailboxCount: 0,
        isPrimary: false,
      },
    });
      vi.mocked(api.deleteDomain).mockRejectedValueOnce(new Error('network down'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onClose = vi.fn();

      render(<DomainSetupModal isOpen={true} onClose={onClose} onDomainAdded={vi.fn()} />);
      await enterDomainAndContinue('flaky.io');
      await screen.findAllByText('Pro');
      await userEvent.click(screen.getByRole('button', { name: /continue to dns setup/i }));
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
      await screen.findAllByText('Pro');
      await userEvent.click(screen.getByRole('button', { name: /continue to dns setup/i }));
      await waitFor(() => expect(api.createTenantDomain).toHaveBeenCalled());

      await exitWizard(); // cancel while the request is still running
      expect(api.deleteDomain).not.toHaveBeenCalled(); // nothing to delete yet

      finishCreation({
      success: true,
      domain: {
        id: 'dom-inflight-1',
        domainName: 'inflight.io',
        status: 'active',
        dnsStatus: 'not_started',
        mailboxLimit: 20,
        employeeCount: 20,
        planId: 'plan-pro',
        planName: 'Pro',
        mailboxCount: 0,
        isPrimary: false,
      },
    });

      await waitFor(() => expect(api.deleteDomain).toHaveBeenCalledWith('dom-inflight-1'));
      expect(onDomainAdded).not.toHaveBeenCalled();
    });
  });

  describe('going back to the domain step', () => {
    const domainField = () => screen.getByPlaceholderText(/enter your domain name|acme-tech.com/i);

    /** Goes forward to the DNS status step, where the wizard has already created the domain. */
    const reachStatusStep = async (domain: string) => {
      await enterDomainAndContinue(domain);
      // Plan step is confirmed by enterDomainAndContinue (finds 'Choose a plan').
      // Use findAllByText since 'Pro' appears in both the plan card and the WizardStepGraphic sidebar.
      await screen.findAllByText('Pro');
      await userEvent.click(screen.getByRole('button', { name: /continue to dns setup/i }));
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
      domain: {
        id: 'dom-back-1',
        domainName: 'again.io',
        status: 'active',
        dnsStatus: 'not_started',
        mailboxLimit: 20,
        employeeCount: 20,
        planId: 'plan-pro',
        planName: 'Pro',
        mailboxCount: 0,
        isPrimary: false,
      },
    });
      // Free the first time; once created it exists — and it is yours.
      vi.mocked(api.checkDomainAvailability)
        .mockResolvedValueOnce({ available: true })
        .mockResolvedValue({ available: false, ownedByYou: true });

      render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);
      await reachStatusStep('again.io');
      await backToDomainStep();

      await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));

      expect(await screen.findByText('Choose a plan')).toBeInTheDocument();
      expect(screen.queryByText(/already registered/i)).not.toBeInTheDocument();

      // Same domain: it is kept and reused, not deleted and not created a second time.
      await userEvent.click(screen.getByRole('button', { name: /continue to dns setup/i }));
      await screen.findByText('DNS Setup — again.io');
      expect(api.deleteDomain).not.toHaveBeenCalled();
      expect(api.createTenantDomain).toHaveBeenCalledTimes(1);
    });

    it('discards the old domain and sets up the new name when the domain is changed', async () => {
      vi.mocked(api.createTenantDomain)
        .mockResolvedValueOnce({
      success: true,
      domain: {
        id: 'dom-first-1',
        domainName: 'first.io',
        status: 'active',
        dnsStatus: 'not_started',
        mailboxLimit: 20,
        employeeCount: 20,
        planId: 'plan-pro',
        planName: 'Pro',
        mailboxCount: 0,
        isPrimary: false,
      },
    })
        .mockResolvedValueOnce({
      success: true,
      domain: {
        id: 'dom-second-1',
        domainName: 'second.io',
        status: 'active',
        dnsStatus: 'not_started',
        mailboxLimit: 20,
        employeeCount: 20,
        planId: 'plan-pro',
        planName: 'Pro',
        mailboxCount: 0,
        isPrimary: false,
      },
    });

      render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);
      await reachStatusStep('first.io');
      await backToDomainStep();

      await userEvent.clear(domainField());
      await userEvent.type(domainField(), 'second.io');
      await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));
      await screen.findByText('Choose a plan');

      // first.io must not linger in Stalwart under a wizard that has moved on to second.io.
      expect(api.deleteDomain).toHaveBeenCalledWith('dom-first-1');

      await userEvent.click(screen.getByRole('button', { name: /continue to dns setup/i }));
      expect(await screen.findByText('DNS Setup — second.io')).toBeInTheDocument();
      expect(api.createTenantDomain).toHaveBeenLastCalledWith(expect.objectContaining({ domainName: 'second.io' }));
    });

    it('says a domain you already added is yours, instead of blaming another organization', async () => {
      vi.mocked(api.checkDomainAvailability).mockResolvedValue({ available: false, ownedByYou: true });

      render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);
      await userEvent.type(domainField(), 'mine.io');
      await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));

      expect(await screen.findByText(/already added this domain/i)).toBeInTheDocument();
      expect(screen.queryByText(/another organization/i)).not.toBeInTheDocument();
      expect(screen.queryByText('Choose a plan')).not.toBeInTheDocument();
    });
  });
});

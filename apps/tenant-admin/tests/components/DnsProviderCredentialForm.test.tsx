import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DnsProviderCredentialForm } from '../../src/components/DnsProviderCredentialForm';
import { api } from '../../src/api';

vi.mock('../../src/api', () => ({
  api: {
    connectDnsProviderCredential: vi.fn(),
    useSavedDnsProviderCredential: vi.fn(),
    listTenantDnsCredentials: vi.fn(),
    saveTenantDnsCredential: vi.fn(),
  },
}));

describe('DnsProviderCredentialForm Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers a "Use saved key" choice when a saved credential exists, and re-verifies it against the domain on use', async () => {
    vi.mocked(api.listTenantDnsCredentials).mockResolvedValue({
      credentials: [
        { provider: 'godaddy', verified: true, verifiedProviderDomain: 'other.com', connectedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null },
      ],
    });
    vi.mocked(api.useSavedDnsProviderCredential).mockResolvedValue({
      success: true,
      verifiedProviderDomain: 'acme.com',
      connectedAt: new Date().toISOString(),
      recordsSynced: 5,
      syncPending: true,
    });

    const onSuccess = vi.fn();
    render(
      <DnsProviderCredentialForm domainId="dom-1" domainName="acme.com" provider="godaddy" onSuccess={onSuccess} />
    );

    expect(await screen.findByText(/you have a saved godaddy key/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /use saved godaddy key/i }));

    expect(api.useSavedDnsProviderCredential).toHaveBeenCalledWith('dom-1', 'godaddy');
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ verifiedProviderDomain: 'acme.com', syncPending: true })
    );
    expect(await screen.findByText(/publishing your dns records/i)).toBeInTheDocument();
  });

  it('falls back to manual entry when "Enter different credentials" is chosen', async () => {
    vi.mocked(api.listTenantDnsCredentials).mockResolvedValue({
      credentials: [
        { provider: 'godaddy', verified: true, verifiedProviderDomain: 'other.com', connectedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null },
      ],
    });

    render(<DnsProviderCredentialForm domainId="dom-1" domainName="acme.com" provider="godaddy" onSuccess={vi.fn()} />);

    await screen.findByText(/you have a saved godaddy key/i);
    await userEvent.click(screen.getByRole('button', { name: /enter different credentials/i }));

    expect(await screen.findByLabelText(/GoDaddy API Key/i)).toBeInTheDocument();
    expect(screen.getByText(/save these credentials for future domains/i)).toBeInTheDocument();
  });

  it('goes straight to manual entry with no saved-key choice when nothing is saved for the provider', async () => {
    vi.mocked(api.listTenantDnsCredentials).mockResolvedValue({ credentials: [] });

    render(<DnsProviderCredentialForm domainId="dom-1" domainName="acme.com" provider="cloudflare" onSuccess={vi.fn()} />);

    expect(await screen.findByLabelText(/Cloudflare API Token/i)).toBeInTheDocument();
    expect(screen.queryByText(/you have a saved/i)).not.toBeInTheDocument();
  });

  it('saves directly to the vault (no domainId) without the save-for-future checkbox, and shows a vault-specific success message', async () => {
    vi.mocked(api.listTenantDnsCredentials).mockResolvedValue({ credentials: [] });
    vi.mocked(api.saveTenantDnsCredential).mockResolvedValue({
      success: true,
      credential: {
        provider: 'cloudflare',
        verified: true,
        verifiedProviderDomain: 'acme.com',
        connectedAt: new Date().toISOString(),
        lastUsedAt: null,
      },
    });

    const onSuccess = vi.fn();
    render(<DnsProviderCredentialForm provider="cloudflare" onSuccess={onSuccess} />);

    await screen.findByLabelText(/Cloudflare API Token/i);
    expect(screen.queryByText(/save these credentials for future domains/i)).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Cloudflare API Token/i), 'a'.repeat(40));
    await userEvent.click(screen.getByRole('button', { name: /save api key/i }));

    expect(api.saveTenantDnsCredential).toHaveBeenCalledWith({ provider: 'cloudflare', token: 'a'.repeat(40) });
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ savedToVault: true }));
    expect(await screen.findByText(/we verified it against/i)).toBeInTheDocument();
  });
});

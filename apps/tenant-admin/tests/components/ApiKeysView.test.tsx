import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiKeysView } from '../../src/components/ApiKeysView';
import { api } from '../../src/api';

vi.mock('../../src/api', () => ({
  api: {
    listTenantDnsCredentials: vi.fn(),
    deleteTenantDnsCredential: vi.fn(),
    saveTenantDnsCredential: vi.fn(),
  },
}));

describe('ApiKeysView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the empty state when nothing is saved yet', async () => {
    vi.mocked(api.listTenantDnsCredentials).mockResolvedValue({ credentials: [] });
    render(<ApiKeysView />);

    expect(await screen.findByText(/no saved api keys yet/i)).toBeInTheDocument();
  });

  it('lists saved credentials with their verified state and connected date', async () => {
    vi.mocked(api.listTenantDnsCredentials).mockResolvedValue({
      credentials: [
        { provider: 'godaddy', verified: true, verifiedProviderDomain: 'acme.com', connectedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null },
        { provider: 'hostinger', verified: false, verifiedProviderDomain: null, connectedAt: '2026-02-01T00:00:00.000Z', lastUsedAt: null },
      ],
    });
    render(<ApiKeysView />);

    expect(await screen.findByText('GoDaddy')).toBeInTheDocument();
    expect(screen.getByText('Hostinger')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('Not yet verified')).toBeInTheDocument();
  });

  it('opens the add form and saves a new key', async () => {
    vi.mocked(api.listTenantDnsCredentials)
      // Initial ApiKeysView load, then DnsProviderCredentialForm's own
      // fetch (for the "use saved key" choice) when the add form mounts.
      .mockResolvedValueOnce({ credentials: [] })
      .mockResolvedValueOnce({ credentials: [] })
      .mockResolvedValue({
        credentials: [{ provider: 'cloudflare', verified: true, verifiedProviderDomain: 'acme.com', connectedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null }],
      });
    vi.mocked(api.saveTenantDnsCredential).mockResolvedValue({
      success: true,
      credential: { provider: 'cloudflare', verified: true, verifiedProviderDomain: 'acme.com', connectedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null },
    });

    render(<ApiKeysView />);
    await screen.findByText(/no saved api keys yet/i);

    await userEvent.click(screen.getByRole('button', { name: /^add api key$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^cloudflare$/i }));
    await userEvent.type(screen.getByLabelText(/Cloudflare API Token/i), 'a'.repeat(40));
    await userEvent.click(screen.getByRole('button', { name: /save api key/i }));

    expect(api.saveTenantDnsCredential).toHaveBeenCalledWith({ provider: 'cloudflare', token: 'a'.repeat(40) });
    await waitFor(() => expect(screen.getByText('Cloudflare')).toBeInTheDocument());
  });

  it('removes a saved key when Remove is clicked', async () => {
    vi.mocked(api.listTenantDnsCredentials)
      .mockResolvedValueOnce({
        credentials: [{ provider: 'godaddy', verified: true, verifiedProviderDomain: 'acme.com', connectedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null }],
      })
      .mockResolvedValueOnce({ credentials: [] });
    vi.mocked(api.deleteTenantDnsCredential).mockResolvedValue({ success: true });

    render(<ApiKeysView />);
    await screen.findByText('GoDaddy');

    await userEvent.click(screen.getByRole('button', { name: /^remove$/i }));

    expect(api.deleteTenantDnsCredential).toHaveBeenCalledWith('godaddy');
    expect(await screen.findByText(/no saved api keys yet/i)).toBeInTheDocument();
  });
});

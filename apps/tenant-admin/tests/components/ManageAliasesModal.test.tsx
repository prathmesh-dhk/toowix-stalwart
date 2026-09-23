import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManageAliasesModal } from '../../src/components/modals/ManageAliasesModal';
import { api } from '../../src/api';
import { MailboxItem } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: {
    listMailboxAliases: vi.fn(),
    addMailboxAlias: vi.fn(),
    deleteMailboxAlias: vi.fn(),
  },
}));

const mockMailbox: MailboxItem = {
  id: 'mb-1',
  tenantId: 'tenant-1',
  domainId: 'dom-1',
  localPart: 'alice',
  address: 'alice@acme.com',
  stalwartAccountId: 'acc-1',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('ManageAliasesModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders mailbox address and loads existing aliases', async () => {
    vi.mocked(api.listMailboxAliases).mockResolvedValueOnce({
      aliases: [
        {
          id: 'alias-1',
          localPart: 'support',
          domainId: 'dom-1',
          domainName: 'acme.com',
          address: 'support@acme.com',
          description: null,
          createdAt: '2026-01-02T00:00:00Z',
        },
      ],
    });

    render(
      <ManageAliasesModal
        isOpen={true}
        onClose={vi.fn()}
        mailbox={mockMailbox}
      />
    );

    expect(screen.getByText('Email Aliases')).toBeInTheDocument();
    expect(screen.getByText('alice@acme.com')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('support@acme.com')).toBeInTheDocument();
    });

    expect(api.listMailboxAliases).toHaveBeenCalledWith('mb-1');
  });

  it('adds a new alias successfully', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listMailboxAliases).mockResolvedValueOnce({ aliases: [] });
    vi.mocked(api.addMailboxAlias).mockResolvedValueOnce({
      alias: {
        id: 'alias-new',
        localPart: 'sales',
        domainId: 'dom-1',
        domainName: 'acme.com',
        address: 'sales@acme.com',
        description: null,
        createdAt: '2026-01-03T00:00:00Z',
      },
    });

    const onAliasesUpdated = vi.fn();

    render(
      <ManageAliasesModal
        isOpen={true}
        onClose={vi.fn()}
        mailbox={mockMailbox}
        onAliasesUpdated={onAliasesUpdated}
      />
    );

    // Initial empty state
    await waitFor(() => {
      expect(screen.getByText(/No aliases added yet/i)).toBeInTheDocument();
    });

    // Fill form
    const localPartInput = screen.getByPlaceholderText('alias');
    await user.type(localPartInput, 'sales');

    const addBtn = screen.getByRole('button', { name: /Add/i });
    await user.click(addBtn);

    expect(api.addMailboxAlias).toHaveBeenCalledWith('mb-1', {
      localPart: 'sales',
    });

    await waitFor(() => {
      expect(screen.getByText('sales@acme.com')).toBeInTheDocument();
    });

    expect(onAliasesUpdated).toHaveBeenCalledTimes(1);
  });

  it('displays error message when alias addition fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listMailboxAliases).mockResolvedValueOnce({ aliases: [] });
    vi.mocked(api.addMailboxAlias).mockRejectedValueOnce(
      new Error("Address 'support@acme.com' is already in use by a primary mailbox")
    );

    render(
      <ManageAliasesModal
        isOpen={true}
        onClose={vi.fn()}
        mailbox={mockMailbox}
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText('alias')).toBeInTheDocument();
    });

    const localPartInput = screen.getByPlaceholderText('alias');
    await user.type(localPartInput, 'support');

    const addBtn = screen.getByRole('button', { name: /Add/i });
    await user.click(addBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Address 'support@acme.com' is already in use by a primary mailbox/i)
      ).toBeInTheDocument();
    });
  });

  it('deletes an alias when delete button is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listMailboxAliases).mockResolvedValueOnce({
      aliases: [
        {
          id: 'alias-del',
          localPart: 'info',
          domainId: 'dom-1',
          domainName: 'acme.com',
          address: 'info@acme.com',
          description: null,
          createdAt: '2026-01-02T00:00:00Z',
        },
      ],
    });
    vi.mocked(api.deleteMailboxAlias).mockResolvedValueOnce({ message: 'Alias successfully deleted' });

    const onAliasesUpdated = vi.fn();

    render(
      <ManageAliasesModal
        isOpen={true}
        onClose={vi.fn()}
        mailbox={mockMailbox}
        onAliasesUpdated={onAliasesUpdated}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('info@acme.com')).toBeInTheDocument();
    });

    const deleteBtn = screen.getByRole('button', { name: /Delete alias info@acme.com/i });
    await user.click(deleteBtn);

    expect(api.deleteMailboxAlias).toHaveBeenCalledWith('mb-1', 'alias-del');

    await waitFor(() => {
      expect(screen.queryByText('info@acme.com')).not.toBeInTheDocument();
    });

    expect(onAliasesUpdated).toHaveBeenCalledTimes(1);
  });
});

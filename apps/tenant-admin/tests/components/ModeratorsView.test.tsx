import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModeratorsView } from '../../src/components/ModeratorsView';
import { api } from '../../src/api';
import { DomainItem, ModeratorItem } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: {
    listModerators: vi.fn(),
    createModerator: vi.fn(),
    updateModerator: vi.fn(),
    deleteModerator: vi.fn(),
  },
}));

const mockDomains: DomainItem[] = [
  { id: 'dom-1', domainName: 'acme.test', status: 'active', mailboxLimit: 10, employeeCount: 10, mailboxCount: 2, isPrimary: true },
  { id: 'dom-2', domainName: 'other.test', status: 'active', mailboxLimit: 10, employeeCount: 10, mailboxCount: 0, isPrimary: false },
];

const mockModerator: ModeratorItem = {
  id: 'mod-1',
  email: 'mod@acme.test',
  role: 'TENANT_MODERATOR',
  status: 'active',
  twoFactorEnabled: false,
  scopedDomainIds: ['dom-1'],
  createdAt: '2026-09-01T00:00:00.000Z',
};

describe('ModeratorsView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listModerators).mockResolvedValue({ moderators: [mockModerator] });
  });

  it('lists moderators with their scoped domain names', async () => {
    render(<ModeratorsView domains={mockDomains} />);

    expect(await screen.findByText('mod@acme.test')).toBeInTheDocument();
    expect(screen.getByText('acme.test')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('creates a new moderator with a generated password and selected domain scope', async () => {
    vi.mocked(api.createModerator).mockResolvedValue({
      moderator: { ...mockModerator, id: 'mod-2', email: 'new@acme.test', scopedDomainIds: ['dom-2'] },
    });

    render(<ModeratorsView domains={mockDomains} />);
    await screen.findByText('mod@acme.test');

    await userEvent.click(screen.getAllByRole('button', { name: /add moderator/i })[0]);
    await userEvent.type(screen.getByPlaceholderText(/moderator@yourcompany.com/i), 'new@acme.test');
    await userEvent.click(screen.getByLabelText('other.test'));
    const submitButtons = screen.getAllByRole('button', { name: /add moderator/i });
    await userEvent.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() => {
      expect(api.createModerator).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@acme.test', scopedDomainIds: ['dom-2'] })
      );
    });
  });

  it('updates scope through the edit-scope modal', async () => {
    vi.mocked(api.updateModerator).mockResolvedValue({ moderator: { ...mockModerator, scopedDomainIds: ['dom-1', 'dom-2'] } });

    render(<ModeratorsView domains={mockDomains} />);
    await screen.findByText('mod@acme.test');

    await userEvent.click(screen.getByRole('button', { name: /edit scope/i }));
    await userEvent.click(screen.getByLabelText('other.test'));
    await userEvent.click(screen.getByRole('button', { name: /save scope/i }));

    await waitFor(() => {
      expect(api.updateModerator).toHaveBeenCalledWith('mod-1', { scopedDomainIds: ['dom-1', 'dom-2'] });
    });
  });

  it('disables and re-enables a moderator', async () => {
    vi.mocked(api.updateModerator).mockResolvedValue({ moderator: { ...mockModerator, status: 'disabled' } });

    render(<ModeratorsView domains={mockDomains} />);
    await screen.findByText('mod@acme.test');

    await userEvent.click(screen.getByRole('button', { name: /disable/i }));

    await waitFor(() => {
      expect(api.updateModerator).toHaveBeenCalledWith('mod-1', { status: 'disabled' });
    });
  });

  it('removes a moderator after confirmation', async () => {
    vi.mocked(api.deleteModerator).mockResolvedValue({ message: 'ok' });

    render(<ModeratorsView domains={mockDomains} />);
    await screen.findByText('mod@acme.test');

    await userEvent.click(screen.getByRole('button', { name: /remove/i }));
    const removeButtons = screen.getAllByRole('button', { name: /^remove$/i });
    await userEvent.click(removeButtons[removeButtons.length - 1]);

    await waitFor(() => {
      expect(api.deleteModerator).toHaveBeenCalledWith('mod-1');
    });
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DomainSwitcher } from '../../src/components/DomainSwitcher';
import { DomainItem } from '../../src/types';

const mockDomains: DomainItem[] = [
  {
    id: 'dom-1',
    domainName: 'primarybrand.com',
    status: 'active',
    mailboxLimit: 10,
    employeeCount: 10,
    mailboxCount: 3,
    isPrimary: true,
  },
  {
    id: 'dom-2',
    domainName: 'secondarybrand.com',
    status: 'active',
    mailboxLimit: 25,
    employeeCount: 25,
    mailboxCount: 0,
    isPrimary: false,
  },
];

describe('DomainSwitcher Component', () => {
  it('renders "Add Domain" when 0 domains exist', async () => {
    const onSelectDomain = vi.fn();
    const onOpenAddDomain = vi.fn();

    render(
      <DomainSwitcher
        domains={[]}
        activeDomain={null}
        onSelectDomain={onSelectDomain}
        onOpenAddDomain={onOpenAddDomain}
      />
    );

    const setupBtn = screen.getByText('Add Domain');
    expect(setupBtn).toBeInTheDocument();

    await userEvent.click(setupBtn);
    expect(onOpenAddDomain).toHaveBeenCalledTimes(1);
  });

  it('shows a plain empty state (no Add Domain affordance) when 0 domains exist and onOpenAddDomain is omitted — a Moderator with no scoped domains', () => {
    render(<DomainSwitcher domains={[]} activeDomain={null} onSelectDomain={vi.fn()} />);

    expect(screen.getByText('No domains assigned yet.')).toBeInTheDocument();
    expect(screen.queryByText('Add Domain')).not.toBeInTheDocument();
  });

  it('renders active domain button showing only domain name', () => {
    const onSelectDomain = vi.fn();

    render(
      <DomainSwitcher
        domains={mockDomains}
        activeDomain={mockDomains[0]}
        onSelectDomain={onSelectDomain}
      />
    );

    expect(screen.getByText('primarybrand.com')).toBeInTheDocument();
    // Verify no seat count or status pills are rendered in the trigger
    expect(screen.queryByText(/seats/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/active/i)).not.toBeInTheDocument();
  });

  it('opens dropdown menu on click and switches domain on selection', async () => {
    const onSelectDomain = vi.fn();

    render(
      <DomainSwitcher
        domains={mockDomains}
        activeDomain={mockDomains[0]}
        onSelectDomain={onSelectDomain}
      />
    );

    // Open dropdown
    const triggerBtn = screen.getByRole('button', { name: /primarybrand\.com/i });
    await userEvent.click(triggerBtn);

    // Verify only domain names in dropdown
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('secondarybrand.com')).toBeInTheDocument();

    // Select second domain
    await userEvent.click(screen.getByText('secondarybrand.com'));
    expect(onSelectDomain).toHaveBeenCalledWith(mockDomains[1]);
  });

  it('renders "+ Add Domain" button in dropdown when onOpenAddDomain is provided and triggers callback', async () => {
    const onSelectDomain = vi.fn();
    const onOpenAddDomain = vi.fn();

    render(
      <DomainSwitcher
        domains={mockDomains}
        activeDomain={mockDomains[0]}
        onSelectDomain={onSelectDomain}
        onOpenAddDomain={onOpenAddDomain}
      />
    );

    // Open dropdown
    const triggerBtn = screen.getByRole('button', { name: /primarybrand\.com/i });
    await userEvent.click(triggerBtn);

    // Verify Add Domain button appears in listbox
    const addDomainBtn = screen.getByRole('button', { name: /add domain/i });
    expect(addDomainBtn).toBeInTheDocument();

    await userEvent.click(addDomainBtn);
    expect(onOpenAddDomain).toHaveBeenCalledTimes(1);
  });
});

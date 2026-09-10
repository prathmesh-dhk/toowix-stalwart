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
  it('renders "+ Setup Domain" CTA when 0 domains exist', async () => {
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

    const setupBtn = screen.getByText('Add Your Domain');
    expect(setupBtn).toBeInTheDocument();

    await userEvent.click(setupBtn);
    expect(onOpenAddDomain).toHaveBeenCalledTimes(1);
  });

  it('renders active domain pill with domain name, initial, and quota seats', () => {
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

    expect(screen.getByText('primarybrand.com')).toBeInTheDocument();
    expect(screen.getByText(/3\/10 seats/i)).toBeInTheDocument();
  });

  it('opens dropdown menu on click, switches domain on selection, and opens add domain modal', async () => {
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

    // Verify domains in dropdown
    expect(screen.getByText('Your Domains (2)')).toBeInTheDocument();
    expect(screen.getByText('secondarybrand.com')).toBeInTheDocument();

    // Select second domain
    await userEvent.click(screen.getByText('secondarybrand.com'));
    expect(onSelectDomain).toHaveBeenCalledWith(mockDomains[1]);

    // Open again and click "+ Add New Domain"
    await userEvent.click(triggerBtn);
    const addBtn = screen.getByText('+ Add New Domain');
    await userEvent.click(addBtn);
    expect(onOpenAddDomain).toHaveBeenCalledTimes(1);
  });
});

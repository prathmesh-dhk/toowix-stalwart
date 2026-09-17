import { DnsActivationStatus } from '../types';

export function dnsStatusBadgeProps(dnsStatus?: DnsActivationStatus | string): { status: string; label: string } {
  switch (dnsStatus) {
    case 'active':
      return { status: 'active', label: 'Active' };
    case 'activating':
      return { status: 'pending', label: 'Activating' };
    case 'conflict':
      return { status: 'error', label: 'Conflict' };
    case 'activation_failed':
      return { status: 'failed', label: 'Activation Failed' };
    default:
      return { status: 'inactive', label: 'Not Started' };
  }
}

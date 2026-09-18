import React from 'react';
import godaddyIcon from '../assets/godaddy-icon.png';
import hostingerLogo from '../assets/hostinger-logo.png';
import cloudflareLogo from '../assets/cloudflare-logo.png';

/* Authentic brand logos for GoDaddy, Hostinger, and Cloudflare — shared by
 * DomainSetupModal (wizard steps) and DnsProviderCredentialForm (the API
 * Keys tab, and reconnecting an existing domain's credential) so both
 * present the same provider branding. */
export const GoDaddyIcon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  <img src={godaddyIcon} alt="GoDaddy" className={`${className} object-contain`} />
);

export const HostingerIcon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  <img src={hostingerLogo} alt="Hostinger" className={`${className} object-contain`} />
);

export const CloudflareIcon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  <img src={cloudflareLogo} alt="Cloudflare" className={`${className} object-contain`} />
);

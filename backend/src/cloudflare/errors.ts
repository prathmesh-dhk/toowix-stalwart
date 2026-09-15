export class CloudflareError extends Error {
  constructor(message: string, public readonly code: string, public readonly raw?: any) {
    super(message);
    this.name = 'CloudflareError';
  }
}

export class CloudflareUnavailableError extends CloudflareError {
  constructor(message: string, raw?: any) {
    super(message, 'CLOUDFLARE_UNAVAILABLE', raw);
    this.name = 'CloudflareUnavailableError';
  }
}

export class CloudflareAuthError extends CloudflareError {
  constructor(message: string = 'Invalid or expired Cloudflare API token', raw?: any) {
    super(message, 'CLOUDFLARE_AUTH_ERROR', raw);
    this.name = 'CloudflareAuthError';
  }
}

export class CloudflareDomainNotManagedError extends CloudflareError {
  constructor(domain: string, raw?: any) {
    super(`This Cloudflare credential does not manage the domain '${domain}'`, 'CLOUDFLARE_DOMAIN_NOT_MANAGED', raw);
    this.name = 'CloudflareDomainNotManagedError';
  }
}

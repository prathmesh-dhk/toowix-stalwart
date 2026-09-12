export class GoDaddyError extends Error {
  constructor(message: string, public readonly code: string, public readonly raw?: any) {
    super(message);
    this.name = 'GoDaddyError';
  }
}

export class GoDaddyUnavailableError extends GoDaddyError {
  constructor(message: string, raw?: any) {
    super(message, 'GODADDY_UNAVAILABLE', raw);
    this.name = 'GoDaddyUnavailableError';
  }
}

export class GoDaddyAuthError extends GoDaddyError {
  constructor(message: string = 'Invalid GoDaddy API key or secret', raw?: any) {
    super(message, 'GODADDY_AUTH_ERROR', raw);
    this.name = 'GoDaddyAuthError';
  }
}

export class GoDaddyDomainNotManagedError extends GoDaddyError {
  constructor(domain: string, raw?: any) {
    super(`This GoDaddy credential does not manage the domain '${domain}'`, 'GODADDY_DOMAIN_NOT_MANAGED', raw);
    this.name = 'GoDaddyDomainNotManagedError';
  }
}

export class GoDaddyConflictError extends GoDaddyError {
  constructor(message: string, raw?: any) {
    super(message, 'GODADDY_CONFLICT', raw);
    this.name = 'GoDaddyConflictError';
  }
}

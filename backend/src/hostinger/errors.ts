export class HostingerError extends Error {
  constructor(message: string, public readonly code: string, public readonly raw?: any) {
    super(message);
    this.name = 'HostingerError';
  }
}

export class HostingerUnavailableError extends HostingerError {
  constructor(message: string, raw?: any) {
    super(message, 'HOSTINGER_UNAVAILABLE', raw);
    this.name = 'HostingerUnavailableError';
  }
}

export class HostingerAuthError extends HostingerError {
  constructor(message: string = 'Invalid or expired Hostinger API token', raw?: any) {
    super(message, 'HOSTINGER_AUTH_ERROR', raw);
    this.name = 'HostingerAuthError';
  }
}

export class HostingerDomainNotManagedError extends HostingerError {
  constructor(domain: string, raw?: any) {
    super(`This Hostinger credential does not manage the domain '${domain}'`, 'HOSTINGER_DOMAIN_NOT_MANAGED', raw);
    this.name = 'HostingerDomainNotManagedError';
  }
}

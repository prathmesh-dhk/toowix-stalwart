export class StalwartError extends Error {
  constructor(message: string, public readonly code: string, public readonly raw?: any) {
    super(message);
    this.name = 'StalwartError';
  }
}

export class StalwartUnavailableError extends StalwartError {
  constructor(message: string, raw?: any) {
    super(message, 'STALWART_UNAVAILABLE', raw);
    this.name = 'StalwartUnavailableError';
  }
}

export class StalwartDomainExistsError extends StalwartError {
  constructor(domainName: string, raw?: any) {
    super(`Domain '${domainName}' already exists in Stalwart`, 'DOMAIN_EXISTS', raw);
    this.name = 'StalwartDomainExistsError';
  }
}

export class StalwartAccountExistsError extends StalwartError {
  constructor(accountName: string, raw?: any) {
    super(`Account '${accountName}' already exists in Stalwart`, 'ACCOUNT_EXISTS', raw);
    this.name = 'StalwartAccountExistsError';
  }
}

export class StalwartNotFoundError extends StalwartError {
  constructor(resource: string, id: string) {
    super(`${resource} with ID '${id}' not found in Stalwart`, 'NOT_FOUND');
    this.name = 'StalwartNotFoundError';
  }
}

export interface StalwartDomain {
  id: string;
  name: string;
  isEnabled: boolean;
  createdAt?: string;
  description?: string | null;
  dnsZoneFile?: string;
}

export interface StalwartAccount {
  id: string;
  name: string;
  domainId: string;
  emailAddress: string;
  description?: string | null;
  createdAt?: string;
  roles?: { '@type': string };
}

export interface CreateAccountInput {
  name: string; // local-part
  domainId: string;
  password: string;
  description?: string;
}

export interface StalwartCreatedAccount {
  id: string;
  name: string;
  domainId: string;
  emailAddress: string;
}

export interface StalwartDomain {
  id: string;
  name: string;
  isEnabled: boolean;
  createdAt?: string;
  description?: string | null;
  dnsZoneFile?: string;
  dkimManagement?: any;
  certificateManagement?: any;
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

export type StalwartDkimAlgorithm = 'Dkim1RsaSha256' | 'Dkim1Ed25519Sha256';

/**
 * Structured shape of an active x:DkimSignature/get entry, verified live
 * against the dev Stalwart container (see docs/STALWART_API_NOTES.md §7).
 * `publicKey` is always populated; `privateKey` is redacted by Stalwart
 * itself and never exposed by this client.
 */
export interface StalwartDkimKey {
  id: string;
  domainId: string;
  selector: string;
  algorithm: StalwartDkimAlgorithm;
  publicKey: string;
  stage: string;
  createdAt?: string;
}

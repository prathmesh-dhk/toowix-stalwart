import { BlockedRegistrationIdentityModel } from '../db/models/BlockedRegistrationIdentity';
import { OrganisationDeletionModel } from '../db/models/OrganisationDeletion';
import { normalizeRegistrationEmail } from '../utils/email-identity';
import { resolveIpLocation } from '../utils/geo';

/** Most blocked attempts kept per deletion record — this is fed by unauthenticated endpoints. */
const MAX_LOGGED_ATTEMPTS = 100;

export const REGISTRATION_EMAIL_BLOCKED_RESPONSE = {
  error: 'REGISTRATION_EMAIL_BLOCKED',
  message: 'This email address was used for an account in the past and can’t be used to register again. Please try a different email address.',
} as const;

/**
 * True if `email` belongs to an organisation that was permanently deleted. Keyed on the
 * normalized email identity only — never on organisation name or domain. When it is
 * blocked, the attempt is appended to the deleted organisation's audit record.
 */
export async function isRegistrationEmailBlocked(
  email: string,
  attempt: { ip: string; source: string }
): Promise<boolean> {
  const emailNormalized = normalizeRegistrationEmail(email);
  const blocked = await BlockedRegistrationIdentityModel.findOne({ emailNormalized });
  if (!blocked) return false;

  try {
    const geo = await resolveIpLocation(attempt.ip);
    await OrganisationDeletionModel.updateOne(
      { _id: blocked.deletionId },
      {
        $push: {
          'reRegistration.blockedAttempts': {
            $each: [{ at: new Date(), ip: attempt.ip, location: geo.location, source: attempt.source }],
            $slice: -MAX_LOGGED_ATTEMPTS,
          },
        },
      }
    );
  } catch (err) {
    // Logging the attempt must never turn a block into a 500 (or, worse, let the request through).
    console.error('[RegistrationBlock] Failed to log blocked attempt:', err);
  }
  return true;
}

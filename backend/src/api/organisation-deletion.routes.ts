import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { requireSuperAdmin } from '../auth/middleware';
import { AdminUserModel } from '../db/models/AdminUser';
import { captureRequestContext } from '../services/request-context.service';
import {
  DELETION_TIMINGS,
  OrganisationDeletionError,
  DeletionActor,
  StageInput,
  requestDeletion,
  confirmOrganisationName,
  initiateOtpProcess,
  generateFinalOtp,
  verifyFinalOtp,
  cancelDeletion,
  getActiveDeletion,
  listDeletionRecords,
  getDeletionRecord,
} from '../services/organisation-deletion.service';

const HOUR_MS = 60 * 60 * 1000;

const timingsForClient = {
  suspensionDays: DELETION_TIMINGS.suspensionMs / (24 * HOUR_MS),
  otpWaitHours: DELETION_TIMINGS.finalLockMs / HOUR_MS,
  finalOtpMinutes: DELETION_TIMINGS.finalOtpTtlMs / 60000,
};

async function buildActor(req: Request): Promise<DeletionActor> {
  const user = req.adminUser!;
  const record = await AdminUserModel.findById(user.id).select('name');
  return {
    id: user.id,
    name: record?.name ?? null,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId ?? null,
  };
}

const sendError = (res: Response, err: unknown) => {
  if (err instanceof OrganisationDeletionError) {
    return res.status(err.statusCode).json({ error: err.code, message: err.message, ...(err.availableAt ? { availableAt: err.availableAt } : {}) });
  }
  console.error('[OrganisationDeletion] Unexpected error:', err);
  return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Something went wrong while processing the deletion step.' });
};

const validation = (res: Response, error: z.ZodError) =>
  res.status(400).json({ error: 'VALIDATION_ERROR', details: error.errors });

/**
 * The deletion flow, mounted once for tenant admins (their own organisation) and once for
 * super admins (any organisation). `resolveTenantId` returns null for a malformed id.
 */
export function buildOrganisationDeletionRouter(resolveTenantId: (req: Request) => string | null): Router {
  const router = Router({ mergeParams: true });

  // Every step needs the same ingredients: which org, who is acting, and where from.
  const step =
    (handler: (input: StageInput, req: Request, res: Response) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      const tenantId = resolveTenantId(req);
      if (!tenantId) return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant ID' });
      try {
        const [actor, context] = await Promise.all([buildActor(req), captureRequestContext(req)]);
        return await handler({ tenantId, actor, context }, req, res);
      } catch (err) {
        return sendError(res, err);
      }
    };

  router.get(
    '/',
    step(async (input, _req, res) => {
      const deletion = await getActiveDeletion(input);
      return res.status(200).json({ deletion, timings: timingsForClient });
    })
  );

  router.post(
    '/',
    step(async (input, req, res) => {
      const parsed = z.object({ reason: z.string().trim().max(500).optional() }).safeParse(req.body ?? {});
      if (!parsed.success) return validation(res, parsed.error);
      const deletion = await requestDeletion({ ...input, reason: parsed.data.reason });
      return res.status(201).json({ deletion, timings: timingsForClient });
    })
  );

  router.post(
    '/cancel',
    step(async (input, _req, res) => res.status(200).json({ deletion: await cancelDeletion(input) }))
  );

  router.post(
    '/confirm-name',
    step(async (input, req, res) => {
      const parsed = z.object({ organisationName: z.string().max(200) }).safeParse(req.body ?? {});
      if (!parsed.success) return validation(res, parsed.error);
      return res.status(200).json({ deletion: await confirmOrganisationName({ ...input, organisationName: parsed.data.organisationName }) });
    })
  );

  router.post(
    '/otp/initiate',
    step(async (input, _req, res) => res.status(200).json({ deletion: await initiateOtpProcess(input) }))
  );

  router.post(
    '/otp/generate',
    step(async (input, _req, res) => res.status(200).json({ deletion: await generateFinalOtp(input) }))
  );

  router.post(
    '/otp/verify',
    step(async (input, req, res) => {
      const parsed = z.object({ code: z.string().regex(/^\d{6}$/, '6-digit verification code is required') }).safeParse(req.body ?? {});
      if (!parsed.success) return validation(res, parsed.error);
      return res.status(200).json({ deletion: await verifyFinalOtp({ ...input, code: parsed.data.code }) });
    })
  );

  return router;
}

/** Tenant admin: acts on their own organisation only (the id comes from their token, never the URL). */
export const tenantDeletionRouter = buildOrganisationDeletionRouter((req) => req.adminUser?.tenantId ?? null);

/** Super admin: acts on the organisation named in the URL. */
export const platformDeletionRouter = buildOrganisationDeletionRouter((req) =>
  mongoose.Types.ObjectId.isValid(req.params.id) ? req.params.id : null
);

/** Super admin, read-only: the permanent "Deleted Organisations" audit records. */
export const deletedOrganisationsRouter = Router();
deletedOrganisationsRouter.use(requireSuperAdmin);

deletedOrganisationsRouter.get('/', async (req: Request, res: Response) => {
  const parsed = z
    .object({
      stage: z.enum(['completed', 'active', 'all']).optional(),
      search: z.string().max(200).optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    })
    .safeParse(req.query);
  if (!parsed.success) return validation(res, parsed.error);
  return res.status(200).json(await listDeletionRecords(parsed.data));
});

deletedOrganisationsRouter.get('/:id', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed record ID' });
  }
  const record = await getDeletionRecord(req.params.id);
  if (!record) return res.status(404).json({ error: 'NOT_FOUND', message: 'Deletion record not found' });
  return res.status(200).json({ record });
});

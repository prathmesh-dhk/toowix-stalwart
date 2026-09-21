import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { requireSuperAdmin } from '../auth/middleware';
import { RegistrationApplicationModel } from '../db/models/RegistrationApplication';
import { TenantModel } from '../db/models/Tenant';
import { DomainModel } from '../db/models/Domain';
import { AuditLogModel } from '../db/models/AuditLog';
import { ActivationTokenModel } from '../db/models/ActivationToken';
import { emailService } from '../services/email.service';
import { config } from '../config';
import { getDefaultPlanSeatCount } from '../services/plan.service';
import { isRegistrationEmailBlocked, REGISTRATION_EMAIL_BLOCKED_RESPONSE } from '../services/registration-block.service';

export const superAdminRouter = Router();

// All routes in this router require Super Admin authentication
superAdminRouter.use(requireSuperAdmin);

const rejectSchema = z.object({
  reason: z.string().min(3, 'Rejection reason must be at least 3 characters').max(500),
});

// 1. List Applications with optional status filtering
superAdminRouter.get('/applications', async (req: Request, res: Response) => {
  const statusFilter = req.query.status as string;
  const limit = Math.min(parseInt(req.query.limit as string || '50', 10), 100);
  const skip = Math.max(parseInt(req.query.skip as string || '0', 10), 0);

  const query: Record<string, any> = {};
  if (statusFilter && statusFilter !== 'ALL') {
    query.status = statusFilter.toUpperCase();
  }

  const [applications, total] = await Promise.all([
    RegistrationApplicationModel.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('reviewedBy', 'email'),
    RegistrationApplicationModel.countDocuments(query),
  ]);

  return res.status(200).json({
    applications,
    pagination: {
      total,
      limit,
      skip,
    },
  });
});

// 2. Get Single Application by ID
superAdminRouter.get('/applications/:id', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed application ID' });
  }

  const application = await RegistrationApplicationModel.findById(req.params.id)
    .populate('reviewedBy', 'email');

  if (!application) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Application not found' });
  }

  return res.status(200).json({ application });
});

// 3. Approve Application
superAdminRouter.post('/applications/:id/approve', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed application ID' });
  }

  const application = await RegistrationApplicationModel.findById(req.params.id);

  if (!application) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Application not found' });
  }

  if (application.status !== 'PENDING_REVIEW') {
    return res.status(400).json({
      error: 'INVALID_STATUS',
      message: `Cannot approve application with status: ${application.status}`,
    });
  }

  // Verify domain has not been registered since application submission
  const existingDomain = await DomainModel.findOne({ domainName: application.requestedDomain });
  if (existingDomain) {
    return res.status(409).json({
      error: 'DOMAIN_CONFLICT',
      message: 'The requested domain is already claimed by an existing tenant.',
    });
  }

  // An application submitted before its email's previous organisation was deleted must not slip through.
  if (await isRegistrationEmailBlocked(application.contactEmail, { ip: req.ip || 'unknown', source: 'application-approval' })) {
    return res.status(403).json(REGISTRATION_EMAIL_BLOCKED_RESPONSE);
  }

  // 1. Create the Tenant in 'approved_pending_setup' status
  const tenant = await TenantModel.create({
    name: application.companyName,
    // The registration identity — what gets permanently blocked if this organisation is ever deleted.
    contactEmail: application.contactEmail,
    status: 'approved_pending_setup',
    mailboxLimit: await getDefaultPlanSeatCount(),
    mailboxCount: 0,
  });

  // 2. Create the Domain record tied to this tenant. Stalwart domain
  // creation and DNS provisioning happen only when a Super Admin explicitly
  // clicks "Activate Domain" later (see domain-activation.service.ts) — not
  // at approval time.
  const domain = await DomainModel.create({
    tenantId: tenant._id,
    domainName: application.requestedDomain,
    stalwartDomainId: null,
    status: 'active',
    dnsStatus: 'not_started',
    isPrimary: true,
  });

  // 4. Update application record
  application.status = 'APPROVED';
  application.reviewedBy = new mongoose.Types.ObjectId(req.adminUser!.id);
  application.reviewedAt = new Date();
  await application.save();

  // 5. Generate 48-hour single-use activation token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await ActivationTokenModel.create({
    tenantId: tenant._id,
    tokenHash,
    contactEmail: application.contactEmail,
    expiresAt: new Date(Date.now() + 48 * 3600 * 1000), // 48 hours
  });

  const activationLink = `${config.tenantAdminUrl}/activate?token=${rawToken}`;

  // 6. Send activation email to applicant's registered contact email
  const emailResult = await emailService.sendTenantActivationEmail({
    to: application.contactEmail,
    companyName: tenant.name,
    applicantName: application.applicantName,
    domainName: domain.domainName,
    activationLink,
    expiresHours: 48,
  });

  // 7. Audit event
  await AuditLogModel.create({
    actorId: req.adminUser!.id,
    actorRole: req.adminUser!.role,
    actorEmail: req.adminUser!.email,
    actorIp: req.ip || req.socket.remoteAddress || 'unknown',
    tenantId: tenant._id,
    action: 'TENANT_APPLICATION_APPROVED',
    resource: 'REGISTRATION_APPLICATION',
    resourceId: application._id.toString(),
    status: 'SUCCESS',
    metadata: {
      tenantId: tenant._id.toString(),
      domainId: domain._id.toString(),
      companyName: tenant.name,
      domainName: domain.domainName,
      contactEmail: application.contactEmail,
      activationLink,
      emailSent: emailResult.success,
      emailError: emailResult.error,
    },
    timestamp: new Date(),
  });

  return res.status(200).json({
    success: true,
    message: emailResult.success
      ? `Application approved! Activation email sent to ${application.contactEmail}. Domain "${domain.domainName}" still needs "Activate Domain" to provision mail service and DNS.`
      : `Application approved, but email delivery failed: ${emailResult.error}. Domain "${domain.domainName}" still needs "Activate Domain" to provision mail service and DNS.`,
    activationLink,
    emailSent: emailResult.success,
    emailError: emailResult.error,
    tenant: {
      id: tenant._id.toString(),
      name: tenant.name,
      status: tenant.status,
      domain: domain.domainName,
      dnsStatus: domain.dnsStatus,
      contactEmail: application.contactEmail,
    },
  });
});

// 4. Reject Application
superAdminRouter.post('/applications/:id/reject', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed application ID' });
  }

  const parseResult = rejectSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { reason } = parseResult.data;
  const application = await RegistrationApplicationModel.findById(req.params.id);

  if (!application) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Application not found' });
  }

  if (application.status !== 'PENDING_REVIEW') {
    return res.status(400).json({
      error: 'INVALID_STATUS',
      message: `Cannot reject application with status: ${application.status}`,
    });
  }

  application.status = 'REJECTED';
  application.rejectionReason = reason.trim();
  application.reviewedBy = new mongoose.Types.ObjectId(req.adminUser!.id);
  application.reviewedAt = new Date();
  await application.save();

  // Audit event
  await AuditLogModel.create({
    actorId: req.adminUser!.id,
    actorRole: req.adminUser!.role,
    actorEmail: req.adminUser!.email,
    actorIp: req.ip || req.socket.remoteAddress || 'unknown',
    action: 'TENANT_APPLICATION_REJECTED',
    resource: 'REGISTRATION_APPLICATION',
    resourceId: application._id.toString(),
    status: 'SUCCESS',
    metadata: {
      companyName: application.companyName,
      requestedDomain: application.requestedDomain,
      rejectionReason: application.rejectionReason,
    },
    timestamp: new Date(),
  });

    return res.status(200).json({
      success: true,
      message: 'Application rejected.',
      application: {
        id: application._id.toString(),
        status: application.status,
        rejectionReason: application.rejectionReason,
      },
    });
  });

// ==========================================
// DOMAIN DELETION REQUESTS (SUPER ADMIN QUEUE)
// ==========================================


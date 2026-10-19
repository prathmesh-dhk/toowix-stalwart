import crypto from 'crypto';
import mongoose, { Types } from 'mongoose';
import { CouponModel, ICoupon, CouponStatus } from '../db/models/Coupon';
import { logAudit } from '../audit/service';
import { config } from '../config';

const SAFE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // excludes 0, 1, I, O to avoid visual confusion

export interface CreateCouponDTO {
  code?: string;
  extraTrialDays: number;
  expiresAt?: string | Date | null;
  description?: string | null;
  maxUses?: number;
}

export interface BatchCreateCouponDTO {
  count: number;
  prefix?: string;
  extraTrialDays: number;
  expiresAt?: string | Date | null;
  description?: string | null;
  maxUses?: number;
}

export class CouponService {
  /**
   * Generates a human-friendly, cryptographically secure coupon code.
   * Format: `PREFIX-XXXX-XXXX` or `TWX-XXXX-XXXX`
   */
  generateSecureCode(prefix = 'TWX'): string {
    const cleanPrefix = prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'TWX';
    const bytes = crypto.randomBytes(8);
    let part1 = '';
    let part2 = '';
    for (let i = 0; i < 4; i++) {
      part1 += SAFE_ALPHABET[bytes[i] % SAFE_ALPHABET.length];
      part2 += SAFE_ALPHABET[bytes[i + 4] % SAFE_ALPHABET.length];
    }
    return `${cleanPrefix}-${part1}-${part2}`;
  }

  /**
   * Creates a single coupon with audit logging.
   */
  async createCoupon(data: CreateCouponDTO, adminUserId?: string | null, adminRole = 'SUPER_ADMIN'): Promise<ICoupon> {
    let finalCode = (data.code || '').trim().toUpperCase();
    if (!finalCode) {
      finalCode = this.generateSecureCode();
    }

    // Validate format
    if (!/^[A-Z0-9_-]{3,32}$/.test(finalCode)) {
      throw new Error('Coupon code must be 3-32 alphanumeric characters, dashes, or underscores.');
    }

    const existing = await CouponModel.findOne({ code: finalCode });
    if (existing) {
      throw new Error(`A coupon with code "${finalCode}" already exists.`);
    }

    // Validate values
    if (!Number.isInteger(data.maxUses ?? 1) || (data.maxUses ?? 1) < 1 || (data.maxUses ?? 1) > 10000) {
      throw new Error('Redemption limit must be a whole number between 1 and 10,000.');
    }
    if (!Number.isInteger(data.extraTrialDays) || data.extraTrialDays < 1 || data.extraTrialDays > 365) {
      throw new Error('Extra trial days must be a whole number between 1 and 365.');
    }

    const coupon = await CouponModel.create({
      code: finalCode,
      extraTrialDays: data.extraTrialDays,
      maxUses: data.maxUses ?? 1,
      usedCount: 0,
      status: 'active',
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      description: data.description ? data.description.trim() : null,
      createdBy: adminUserId ? new Types.ObjectId(adminUserId) : null,
      redemptions: [],
    });

    await logAudit({
      actorId: adminUserId || null,
      actorRole: adminRole,
      action: 'COUPON_CREATED',
      resource: 'COUPON',
      resourceId: coupon._id.toString(),
      metadata: {
        code: coupon.code,
        extraTrialDays: coupon.extraTrialDays,
        maxUses: coupon.maxUses,
      },
    });

    return coupon;
  }

  /** Creates a batch of coupon codes with a shared redemption limit. */
  async createBatchCoupons(
    data: BatchCreateCouponDTO,
    adminUserId?: string | null,
    adminRole = 'SUPER_ADMIN'
  ): Promise<ICoupon[]> {
    const count = Math.min(Math.max(data.count, 1), 100);
    const maxUses = data.maxUses ?? 1;
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10000) {
      throw new Error('Redemption limit must be a whole number between 1 and 10,000.');
    }
    const prefix = data.prefix || 'TWX';

    if (!Number.isInteger(data.extraTrialDays) || data.extraTrialDays < 1 || data.extraTrialDays > 365) {
      throw new Error('Extra trial days must be a whole number between 1 and 365.');
    }

    const codes: string[] = [];
    const docs = [];
    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    const description = data.description ? data.description.trim() : null;

    for (let i = 0; i < count; i++) {
      let code = this.generateSecureCode(prefix);
      // Ensure unique in current batch
      while (codes.includes(code)) {
        code = this.generateSecureCode(prefix);
      }
      codes.push(code);

      docs.push({
        code,
        extraTrialDays: data.extraTrialDays,
        maxUses,
        usedCount: 0,
        status: 'active' as CouponStatus,
        expiresAt,
        description,
        createdBy: adminUserId ? new Types.ObjectId(adminUserId) : null,
        redemptions: [],
      });
    }

    const created = await CouponModel.insertMany(docs);

    await logAudit({
      actorId: adminUserId || null,
      actorRole: adminRole,
      action: 'COUPONS_BATCH_CREATED',
      resource: 'COUPON',
      resourceId: null,
      metadata: {
        count: created.length,
        prefix,
        extraTrialDays: data.extraTrialDays,
        maxUses,
      },
    });

    return created as ICoupon[];
  }

  /**
   * Lists coupons with filtering, search, and pagination.
   */
  async listCoupons(query: {
    status?: string;
    search?: string;
    limit?: number;
    skip?: number;
  }): Promise<{ coupons: any[]; total: number; activeCount: number; usedCount: number }> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const skip = Math.max(query.skip ?? 0, 0);

    const filter: Record<string, any> = {};

    if (query.status && query.status !== 'all') {
      filter.status = query.status;
    }

    if (query.search && query.search.trim()) {
      const searchRegex = new RegExp(query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ code: searchRegex }, { description: searchRegex }];
    }

    // Auto-update expired coupons
    await CouponModel.updateMany(
      {
        status: 'active',
        expiresAt: { $ne: null, $lt: new Date() },
      },
      { $set: { status: 'expired' } }
    );

    const [coupons, total, activeCount, usedCount] = await Promise.all([
      CouponModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('createdBy', 'email')
        .populate('redemptions.tenantId', 'name')
        .lean(),
      CouponModel.countDocuments(filter),
      CouponModel.countDocuments({ status: 'active' }),
      CouponModel.countDocuments({ status: 'used' }),
    ]);

    const serialized = coupons.map((c: any) => ({
      id: c._id.toString(),
      code: c.code,
      extraTrialDays: c.extraTrialDays,
      maxUses: c.maxUses,
      usedCount: c.usedCount,
      status: c.status,
      expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
      description: c.description || null,
      createdByEmail: c.createdBy?.email || null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      redemptions: (c.redemptions || []).map((r: any) => ({
        tenantId: r.tenantId?._id?.toString() || r.tenantId?.toString() || '',
        tenantName: r.tenantId?.name || null,
        domainId: r.domainId?.toString() || null,
        redeemedAt: r.redeemedAt ? new Date(r.redeemedAt).toISOString() : new Date().toISOString(),
        extraTrialDays: r.extraTrialDays,
      })),
    }));

    return {
      coupons: serialized,
      total,
      activeCount,
      usedCount,
    };
  }

  /**
   * Revokes an active coupon.
   */
  async revokeCoupon(id: string, adminUserId?: string | null): Promise<void> {
    const coupon = await CouponModel.findById(id);
    if (!coupon) {
      throw new Error('Coupon not found.');
    }
    if (coupon.status === 'used') {
      throw new Error('Cannot revoke a coupon that has already been redeemed.');
    }
    coupon.status = 'revoked';
    await coupon.save();

    await logAudit({
      actorId: adminUserId || null,
      actorRole: 'SUPER_ADMIN',
      action: 'COUPON_REVOKED',
      resource: 'COUPON',
      resourceId: coupon._id.toString(),
      metadata: { code: coupon.code },
    });
  }

  /**
   * Deletes an unused coupon.
   */
  async deleteCoupon(id: string, adminUserId?: string | null): Promise<void> {
    const coupon = await CouponModel.findById(id);
    if (!coupon) {
      throw new Error('Coupon not found.');
    }
    if (coupon.usedCount > 0) {
      throw new Error('Cannot delete a coupon that has already been used.');
    }
    await CouponModel.findByIdAndDelete(id);

    await logAudit({
      actorId: adminUserId || null,
      actorRole: 'SUPER_ADMIN',
      action: 'COUPON_DELETED',
      resource: 'COUPON',
      resourceId: id,
      metadata: { code: coupon.code },
    });
  }

  /**
   * Validates a coupon code for a tenant before redemption.
   */
  async validateCoupon(code: string, tenantId?: string): Promise<{
    valid: boolean;
    code: string;
    extraTrialDays?: number;
    description?: string | null;
    message: string;
  }> {
    const cleanCode = (code || '').trim().toUpperCase();
    if (!cleanCode) {
      return { valid: false, code: cleanCode, message: 'Please enter a coupon code.' };
    }

    const coupon = await CouponModel.findOne({ code: cleanCode });
    if (!coupon) {
      return { valid: false, code: cleanCode, message: 'Invalid coupon code.' };
    }

    if (coupon.status === 'revoked') {
      return { valid: false, code: cleanCode, message: 'This coupon code has been revoked.' };
    }

    if (coupon.status === 'used' || coupon.usedCount >= coupon.maxUses) {
      return { valid: false, code: cleanCode, message: 'This coupon has reached its redemption limit.' };
    }

    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      return { valid: false, code: cleanCode, message: 'This coupon code has expired.' };
    }

    if (tenantId) {
      const alreadyRedeemed = coupon.redemptions.some(
        (r) => r.tenantId.toString() === tenantId.toString()
      );
      if (alreadyRedeemed) {
        return { valid: false, code: cleanCode, message: 'Your organization has already redeemed this coupon.' };
      }
    }

    const descriptionMessage = `+${coupon.extraTrialDays} extra free trial days applied!`;

    return {
      valid: true,
      code: coupon.code,
      extraTrialDays: coupon.extraTrialDays,
      description: coupon.description || descriptionMessage,
      message: descriptionMessage,
    };
  }

  /** Atomically claims a coupon for a tenant. Moving the trial end is billing.service's job. */
  async redeemCoupon(
    code: string,
    tenantId: string,
    actorId?: string | null
  ): Promise<{
    success: boolean;
    coupon: {
      code: string;
      extraTrialDays: number;
    };
    message: string;
  }> {
    const cleanCode = (code || '').trim().toUpperCase();
    if (!cleanCode) {
      throw new Error('Coupon code is required.');
    }

    const tenantObjectId = new Types.ObjectId(tenantId);

    // Check pre-conditions
    const existing = await CouponModel.findOne({ code: cleanCode });
    if (!existing) {
      throw new Error('Invalid coupon code.');
    }
    if (existing.status === 'revoked') {
      throw new Error('This coupon has been revoked.');
    }
    if (existing.status === 'used' || existing.usedCount >= existing.maxUses) {
      throw new Error('This coupon has reached its redemption limit.');
    }
    if (existing.expiresAt && existing.expiresAt < new Date()) {
      throw new Error('This coupon code has expired.');
    }
    if (existing.redemptions.some((r) => r.tenantId.toString() === tenantId)) {
      throw new Error('Your organization has already redeemed this coupon.');
    }

    // Atomic claim: each tenant can redeem once, and the global redemption
    // limit is enforced even when several tenants redeem concurrently.
    const claimed = await CouponModel.findOneAndUpdate(
      {
        _id: existing._id,
        status: 'active',
        usedCount: { $lt: existing.maxUses },
        'redemptions.tenantId': { $ne: tenantObjectId },
      },
      {
        $inc: { usedCount: 1 },
        $push: {
          redemptions: {
            tenantId: tenantObjectId,
            domainId: null,
            redeemedAt: new Date(),
            extraTrialDays: existing.extraTrialDays,
          },
        },
      },
      { returnDocument: 'after' }
    );

    if (!claimed) {
      throw new Error('Failed to redeem coupon. It may have just been claimed by another user.');
    }

    if (claimed.usedCount >= claimed.maxUses) {
      await CouponModel.updateOne({ _id: claimed._id, usedCount: { $gte: claimed.maxUses } }, { $set: { status: 'used' } });
      claimed.status = 'used';
    }

    const extraDays = claimed.extraTrialDays;

    const message = `Success! Added ${extraDays} bonus days to your free trial.`;

    await logAudit({
      actorId: actorId || null,
      actorRole: 'TENANT_ADMIN',
      tenantId: tenantObjectId.toString(),
      action: 'COUPON_REDEEMED',
      resource: 'COUPON',
      resourceId: claimed._id.toString(),
      metadata: {
        code: claimed.code,
        extraTrialDays: claimed.extraTrialDays,
      },
    });

    return {
      success: true,
      coupon: {
        code: claimed.code,
        extraTrialDays: claimed.extraTrialDays,
      },
      message,
    };
  }

  /** Gives a claimed redemption back (the trial could not be extended after all). */
  async releaseRedemption(code: string, tenantId: string): Promise<void> {
    const tenantObjectId = new Types.ObjectId(tenantId);
    const coupon = await CouponModel.findOneAndUpdate(
      { code, 'redemptions.tenantId': tenantObjectId },
      { $inc: { usedCount: -1 }, $pull: { redemptions: { tenantId: tenantObjectId } } },
      { returnDocument: 'after' }
    );
    if (coupon?.status === 'used' && coupon.usedCount < coupon.maxUses) {
      await CouponModel.updateOne({ _id: coupon._id, status: 'used' }, { $set: { status: 'active' } });
    }
  }
}

export const couponService = new CouponService();

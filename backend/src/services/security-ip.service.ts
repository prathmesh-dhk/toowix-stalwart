import net from 'net';
import { stalwartClient } from '../stalwart/client';
import { StalwartBlockedIp, StalwartAllowedIp } from '../stalwart/types';
import { AuditLogModel } from '../db/models/AuditLog';

export interface IpCheckResult {
  ip: string;
  isBlocked: boolean;
  blockedEntry: StalwartBlockedIp | null;
  isAllowed: boolean;
  allowedEntry: StalwartAllowedIp | null;
}

export interface ActorContext {
  id: string;
  role: string;
  ip?: string;
}

/**
 * Validates whether a string is a valid IPv4, IPv6, or valid CIDR notation.
 */
export function isValidIpOrCidr(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  const trimmed = input.trim();

  // Check plain IP
  if (net.isIP(trimmed) !== 0) return true;

  // Check CIDR format: <IP>/<Prefix>
  const parts = trimmed.split('/');
  if (parts.length === 2) {
    const [ipPart, prefixPart] = parts;
    const ipFamily = net.isIP(ipPart);
    if (ipFamily === 0) return false;

    const prefix = parseInt(prefixPart, 10);
    if (isNaN(prefix)) return false;

    if (ipFamily === 4 && prefix >= 0 && prefix <= 32) return true;
    if (ipFamily === 6 && prefix >= 0 && prefix <= 128) return true;
  }

  return false;
}

/**
 * Normalizes an IP string by stripping trailing /32 for single IPv4 comparison.
 */
function normalizeIp(ip: string): string {
  return ip.trim().replace(/\/32$/, '');
}

export class SecurityIpService {
  /**
   * Retrieves all currently blocked IPs from Stalwart.
   */
  async listBlockedIps(): Promise<StalwartBlockedIp[]> {
    return stalwartClient.listBlockedIps();
  }

  /**
   * Retrieves all currently whitelisted/allowed IPs from Stalwart.
   */
  async listAllowedIps(): Promise<StalwartAllowedIp[]> {
    return stalwartClient.listAllowedIps();
  }

  /**
   * Checks whether a specific IP address is currently blocked or whitelisted.
   */
  async checkIpStatus(targetIp: string): Promise<IpCheckResult> {
    const cleanTarget = normalizeIp(targetIp);

    const [blockedList, allowedList] = await Promise.all([
      this.listBlockedIps(),
      this.listAllowedIps(),
    ]);

    const blockedEntry =
      blockedList.find((b) => normalizeIp(b.address) === cleanTarget) || null;
    const allowedEntry =
      allowedList.find((a) => normalizeIp(a.address) === cleanTarget) || null;

    return {
      ip: targetIp.trim(),
      isBlocked: !!blockedEntry,
      blockedEntry,
      isAllowed: !!allowedEntry,
      allowedEntry,
    };
  }

  /**
   * Automated Unblock: Removes a blocked IP entry and executes ReloadBlockedIps on Stalwart.
   * Can unblock either by Stalwart record ID or by IP address.
   */
  async unblockIp(
    params: { id?: string; address?: string },
    actor: ActorContext
  ): Promise<{ unblockedCount: number; message: string }> {
    let targetIds: string[] = [];
    let targetAddress = params.address || '';

    if (params.id) {
      targetIds = [params.id];
    } else if (params.address) {
      const cleanAddress = normalizeIp(params.address);
      const blockedList = await this.listBlockedIps();
      const matched = blockedList.filter((b) => normalizeIp(b.address) === cleanAddress);
      targetIds = matched.map((b) => b.id);
      if (matched.length > 0 && !targetAddress) {
        targetAddress = matched[0].address;
      }
    }

    if (targetIds.length === 0) {
      // If no matching ID found, still trigger reload to be safe
      await stalwartClient.reloadBlockedIps();
      return {
        unblockedCount: 0,
        message: 'No active block entry found for specified identifier.',
      };
    }

    for (const id of targetIds) {
      await stalwartClient.unblockIp(id);
    }

    try {
      await AuditLogModel.create({
        actorId: actor.id,
        actorRole: actor.role,
        actorIp: actor.ip || '127.0.0.1',
        action: 'SECURITY_IP_UNBLOCKED',
        resource: 'firewall',
        resourceId: targetIds.join(','),
        status: 'SUCCESS',
        metadata: {
          targetAddress,
          targetIds,
        },
        timestamp: new Date(),
      });
    } catch {
      // Non-blocking audit failure
    }

    return {
      unblockedCount: targetIds.length,
      message: `Successfully unblocked IP and reloaded firewall rules.`,
    };
  }

  /**
   * Manually blocks an IP address and reloads Stalwart firewall rules.
   */
  async blockIp(
    address: string,
    reason: string = 'manual',
    actor: ActorContext
  ): Promise<StalwartBlockedIp> {
    if (!isValidIpOrCidr(address)) {
      throw new Error('Invalid IP address or CIDR notation format.');
    }

    const item = await stalwartClient.blockIp(address, reason);

    try {
      await AuditLogModel.create({
        actorId: actor.id,
        actorRole: actor.role,
        actorIp: actor.ip || '127.0.0.1',
        action: 'SECURITY_IP_BLOCKED',
        resource: 'firewall',
        resourceId: item.id,
        status: 'SUCCESS',
        metadata: {
          address: item.address,
          reason,
        },
        timestamp: new Date(),
      });
    } catch {
      // Non-blocking audit failure
    }

    return item;
  }

  /**
   * Adds an IP or CIDR range to the Allowed IPs list (whitelist).
   */
  async addAllowedIp(
    address: string,
    reason: string,
    actor: ActorContext
  ): Promise<StalwartAllowedIp> {
    if (!isValidIpOrCidr(address)) {
      throw new Error('Invalid IP address or CIDR notation format.');
    }

    const item = await stalwartClient.addAllowedIp(address, reason);

    try {
      await AuditLogModel.create({
        actorId: actor.id,
        actorRole: actor.role,
        actorIp: actor.ip || '127.0.0.1',
        action: 'SECURITY_IP_WHITELISTED',
        resource: 'firewall',
        resourceId: item.id,
        status: 'SUCCESS',
        metadata: {
          address: item.address,
          reason,
        },
        timestamp: new Date(),
      });
    } catch {
      // Non-blocking audit failure
    }

    return item;
  }

  /**
   * Removes an IP or CIDR range from the Allowed IPs list (whitelist).
   */
  async removeAllowedIp(id: string, actor: ActorContext): Promise<void> {
    await stalwartClient.removeAllowedIp(id);

    try {
      await AuditLogModel.create({
        actorId: actor.id,
        actorRole: actor.role,
        actorIp: actor.ip || '127.0.0.1',
        action: 'SECURITY_IP_WHITELIST_REMOVED',
        resource: 'firewall',
        resourceId: id,
        status: 'SUCCESS',
        metadata: { id },
        timestamp: new Date(),
      });
    } catch {
      // Non-blocking audit failure
    }
  }
}

export const securityIpService = new SecurityIpService();

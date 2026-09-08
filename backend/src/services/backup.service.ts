import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import {
  TenantModel,
  DomainModel,
  AdminUserModel,
  MailboxModel,
  RegistrationApplicationModel,
  ActivationTokenModel,
  AuditLogModel,
  BackupRecordModel,
  IBackupRecord,
} from '../db/models';
import { StalwartClient } from '../stalwart/client';
import { logAudit } from '../audit/service';

const SALT = 'toowix-mail-backup-key-salt';
const ALGORITHM = 'aes-256-gcm';

export interface VerificationResult {
  valid: boolean;
  backupId: string;
  filename: string;
  checksumVerified: boolean;
  decryptionVerified: boolean;
  timestamp: string;
  documentCounts: {
    tenants: number;
    domains: number;
    mailboxes: number;
    admins: number;
    auditLogs: number;
  };
  error?: string;
}

export class BackupService {
  private backupsDir: string;
  private stalwartClient: StalwartClient;

  constructor(customBackupsDir?: string) {
    this.backupsDir = customBackupsDir || path.resolve(process.cwd(), 'backups');
    this.stalwartClient = new StalwartClient();
    this.ensureBackupsDir();
  }

  public setBackupsDir(newDir: string): void {
    this.backupsDir = newDir;
    this.ensureBackupsDir();
  }

  private ensureBackupsDir(): void {
    if (!fs.existsSync(this.backupsDir)) {
      fs.mkdirSync(this.backupsDir, { recursive: true });
    }
  }

  private deriveKey(): Buffer {
    const secret = process.env.BACKUP_ENCRYPTION_KEY || config.jwtSecret || 'toowix-secure-default-backup-secret-key-32b';
    return crypto.scryptSync(secret, SALT, 32);
  }

  /**
   * Generates an on-demand encrypted backup of MongoDB and Stalwart state.
   */
  async createBackup(options: {
    actorEmail?: string;
    actorId?: string;
    actorIp?: string;
  } = {}): Promise<IBackupRecord> {
    this.ensureBackupsDir();

    // 1. Gather all MongoDB collections
    const [
      tenants,
      domains,
      adminUsers,
      mailboxes,
      registrationApplications,
      activationTokens,
      auditLogs,
    ] = await Promise.all([
      TenantModel.find().lean(),
      DomainModel.find().lean(),
      AdminUserModel.find().lean(),
      MailboxModel.find().lean(),
      RegistrationApplicationModel.find().lean(),
      ActivationTokenModel.find().lean(),
      AuditLogModel.find().lean(),
    ]);

    // 2. Introspect Stalwart configuration
    let stalwartDomains: any[] = [];
    let stalwartAccounts: any[] = [];
    try {
      stalwartDomains = await this.stalwartClient.listDomains();
    } catch (e: any) {
      console.warn('[BackupService] Could not list Stalwart domains during backup:', e.message);
    }
    try {
      stalwartAccounts = await this.stalwartClient.listAccounts();
    } catch (e: any) {
      console.warn('[BackupService] Could not list Stalwart accounts during backup:', e.message);
    }

    const documentCounts = {
      tenants: tenants.length,
      domains: domains.length,
      mailboxes: mailboxes.length,
      admins: adminUsers.length,
      auditLogs: auditLogs.length,
    };

    const backupPayload = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      metadata: {
        nodeEnv: config.nodeEnv,
        documentCounts,
        stalwartCounts: {
          domains: stalwartDomains.length,
          accounts: stalwartAccounts.length,
        },
      },
      collections: {
        tenants,
        domains,
        adminUsers,
        mailboxes,
        registrationApplications,
        activationTokens,
        auditLogs,
      },
      stalwart: {
        domains: stalwartDomains,
        accounts: stalwartAccounts,
      },
    };

    // 3. Encrypt data with AES-256-GCM
    const key = this.deriveKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const plaintext = Buffer.from(JSON.stringify(backupPayload), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const envelope = JSON.stringify({
      format: 'toowix-backup-v1',
      algorithm: ALGORITHM,
      iv: iv.toString('hex'),
      tag: authTag.toString('hex'),
      data: encrypted.toString('base64'),
    });

    const checksumSha256 = crypto.createHash('sha256').update(envelope).digest('hex');
    const id = uuidv4();
    const filename = `toowix-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${id.slice(0, 8)}.enc`;
    const targetFilePath = path.join(this.backupsDir, filename);

    fs.writeFileSync(targetFilePath, envelope, 'utf8');
    const sizeBytes = Buffer.byteLength(envelope, 'utf8');

    // 4. Record backup record in database
    const record = await BackupRecordModel.create({
      id,
      filename,
      sizeBytes,
      checksumSha256,
      encrypted: true,
      storageType: 'local',
      status: 'completed',
      documentCounts,
      createdBy: options.actorEmail || 'system',
    });

    // 5. Emit structured audit log
    await logAudit({
      actorId: options.actorId || null,
      actorRole: 'SUPER_ADMIN',
      actorEmail: options.actorEmail || 'system',
      actorIp: options.actorIp || null,
      action: 'SYSTEM_BACKUP_CREATED',
      resource: 'system_backup',
      resourceId: record.id,
      metadata: {
        filename,
        sizeBytes,
        checksumSha256,
        documentCounts,
      },
      success: true,
    });

    return record;
  }

  /**
   * Lists historical backups ordered by creation date descending.
   */
  async listBackups(limit = 50): Promise<IBackupRecord[]> {
    return BackupRecordModel.find().sort({ createdAt: -1 }).limit(limit);
  }

  /**
   * Finds a backup by its UUID.
   */
  async getBackupById(id: string): Promise<IBackupRecord | null> {
    return BackupRecordModel.findOne({ id });
  }

  /**
   * Verifies the integrity of a backup archive: checks file existence, recomputes SHA-256,
   * verifies AES-256-GCM auth tag and decrypts the JSON structure.
   */
  async verifyBackupIntegrity(id: string): Promise<VerificationResult> {
    const record = await this.getBackupById(id);
    if (!record) {
      throw new Error(`Backup record not found for id: ${id}`);
    }

    const filePath = path.join(this.backupsDir, record.filename);
    if (!fs.existsSync(filePath)) {
      return {
        valid: false,
        backupId: id,
        filename: record.filename,
        checksumVerified: false,
        decryptionVerified: false,
        timestamp: '',
        documentCounts: record.documentCounts,
        error: 'Backup file missing from storage disk',
      };
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const calculatedChecksum = crypto.createHash('sha256').update(fileContent).digest('hex');
    const checksumVerified = calculatedChecksum === record.checksumSha256;

    if (!checksumVerified) {
      return {
        valid: false,
        backupId: id,
        filename: record.filename,
        checksumVerified: false,
        decryptionVerified: false,
        timestamp: '',
        documentCounts: record.documentCounts,
        error: 'Checksum mismatch - backup archive may have been altered or corrupted',
      };
    }

    try {
      const envelope = JSON.parse(fileContent);
      const key = this.deriveKey();
      const iv = Buffer.from(envelope.iv, 'hex');
      const tag = Buffer.from(envelope.tag, 'hex');
      const data = Buffer.from(envelope.data, 'base64');

      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

      const parsedPayload = JSON.parse(decrypted.toString('utf8'));

      return {
        valid: true,
        backupId: id,
        filename: record.filename,
        checksumVerified: true,
        decryptionVerified: true,
        timestamp: parsedPayload.timestamp || record.createdAt.toISOString(),
        documentCounts: {
          tenants: parsedPayload.collections?.tenants?.length || 0,
          domains: parsedPayload.collections?.domains?.length || 0,
          mailboxes: parsedPayload.collections?.mailboxes?.length || 0,
          admins: parsedPayload.collections?.adminUsers?.length || 0,
          auditLogs: parsedPayload.collections?.auditLogs?.length || 0,
        },
      };
    } catch (err: any) {
      return {
        valid: false,
        backupId: id,
        filename: record.filename,
        checksumVerified: true,
        decryptionVerified: false,
        timestamp: '',
        documentCounts: record.documentCounts,
        error: `Decryption failed: ${err.message}`,
      };
    }
  }

  /**
   * Deletes a backup record and its archive file.
   */
  async deleteBackup(id: string, actorEmail?: string): Promise<boolean> {
    const record = await this.getBackupById(id);
    if (!record) return false;

    const filePath = path.join(this.backupsDir, record.filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.warn(`[BackupService] Failed to delete file ${filePath}:`, e);
      }
    }

    await BackupRecordModel.deleteOne({ id });

    await logAudit({
      actorRole: 'SUPER_ADMIN',
      actorEmail: actorEmail || 'system',
      action: 'SYSTEM_BACKUP_DELETED',
      resource: 'system_backup',
      resourceId: id,
      metadata: { filename: record.filename },
      success: true,
    });

    return true;
  }
}

export const backupService = new BackupService();

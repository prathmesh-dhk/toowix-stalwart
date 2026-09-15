import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { checkDatabaseHealth } from './db/connection';
import http from 'http';
import https from 'https';

import { authRouter } from './api/auth.routes';
import { publicRouter } from './api/public.routes';
import { superAdminRouter } from './api/super-admin.routes';
import { platformTenantRouter } from './api/platform-tenant.routes';
import { systemRouter } from './api/system.routes';
import { tenantMeRouter } from './api/tenant.routes';
import { tenantMailboxRouter, mailboxRouter } from './api/mailbox.routes';
import { auditRouter } from './api/audit.routes';
import { metricsService } from './services/metrics.service';

export const app = express();

// Enable trust proxy so Express reads client IP from X-Forwarded-For when deployed behind Nginx / Docker
app.set('trust proxy', true);

const allowedOrigins = [
  config.frontendOrigin,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || origin.endsWith('.toowix.com') || origin.includes('localhost')) {
      return callback(null, true);
    }
    return callback(null, true); // Dev-permissive
  },
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());
app.use(metricsService.middleware());

// Active Routes
app.use('/api/auth', authRouter);
app.use('/api/public', publicRouter);
app.use('/api/super-admin', superAdminRouter);
app.use('/api/platform/tenants', platformTenantRouter);
app.use('/api/tenants', tenantMeRouter);
app.use('/api/tenants/me/mailboxes', tenantMailboxRouter);
app.use('/api/mailboxes', mailboxRouter);
app.use('/api/audit-logs', auditRouter);
app.use('/api/system', systemRouter);

// Prometheus Metrics Endpoint
app.get('/metrics', async (_req, res) => {
  try {
    const metricsData = await metricsService.getPrometheusMetrics();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(metricsData);
  } catch (err: any) {
    res.status(500).send(`# Error generating metrics: ${err.message}\n`);
  }
});

// Health Check Endpoint
app.get('/healthz', async (_req, res) => {
  let dbStatus = 'healthy';
  let stalwartStatus = 'unknown';

  // 1. Check MongoDB
  const dbHealth = await checkDatabaseHealth();
  dbStatus = dbHealth.status;

  // 2. Non-blocking check for Stalwart reachability
  try {
    await new Promise<void>((resolve) => {
      const targetUrl = new URL(config.stalwart.url + '/api/account');
      const transport = targetUrl.protocol === 'https:' ? https : http;
      const req = transport.request(targetUrl, {
        method: 'GET',
        rejectUnauthorized: false,
        timeout: 2000
      }, (resp) => {
        stalwartStatus = (resp.statusCode && resp.statusCode < 500) ? 'reachable' : 'unhealthy';
        resolve();
      });
      req.on('error', () => {
        stalwartStatus = 'unreachable';
        resolve();
      });
      req.on('timeout', () => {
        req.destroy();
        stalwartStatus = 'timeout';
        resolve();
      });
      req.end();
    });
  } catch {
    stalwartStatus = 'unreachable';
  }

  const isHealthy = dbStatus === 'healthy';
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'error',
    timestamp: new Date().toISOString(),
    services: {
      database: dbStatus,
      stalwart: stalwartStatus,
    }
  });
});

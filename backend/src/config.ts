import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.VITEST === 'true' ? 'test' : (process.env.NODE_ENV || 'development'),
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/toowix_mail',
  jwtSecret: process.env.JWT_SECRET || 'toowix_default_jwt_secret_dev_only_32_bytes',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  stalwart: {
    url: process.env.STALWART_URL || 'http://localhost:8090',
    user: process.env.STALWART_USER || 'toowix-service@toowix.test',
    password: process.env.STALWART_PASSWORD || 'ToowixServiceSecret2026!Secure',
    accountId: process.env.STALWART_ACCOUNT_ID || 'b'
  },
  tenantAdminUrl: process.env.TENANT_ADMIN_URL || 'http://localhost:5174',
  smtp: {
    host: process.env.SMTP_HOST || '127.0.0.1',
    port: parseInt(process.env.SMTP_PORT || '2525', 10),
    secure: process.env.SMTP_SECURE === 'true',
    // Support both legacy and the .env variable names you added
    user: process.env.SMTP_USER || process.env.SMTP_USERNAME || process.env.SMTP_USER_EMAIL || '',
    password: process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '"Toowix Mail Platform" <noreply@toowix.com>',
  },
};

import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'backend/vitest.config.ts',
  'apps/super-admin/vitest.config.ts',
  'apps/tenant-admin/vitest.config.ts',
]);

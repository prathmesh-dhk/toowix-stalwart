import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'backend/src/**/*.ts',
        'apps/super-admin/src/**/*.{ts,tsx}',
        'apps/tenant-admin/src/**/*.{ts,tsx}',
      ],
      exclude: [
        '**/dist/**',
        '**/node_modules/**',
        '**/tests/**',
        '**/*.test.*',
        '**/*.d.ts',
        'deploy/**',
        'scripts/**',
        'backend/src/scripts/**',
        'backend/src/db/migrate.ts',
        'backend/src/db/seed.ts',
        'backend/src/db/local-mongo.ts',
        'backend/src/index.ts',
        'apps/**/src/main.tsx',
      ],
    },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'backend',
    environment: 'node',
    globals: true,
    testTimeout: 20000,
    hookTimeout: 20000,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/scripts/**',
        'src/db/migrate.ts',
        'src/db/seed.ts',
        'src/db/local-mongo.ts',
        'src/index.ts',
      ],
    },
  },
});

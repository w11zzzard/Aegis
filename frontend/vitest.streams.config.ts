import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['integration/http-streams.test.ts'], testTimeout: 5000, hookTimeout: 5000 },
});

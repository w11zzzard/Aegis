import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], include: ['src/**/*.test.{ts,tsx}'],
    coverage: { provider: 'v8', include: ['src/api.ts', 'src/adapter.ts', 'src/schemas.ts', 'src/SummaryPanels.tsx', 'src/App.tsx', 'src/components.tsx', 'src/scenarios.ts'], thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 } }
  }
});

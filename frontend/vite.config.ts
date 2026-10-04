import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' };
  const apiOrigin = /^https?:\/\//.test(env.VITE_API_BASE_URL || '') ? new URL(env.VITE_API_BASE_URL).origin : '';
  return {
    plugins: [react()],
    // Emit same-origin assets so the strict preview CSP never needs data: fonts.
    build: { assetsInlineLimit: 0 },
    server: { headers, proxy: { '/api': { target: env.AEGIS_BACKEND_URL || 'http://127.0.0.1:8000', changeOrigin: true } } },
    preview: { headers: { ...headers, 'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self' ${apiOrigin}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'` } },
  };
});

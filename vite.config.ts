import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

// (22 Oct 2026, security review) Content Security Policy for the published site only (the dev server needs inline
// scripts for hot reload): only this site and the Supabase server can be reached (fonts now ship with the app); no inline/foreign scripts.
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:", "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.telegram.org", "worker-src 'self' blob:", "object-src 'none'",
  "base-uri 'self'", "form-action 'self'",
].join('; ');
const cspPlugin = (): Plugin => ({
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss(), cspPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      target: 'esnext',
      cssCodeSplit: true,
      chunkSizeWarningLimit: 1000,
      modulePreload: {
        resolveDependencies: (_filename, deps) => {
          // Keep heavy vendor-charts on-demand so initial entry avoids downloading the 401kB Recharts bundle upfront
          return deps.filter((dep) => !dep.includes('vendor-charts'));
        },
      },
      rolldownOptions: {
        output: {
          // (03 Nov 2026, audit) Replaces the old manualChunks function. With Rolldown (Vite 8), a group also takes in
          // the dependencies of what it captures, so the charts group pulled React itself (and react-dom, react-is,
          // clsx, use-sync-external-store) into vendor-charts, and the motion group took react/jsx-runtime. The entry
          // then had to import React from vendor-charts: the 399 kB Recharts chunk was downloaded on the sign-in screen
          // even though its preload hint was removed. React now has the highest priority, so it is captured first and
          // every heavy library stays in its own on-demand chunk.
          codeSplitting: {
            groups: [
              { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler|react-is|use-sync-external-store)[\\/]/, priority: 50 },
              { name: 'vendor-charts', test: /node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|internmap|decimal\.js-light|es-toolkit|redux|redux-thunk|@reduxjs|react-redux|reselect|immer|eventemitter3|tiny-invariant)[\\/]/, priority: 40 },
              { name: 'vendor-motion', test: /node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/, priority: 30 },
              { name: 'vendor-icons', test: /node_modules[\\/]lucide-react[\\/]/, priority: 20 },
              { name: 'vendor-libs', test: /node_modules[\\/]/, priority: 10 },
            ],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

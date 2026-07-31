import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// The companion relay + optional catalog proxy live in `server/` (default port 8787).
// In dev we proxy `/api/*` there so the browser talks to one origin (matches production).
const API_TARGET = process.env.VITE_SERVER_TARGET ?? "http://localhost:8787";

// Base public path. Root by default (Vercel/Netlify/local); set VITE_BASE to the
// repo subpath for GitHub Pages, e.g. "/cardlens/".
const BASE = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base: BASE,
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Keep the vendor runtime in its own cacheable chunk; app code stays lean.
          vendor: ["react", "react-dom", "@tanstack/react-query"],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    // server/ was omitted, so server/sessionStore.test.ts has never actually
    // run despite existing. The server holds the collection now, so its tests
    // have to be part of `npm run verify`.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "server/**/*.{test,spec}.ts"],
    exclude: ["e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/test/**", "src/**/fixtures.ts"],
    },
  },
});

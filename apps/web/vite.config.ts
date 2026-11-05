import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
const engine = process.env.ENGINE_URL ?? "http://localhost:8787";
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { main: resolve(root, "index.html"), pay: resolve(root, "pay-x7k2/index.html") } } },
  server: { port: 5173, proxy: { "/api/lastspawn/ws": { target: engine, ws: true }, "/api": engine, "/.well-known": engine, "/buy": engine, "/sites": engine, "/files": engine } },
});

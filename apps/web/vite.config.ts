import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const engine = process.env.ENGINE_URL ?? "http://localhost:8787";
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": engine, "/buy": engine, "/sites": engine, "/files": engine } },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:27181",
        timeout: 300_000,
        proxyTimeout: 300_000,
      },
    },
  },
  build: {
    outDir: fileURLToPath(new URL("../dist/web", import.meta.url)),
    emptyOutDir: true,
  },
});

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = process.env["PORT"] ?? "3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist/web", emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": `http://localhost:${apiPort}` },
  },
});

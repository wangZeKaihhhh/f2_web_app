import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const backendPort = process.env.BACKEND_PORT ?? "8001";
const backendHost = process.env.BACKEND_HOST ?? "127.0.0.1";
const backendHttpTarget = `http://${backendHost}:${backendPort}`;
const backendWsTarget = `ws://${backendHost}:${backendPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": backendHttpTarget,
      "/ws": {
        target: backendWsTarget,
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

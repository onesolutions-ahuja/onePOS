import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],

  // The marketing site and operational application deliberately have
  // independent HTML entry points. This lets Express serve the public site at
  // / while /login and /app continue to load the existing application shell.
  build: {
    rollupOptions: {
      input: {
        marketing: resolve(__dirname, "index.html"),
        app: resolve(__dirname, "app/index.html"),
      },
    },
  },

  preview: {
    host: "0.0.0.0",
    port: process.env.PORT || 4173,
    allowedHosts: true,
  },

  server: {
    host: "0.0.0.0",
    allowedHosts: true,
proxy: {
      "/api": {
        target: "http://localhost:10000",
        changeOrigin: true,
      },
    },
  

  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

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

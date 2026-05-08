import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  base: "/dashboard-app/",
  plugins: [react()],
  build: {
    outDir: "../public/dashboard-app",
    emptyOutDir: true
  },
  server: {
    port: 5173
  }
});

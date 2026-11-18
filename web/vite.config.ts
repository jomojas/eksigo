import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// eksigo.com: static pages. The build goes to ../site, which the deploy job copies to the VPS.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../site",
    emptyOutDir: false,
    rollupOptions: {
      input: { index: "index.html", privacy: "privacy.html", terms: "terms.html", support: "support.html" },
    },
  },
});

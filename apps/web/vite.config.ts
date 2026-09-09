import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs, because the bundle is served from a random local port by
  // `workledger serve` and, later, from a path an iframe host chooses (design spec §14.2).
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    // Nothing may reach for a CDN or a web font, so the whole shell has to be in dist/.
    assetsInlineLimit: 4096,
    sourcemap: true,
  },
});

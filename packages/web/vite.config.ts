import { defineConfig } from "vite";

// `base` must match the path where the site is served. On GitHub Pages
// this is `/<repo>/`; locally it is `/`. Set via VITE_BASE env var in CI.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  server: { port: 5173 },
  build: { target: "es2022", sourcemap: true },
});

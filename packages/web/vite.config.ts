import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// `base` must match the path where the site is served. On GitHub Pages
// this is `/<repo>/`; locally it is `/`. Set via VITE_BASE env var in CI.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  define: {
    // App/product version, shown in the "About" section.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: { port: 5173 },
  build: { target: "es2022", sourcemap: true },
});

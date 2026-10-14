import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// `pnpm build` (second step) → dist/csm-features.mjs: the command-line feature extractor as one
// self-contained ES module (calculation code and reference data inlined; needs only Node.js).
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  define: { __CSM_VERSION__: JSON.stringify(version) },
  publicDir: false,
  ssr: { noExternal: true, target: "node" },
  build: {
    ssr: "src/cli/csm-features.ts",
    outDir: "dist",
    emptyOutDir: false, // keep dist/index.html from the app build
    target: "node20",
    minify: true,
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "csm-features.mjs",
        banner: "#!/usr/bin/env node",
        inlineDynamicImports: true,
      },
    },
  },
});

import { chmodSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite-plus";
import { thirdPartyNotices } from "./vite.licenses";

// `pnpm build` (second step) → dist/csm-features.mjs: the command-line feature extractor as one
// self-contained ES module (calculation code and reference data inlined; needs only Node.js).
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// The shebang only helps when the file is executable; a rebuilt file is created without the bit (#64).
// Runs after the notices plugin, which rewrites the file in place.
const executable = (file: string): Plugin => ({
  name: "executable",
  apply: "build",
  writeBundle(o) {
    chmodSync(resolve(o.dir ?? "dist", file), 0o755);
  },
});

export default defineConfig({
  define: { __CSM_VERSION__: JSON.stringify(version) },
  publicDir: false,
  // notices after the shebang; every bundled package must also be listed by the app build
  plugins: [thirdPartyNotices({ subsetOf: "THIRD_PARTY_LICENSES.txt" }), executable("csm-features.mjs")],
  ssr: { noExternal: true, target: "node" },
  build: {
    ssr: "src/cli/csm-features.ts",
    outDir: "dist",
    emptyOutDir: false, // keep dist/index.html from the app build
    target: "node26",
    minify: true,
    rolldownOptions: {
      output: {
        format: "es",
        entryFileNames: "csm-features.mjs",
        banner: "#!/usr/bin/env node",
        codeSplitting: false,
      },
    },
  },
});

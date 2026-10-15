import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { thirdPartyNotices } from "./vite.licenses";

// `pnpm build` → dist/index.html: one self-contained file (JS, CSS and data inlined), with the
// third-party notices in a comment at the top and in dist/THIRD_PARTY_LICENSES.txt.
export default defineConfig({
  base: "./",
  plugins: [react(), viteSingleFile(), thirdPartyNotices({ listFile: "THIRD_PARTY_LICENSES.txt" })],
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 4000,
  },
});

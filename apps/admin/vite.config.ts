/// <reference types="vitest" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// TER-520: shared source lives in packages/shared (repo root, outside this app's
// root dir). Vite does not read tsconfig `paths`, so map the package to its
// source explicitly — mirroring the consumer's root vite.config.ts.
const sharedSrc = fileURLToPath(new URL("../../packages/shared/src", import.meta.url));
const localSrc = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@terenc/shared": sharedSrc,
      "@": localSrc,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

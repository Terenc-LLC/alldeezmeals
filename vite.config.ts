/// <reference types="vitest" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// TER-506: shared source lives in packages/shared (npm workspace, no build step).
// Vite does not read tsconfig `paths`, so map the package to its source explicitly.
const sharedSrc = fileURLToPath(new URL("./packages/shared/src", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@terenc/shared": sharedSrc,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "packages/**/*.test.ts"],
  },
});

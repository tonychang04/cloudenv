import { defineConfig } from "vitest/config";

export default defineConfig({
  css: {
    postcss: {},
  },
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["test/tiling/**/*.test.ts"],
  },
});

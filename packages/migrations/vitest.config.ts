import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    slowTestThreshold: 1000,
    reporters: process.env.CI ? ["default", "json"] : ["default"],
    outputFile: { json: "../../coverage/slow-tests/packages/migrations/slow-tests.json" },
    include: ["src/**/tests/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

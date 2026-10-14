import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/tests/*.test.ts"],
    env: { DATABASE_URL: "", APP_ORIGIN: "", AUTH_ISSUER: "", AUTH_AUDIENCE: "" },
  },
});

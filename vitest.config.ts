import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/config/**/*.ts",
        "src/domain/**/*.ts",
        "src/infrastructure/clock/**/*.ts",
        "src/infrastructure/database/in-memory-repository.ts",
        "src/infrastructure/database/sqlite.ts",
        "src/infrastructure/filesystem/**/*.ts",
        "src/mcp/**/*.ts",
      ],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
        statements: 90,
      },
    },
  },
});

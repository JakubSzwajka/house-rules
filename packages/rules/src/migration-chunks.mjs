// Mirror packages/migrations/src/migration/migration-files.ts.
export const migrationChunks = (text) =>
  text
    .split(/^--> statement-breakpoint[ \t]*$/m)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { MigrationsTesting } from "@house-rules/migrations";
import { Effect, FileSystem, Layer } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { CallAudit } from "../../index.ts";

const world = Layer.merge(
  NodeServices.layer,
  MigrationsTesting.database({ label: "audit_upgrade", client: (url) => PgClient.layer({ url }) }),
);
const apply = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const sql = yield* SqlClient;
    const text = yield* fs.readFileString(
      new URL(`../../../migrations/${name}`, import.meta.url).pathname,
    );
    for (const statement of text.split("--> statement-breakpoint")) yield* sql.unsafe(statement);
  });

layer(world, { excludeTestServices: true, timeout: "30 seconds" })("audit target upgrade", (it) => {
  it.effect("0003 backfills old rows from capability and requires target on new rows", () =>
    Effect.gen(function* () {
      yield* apply("0001_call_audit.sql");
      yield* apply("0002_call_audit_policy.sql");
      const sql = yield* SqlClient;
      yield* sql`insert into call_audit (capability, permission, outcome, ms) values ('old_entry', 'old:read', 'Forbidden', 7)`;
      yield* apply("0003_call_audit_target.sql");
      expect(yield* CallAudit.readRows()).toMatchObject([
        {
          capability: "old_entry",
          target: "old_entry",
          permission: "old:read",
          outcome: "Forbidden",
          ms: 7,
        },
      ]);
      const missing =
        yield* sql`insert into call_audit (capability, permission, outcome, ms) values ('missing_target', '', 'success', 1)`.pipe(
          Effect.exit,
        );
      expect(missing._tag).toBe("Failure");
      yield* sql`insert into call_audit (capability, target, permission, outcome, ms) values ('entry', 'explicit_target', '', 'success', 1)`;
      expect((yield* CallAudit.readRows())[0]).toMatchObject({
        capability: "entry",
        target: "explicit_target",
      });
    }),
  );
});

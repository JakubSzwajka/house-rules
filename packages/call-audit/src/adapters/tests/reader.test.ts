import { assert, it } from "@effect/vitest";
import { Context, DateTime, Effect, Layer } from "effect";
import {
  AuditReader,
  AuditStore,
  CallAudit,
  memoryAuditLog,
  postgresAuditStore,
  memoryAuditStore,
} from "../../index.ts";
import { migratedDatabase } from "./stores.ts";
for (const storage of ["memory", "postgres"] as const) {
  it.live(
    `${storage}: captured reader has no SQL requirement and filters A/B rows before limiting`,
    () =>
      Effect.gen(function* () {
        const log = memoryAuditLog();
        const world =
          storage === "memory"
            ? Layer.merge(CallAudit.reader.memory(log), memoryAuditStore())
            : Layer.merge(CallAudit.reader.postgres, postgresAuditStore).pipe(
                Layer.provideMerge(migratedDatabase("audit_reader")),
              );
        const context = yield* Layer.build(world);
        for (const viewerId of ["alice", "bob", "alice"]) {
          const row = {
            capability: "example",
            target: "example",
            permission: "audit:read",
            viewerId,
            outcome: "success",
            ms: 1,
          };
          if (storage === "memory") yield* log.record(row);
          else
            yield* Context.get(context, AuditStore).record({
              ...row,
              recordedAt: DateTime.toDateUtc(yield* DateTime.now),
            });
        }
        const reader = Context.get(context, AuditReader);
        const rows = yield* reader.readRows({ viewerId: "alice", limit: 1 });
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0]?.viewerId, "alice");
        assert.strictEqual((yield* reader.readRows({ viewerId: "bob" })).length, 1);
        assert.deepStrictEqual(yield* reader.readRows({ viewerId: "nobody" }), []);
      }).pipe(Effect.scoped),
    30_000,
  );
}

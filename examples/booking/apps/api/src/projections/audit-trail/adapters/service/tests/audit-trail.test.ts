import { assert, it } from "@effect/vitest";
import { AuditReader, CallAudit, memoryAuditLog } from "@house-rules/call-audit";
import { Effect, Layer } from "effect";
import { AuditTrail } from "../../../storage.ts";
import { auditTrailReader } from "../audit-trail.ts";

it.effect(
  "maps stored timestamp and nullable actor without changing private activity filtering",
  () =>
    Effect.gen(function* () {
      const log = memoryAuditLog();
      for (const viewerId of [null, "alice", "bob"])
        yield* log.record({
          capability: "example",
          target: "example",
          permission: "",
          viewerId,
          outcome: "success",
          ms: 1,
          requestId: viewerId,
        });
      const layer = auditTrailReader.pipe(Layer.provideMerge(CallAudit.reader.memory(log)));
      yield* Effect.gen(function* () {
        const source = yield* (yield* AuditReader).readRows();
        const audit = yield* AuditTrail;
        const recent = yield* audit.recent();
        assert.deepStrictEqual(
          recent,
          source.map((row) => ({
            at: row.recordedAt.getTime(),
            who: row.viewerId,
            feature: row.target,
            outcome: row.outcome,
            requestId: row.requestId ?? null,
            ms: row.ms,
            kind: row.kind ?? null,
          })),
        );
        assert.isTrue(recent.some((row) => row.who === null));
        assert.deepStrictEqual(
          yield* audit.mine("alice"),
          recent.filter((row) => row.who === "alice"),
        );
      }).pipe(Effect.provide(layer));
    }),
);

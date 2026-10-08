import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { type AuditRow, CallAudit, memoryAuditStore } from "../index.ts";
import { seed, who } from "./audit-fixtures.ts";
import { AuditStore } from "../index.ts";

const retained = (rows: Array<AuditRow>) =>
  CallAudit.layer({
    who,
    policy: CallAudit.presets.minimal,
    retention: { interval: "10 minutes" },
  }).pipe(Layer.provide(memoryAuditStore(rows)));

it.effect("retention stops when the layer scope closes", () =>
  Effect.gen(function* stopsWithScope() {
    const rows: Array<AuditRow> = [];
    const store = memoryAuditStore(rows);
    yield* Effect.scoped(
      Effect.gen(function* running() {
        yield* Layer.build(retained(rows));
        yield* TestClock.adjust("1 millis");
      }),
    );
    yield* seed({ capability: "expired_after_close" }, 100).pipe(Effect.provide(store));
    yield* TestClock.adjust("3 hours");
    expect(rows.map((row) => row.capability)).toEqual(["expired_after_close"]);
  }),
);

it.effect("retention keeps running while the layer scope is open", () =>
  Effect.gen(function* runsWhileOpen() {
    const rows: Array<AuditRow> = [];
    yield* Effect.scoped(
      Effect.gen(function* running() {
        yield* Layer.build(retained(rows));
        yield* TestClock.adjust("1 millis");
        yield* seed({ capability: "expired_while_open" }, 100).pipe(
          Effect.provide(memoryAuditStore(rows)),
        );
        yield* TestClock.adjust("10 minutes");
        expect(rows).toEqual([]);
      }),
    );
    expect(
      yield* AuditStore.use((store) => store.read()).pipe(Effect.provide(memoryAuditStore(rows))),
    ).toEqual([]);
  }),
);

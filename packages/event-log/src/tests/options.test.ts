import { expect, it } from "@effect/vitest";
import { memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { EventInputInvalid, EventLog, type EventLogOptions } from "../index.js";
const registry = { changed: Schema.Struct({ count: Schema.FiniteFromString }) };
it.effect("keeps no built-in kinds and validates every consumer registration", () =>
  Effect.gen(function* () {
    for (const consumers of [
      [{ name: "x", kinds: ["unknown"] }],
      [
        { name: "x", kinds: ["changed"] },
        { name: "x", kinds: ["changed"] },
      ],
      [{ name: "x", kinds: [] }],
      [{ name: "x", kinds: ["changed"], maxAttempts: 0 }],
      [{ name: "x", kinds: ["changed"], backoff: { baseMs: 20, capMs: 10 } }],
    ] satisfies ReadonlyArray<EventLogOptions["consumers"]>) {
      expect(
        yield* Effect.flip(
          EventLog.pipe(
            Effect.asVoid,
            Effect.provide(EventLog.layerMemory({ registry, consumers })),
          ),
        ),
      ).toBeInstanceOf(EventInputInvalid);
    }
    expect(EventLog.presets.default).toEqual({
      maxAttempts: 5,
      backoff: { baseMs: 1000, capMs: 300000 },
    });
  }),
);
it.effect("decodes payload codecs, stores their JSON encoding and decodes on history reads", () =>
  Effect.gen(function* () {
    const log = yield* EventLog;
    const event = yield* UnitOfWork.atomic(
      log.record(null, {
        kind: "changed",
        subject: { kind: "task", id: "t" },
        scopeId: null,
        payload: { count: "42" },
      }),
    );
    expect(event.payload).toEqual({ count: 42 });
    expect((yield* log.read())[0]?.payload).toEqual({ count: 42 });
  }).pipe(
    Effect.provide(
      EventLog.layerMemory({ registry, consumers: [] }).pipe(Layer.provideMerge(memoryUnitOfWork)),
    ),
  ),
);

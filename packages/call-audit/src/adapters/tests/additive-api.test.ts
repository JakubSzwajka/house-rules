import { expect, layer } from "@effect/vitest";
import { CallWatch, defineEntry } from "@house-rules/application";
import { DateTime, Effect, Layer, Schema } from "effect";
import { type AuditEntry, type AuditRow, AuditStore, CallAudit } from "../../index.ts";
import { who } from "../../tests/audit-fixtures.ts";
import { memoryStore, postgresStore, type StoreUnderTest } from "./stores.ts";

const ping = defineEntry({
  name: "ping",
  description: "Answer pong.",
  input: Schema.Struct({}),
  output: Schema.String,
  failure: Schema.Never,
  permission: null,
  edges: [],
  readOnly: false,
  destructive: false,
  transactional: false,
  needsApproval: false,
});

const entryWithoutFacts: AuditEntry = {
  capability: "old",
  target: "old",
  permission: "public",
  viewerId: "user_ana",
  outcome: "success",
  ms: 3,
};

const suite = <R, E, E2>({ name, world, fresh }: StoreUnderTest<R, E, E2>) => {
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `additive API on the ${name} store`,
    (it) => {
      it.effect("a 3-argument around call records a row with default facts", () =>
        Effect.gen(function* oldCall() {
          const watch = yield* CallWatch;
          const out = yield* watch.around(ping, {}, Effect.succeed("ok"));
          expect(out).toBe("ok");
          const rows = yield* AuditStore.use((store) => store.read());
          expect(rows).toMatchObject([
            {
              capability: "ping",
              target: "ping",
              kind: "write",
              targetId: null,
              channel: "unknown",
              requestId: null,
            },
          ]);
        }).pipe(
          Effect.provide(
            CallAudit.layer({ who, policy: CallAudit.presets.strict }).pipe(
              Layer.provideMerge(fresh()),
            ),
          ),
        ),
      );

      it.effect("an entry and row without optional facts retain the required target", () =>
        Effect.gen(function* oldShape() {
          const oldRow: AuditRow = {
            ...entryWithoutFacts,
            recordedAt: DateTime.toDateUtc(yield* DateTime.now),
          };
          yield* AuditStore.use((store) => store.record(oldRow));
          const rows = yield* AuditStore.use((store) => store.read());
          expect(rows).toMatchObject([{ capability: "old", viewerId: "user_ana", targetId: null }]);
        }).pipe(Effect.provide(fresh())),
      );
    },
  );
};

suite(postgresStore);
suite(memoryStore);

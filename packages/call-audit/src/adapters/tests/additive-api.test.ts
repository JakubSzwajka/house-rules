import { expect, layer } from "@effect/vitest";
import { CallWatch, defineContract, implement } from "@house-rules/capability";
import { DateTime, Effect, Layer, Schema } from "effect";
import { type AuditEntry, type AuditRow, AuditStore, CallAudit } from "../../index.ts";
import { who } from "../../tests/audit-fixtures.ts";
import { memoryStore, postgresStore, type StoreUnderTest } from "./stores.ts";

const ping = implement(
  defineContract("ping", {
    description: "Answer pong.",
    input: Schema.Struct({}),
    output: Schema.String,
    failure: Schema.Never,
    permission: "public",
  }),
  () => Effect.succeed("pong"),
);

const entryWithoutFacts: AuditEntry = {
  capability: "old",
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
          const out = yield* watch.around(ping.contract, {}, Effect.succeed("ok"));
          expect(out).toBe("ok");
          const rows = yield* AuditStore.use((store) => store.read());
          expect(rows).toMatchObject([
            {
              capability: "ping",
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

      it.effect("an old-shape entry and row literal are stored and read back", () =>
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

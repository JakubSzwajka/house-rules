import { expect, layer } from "@effect/vitest";
import { Effect, Layer, Schedule } from "effect";
import { type AuditPolicy, CallAudit } from "../../index.ts";
import {
  allRows,
  asViewer,
  capabilitiesOf,
  inRequest,
  onWeb,
  overMcp,
  perClassPolicy,
  readTrip,
  renameTrip,
  secret,
  seed,
  who,
} from "../../tests/audit-fixtures.ts";
import { memoryStore, postgresStore, type StoreUnderTest } from "./stores.ts";

const trip = { tripId: "t-1", title: secret };
const missing = { tripId: "missing", title: secret };

const everyKindOfCall = Effect.all(
  [
    onWeb(readTrip.handler(trip)).pipe(Effect.map(() => "read on web")),
    overMcp(readTrip.handler(trip)).pipe(Effect.map(() => "read over mcp")),
    onWeb(renameTrip.handler(trip)).pipe(Effect.map(() => "write on web")),
    onWeb(readTrip.handler(missing)).pipe(
      Effect.flip,
      Effect.map(() => "failed read"),
    ),
  ],
  { discard: true },
);

const kept = (
  rows: ReadonlyArray<{
    capability: string;
    kind?: string | null | undefined;
    outcome: string;
    channel?: string | null | undefined;
  }>,
) =>
  rows
    .map((row) =>
      row.outcome !== "success"
        ? "failed read"
        : row.kind === "write"
          ? "write on web"
          : row.channel === "web"
            ? "read on web"
            : "read over mcp",
    )
    .sort();

const presetCases: ReadonlyArray<readonly [string, AuditPolicy, ReadonlyArray<string>]> = [
  ["minimal", CallAudit.presets.minimal, ["failed read", "write on web"]],
  ["agentAware", CallAudit.presets.agentAware, ["failed read", "read over mcp", "write on web"]],
  [
    "strict",
    CallAudit.presets.strict,
    ["failed read", "read on web", "read over mcp", "write on web"],
  ],
];

const suite = <R, E, E2>(store: StoreUnderTest<R, E, E2>) => {
  layer(store.world, { excludeTestServices: true, timeout: "30 seconds" })(
    `AuditStore on ${store.name}`,
    (it) => {
      for (const [name, policy, expected] of presetCases) {
        it.effect(`the ${name} preset keeps ${expected.join(", ")}`, () =>
          Effect.gen(function* presetKeeps() {
            yield* everyKindOfCall.pipe(
              asViewer("user_ana"),
              Effect.provide(CallAudit.layer({ who, policy })),
            );
            expect(kept(yield* allRows)).toEqual(expected);
          }).pipe(Effect.provide(store.fresh())),
        );
      }

      it.effect("records target, channel, request id and kind, and no value or message", () =>
        Effect.gen(function* recordsFacts() {
          const audit = CallAudit.layer({ who, policy: CallAudit.presets.strict });
          yield* onWeb(renameTrip.handler(trip)).pipe(
            inRequest("req-1"),
            asViewer("user_ana"),
            Effect.provide(audit),
          );
          yield* overMcp(readTrip.handler(missing)).pipe(
            asViewer("user_ana"),
            Effect.provide(audit),
            Effect.flip,
          );
          const rows = yield* allRows;
          expect(rows).toMatchObject([
            {
              capability: "read_trip",
              viewerId: "user_ana",
              outcome: "TripNotFound",
              kind: "read",
              targetId: "missing",
              channel: "mcp:test-client",
              requestId: null,
            },
            {
              capability: "rename_trip",
              viewerId: "user_ana",
              outcome: "success",
              kind: "write",
              targetId: "t-1",
              channel: "web",
              requestId: "req-1",
            },
          ]);
          expect(JSON.stringify(rows)).not.toContain(secret);
          expect(JSON.stringify(rows)).not.toContain("No trip called");
        }).pipe(Effect.provide(store.fresh())),
      );

      it.effect("retention deletes only the rows past their class window", () =>
        Effect.gen(function* retentionPerClass() {
          for (const age of [0.5, 2, 15, 40]) {
            yield* seed({ capability: `read_${age}`, kind: "read" }, age);
            yield* seed({ capability: `write_${age}`, kind: "write" }, age);
            yield* seed({ capability: `failure_${age}`, kind: "read", outcome: "Forbidden" }, age);
          }
          yield* seed({ capability: "legacy_write_15", kind: null, channel: null }, 15);
          const run = yield* CallAudit.runRetention(perClassPolicy(CallAudit.presets.strict), {
            batchSize: 2,
          });
          expect(run).toEqual({ ran: true, deleted: { read: 3, write: 3, failure: 1 } });
          expect(capabilitiesOf(yield* allRows)).toEqual([
            "failure_0.5",
            "failure_15",
            "failure_2",
            "read_0.5",
            "write_0.5",
            "write_2",
          ]);
        }).pipe(Effect.provide(store.fresh())),
      );

      it.effect("a class with an infinite window is never deleted", () =>
        Effect.gen(function* keepForever() {
          yield* seed({ capability: "old_read", kind: "read" }, 4000);
          yield* seed({ capability: "old_write", kind: "write" }, 4000);
          const policy = {
            ...CallAudit.presets.strict,
            retention: { read: "Infinity", write: "1 day", failure: "1 day" },
          } as const;
          const run = yield* CallAudit.runRetention(policy);
          expect(run.deleted).toEqual({ read: 0, write: 1, failure: 0 });
          expect(capabilitiesOf(yield* allRows)).toEqual(["old_read"]);
        }).pipe(Effect.provide(store.fresh())),
      );

      it.effect("erase removes one viewer's rows and no one else's", () =>
        Effect.gen(function* erasesOne() {
          yield* seed({ capability: "ana_1", viewerId: "user_ana" }, 1);
          yield* seed({ capability: "ana_2", viewerId: "user_ana", kind: "read" }, 400);
          yield* seed({ capability: "bo_1", viewerId: "user_bo" }, 1);
          yield* seed({ capability: "nobody_1", viewerId: null }, 1);
          expect(yield* CallAudit.erase("user_ana")).toBe(2);
          expect(capabilitiesOf(yield* allRows)).toEqual(["bo_1", "nobody_1"]);
          expect(yield* CallAudit.erase("user_ana")).toBe(0);
        }).pipe(Effect.provide(store.fresh())),
      );

      it.effect("two concurrent retention runs do not both delete", () =>
        Effect.gen(function* oneRunAtATime() {
          for (let index = 0; index < 60; index += 1) {
            yield* seed({ capability: `old_${index}` }, 100);
          }
          const policy = CallAudit.presets.minimal;
          const runs = yield* Effect.all(
            [
              CallAudit.runRetention(policy, { batchSize: 1 }),
              CallAudit.runRetention(policy, { batchSize: 1 }),
            ],
            { concurrency: 2 },
          );
          expect(runs.map((run) => run.ran).sort()).toEqual([false, true]);
          expect(runs.map((run) => run.deleted.write).sort((a, b) => a - b)).toEqual([0, 60]);
          expect(yield* allRows).toEqual([]);
          expect((yield* CallAudit.runRetention(policy)).ran).toBe(true);
        }).pipe(Effect.provide(store.fresh())),
      );

      it.effect("the layer runs retention when it starts", () =>
        Effect.gen(function* retentionOnStart() {
          yield* seed({ capability: "expired" }, 100);
          yield* seed({ capability: "fresh" }, 1);
          yield* Effect.scoped(
            Layer.build(CallAudit.layer({ who, policy: CallAudit.presets.minimal })).pipe(
              Effect.andThen(
                Effect.repeat(allRows, {
                  schedule: Schedule.spaced("10 millis"),
                  until: (rows) => rows.length === 1,
                  times: 500,
                }),
              ),
            ),
          );
          expect(capabilitiesOf(yield* allRows)).toEqual(["fresh"]);
        }).pipe(Effect.provide(Layer.fresh(store.fresh()))),
      );
    },
  );
};

suite(postgresStore);
suite(memoryStore);

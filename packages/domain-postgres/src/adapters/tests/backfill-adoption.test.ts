import * as Domain from "@alchemy.run/domain";
import * as Pg from "@effect/sql-pg/PgClient";
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { PgForTests, testSchema } from "../from-env.ts";
import { layer } from "../postgres-platform.ts";
import { drained, Mark, Marks, seed, world } from "./backfill-fixture.ts";

const historyOnly = (schema: string) => {
  class Backfilled extends Domain.Model("Backfilled", { aggregates: [Marks] }) {}
  expect(Domain.verify(Backfilled)).toEqual([]);
  return Effect.gen(function* () {
    const marks = yield* Marks;
    yield* marks.send("untouched", new Mark({ value: "old" }));
    yield* drained(schema);
  }).pipe(
    Effect.scoped,
    Effect.provide(Backfilled.layer(Layer.empty).pipe(Layer.provide(layer({ schema })))),
  );
};

describe.skipIf(process.env["DOMAIN_STORE"] === "memory")("legacy eager view adoption", () => {
  it.live(
    "preserves a legacy generation zero snapshot and entries with touched and untouched streams",
    () =>
      Effect.gen(function* () {
        const schema = yield* testSchema;
        const sql = yield* Pg.PgClient;
        yield* historyOnly(schema);
        const legacy = world(schema, 0, [], (kit) => ({
          ...kit,
          history: () => Effect.succeed([]),
        }));
        yield* Effect.gen(function* () {
          const marks = yield* Marks;
          yield* marks.send("touched", new Mark({ value: "live" }));
          yield* drained(schema);
        }).pipe(Effect.scoped, Effect.provide(legacy.live));
        yield* sql`DELETE FROM ${sql(`${schema}.backfills`)}`;
        yield* sql`UPDATE ${sql(`${schema}.views`)} SET catch_up = NULL`;
        const snapshots =
          yield* sql`SELECT view, key, snapshot FROM ${sql(`${schema}.view_keys`)} ORDER BY view, key`;
        const entries =
          yield* sql`SELECT view, key, seq, entry FROM ${sql(`${schema}.view_entries`)} ORDER BY view, key, seq`;
        expect(snapshots).toHaveLength(3);
        expect(entries).toHaveLength(3);
        const restarted = world(schema, 0, []);
        yield* Effect.gen(function* () {
          const collected = yield* restarted.Collected;
          expect((yield* collected.snapshot("all")).state).toEqual(["0:live"]);
          expect((yield* collected.list("all")).entries.map((entry) => entry.event.value)).toEqual([
            "live",
          ]);
          expect(yield* collected.history).toEqual({ complete: true });
        }).pipe(Effect.scoped, Effect.provide(restarted.live));
        expect(
          yield* sql`SELECT view, key, snapshot FROM ${sql(`${schema}.view_keys`)} ORDER BY view, key`,
        ).toEqual(snapshots);
        expect(
          yield* sql`SELECT view, key, seq, entry FROM ${sql(`${schema}.view_entries`)} ORDER BY view, key, seq`,
        ).toEqual(entries);
        expect(
          yield* sql`SELECT complete, cursor, routed FROM ${sql(`${schema}.backfills`)} ORDER BY target`,
        ).toEqual([
          { complete: true, cursor: null, routed: 0n },
          { complete: true, cursor: null, routed: 0n },
          { complete: true, cursor: null, routed: 0n },
        ]);
      }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live("replays a brand-new generation zero eager view against existing history", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      yield* historyOnly(schema);
      const added = world(schema, 0, []);
      yield* Effect.gen(function* () {
        const collected = yield* added.Collected;
        expect((yield* collected.snapshot("all")).state).toEqual(["0:old"]);
        expect((yield* collected.list("all")).entries.map((entry) => entry.event.value)).toEqual([
          "old",
        ]);
      }).pipe(Effect.scoped, Effect.provide(added.live));
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live.each(["new", "bumped"] as const)(
    "persists %s replay intent before startup can crash",
    (kind) =>
      Effect.gen(function* () {
        const schema = yield* testSchema;
        const sql = yield* Pg.PgClient;
        if (kind === "new") yield* historyOnly(schema);
        else yield* seed(schema, 4);
        const version = kind === "new" ? 0 : 2;
        const broken = world(schema, version, [], undefined, undefined, {
          host: (host) => ({ ...host, start: () => Effect.die("crash before replay") }),
        });
        const crashed = yield* Layer.build(broken.live).pipe(Effect.scoped, Effect.exit);
        expect(
          Exit.isFailure(crashed)
            ? crashed.cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect)
            : [],
        ).toEqual(["crash before replay"]);
        const intent =
          yield* sql`SELECT plan, complete, cursor, routed FROM ${sql(`${schema}.backfills`)}
        WHERE target = ${`view:Collected${version === 0 ? "" : `#${version}`}`}`;
        expect(intent).toEqual([{ plan: null, complete: false, cursor: null, routed: 0n }]);
        const resumed = world(schema, version, []);
        yield* Effect.gen(function* () {
          const collected = yield* resumed.Collected;
          expect((yield* collected.snapshot("all")).state).toEqual(
            kind === "new" ? ["0:old"] : ["2:0", "2:2", "2:1", "2:3"],
          );
          expect((yield* collected.list("all")).entries.map((entry) => entry.event.value)).toEqual(
            kind === "new" ? ["old"] : ["0", "2", "1", "3"],
          );
          expect(yield* collected.history).toEqual({ complete: true });
        }).pipe(Effect.scoped, Effect.provide(resumed.live));
      }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live("rejects changed sources at the same consumer generation even after completion", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const sql = yield* Pg.PgClient;
      yield* seed(schema, 4);
      const before =
        yield* sql`SELECT target, plan, cursor, complete FROM ${sql(`${schema}.backfills`)} ORDER BY target`;
      expect(before.every((row) => row["complete"] === true)).toBe(true);
      const changed = world(schema, 1, [], undefined, undefined, { mirrorLazy: true });
      const failed = yield* Layer.build(changed.live).pipe(Effect.scoped, Effect.exit);
      expect(Exit.isFailure(failed)).toBe(true);
      if (Exit.isFailure(failed)) {
        expect(
          failed.cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect),
        ).toEqual([
          expect.objectContaining({
            _tag: "BackfillPlanChanged",
            message: expect.stringContaining("its version"),
          }),
        ]);
      }
      expect(
        yield* sql`SELECT target, plan, cursor, complete FROM ${sql(`${schema}.backfills`)} ORDER BY target`,
      ).toEqual(before);
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );
});

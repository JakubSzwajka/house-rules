import * as Domain from "@alchemy.run/domain";
import type { ModelHost } from "@alchemy.run/domain/Platform";
import * as Pg from "@effect/sql-pg/PgClient";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { PgForTests, testSchema } from "../from-env.ts";
import { drained, Mark, Marks, world } from "./backfill-fixture.ts";
import { declarations, historyOnly } from "./backfill-mode-fixture.ts";

describe.skipIf(process.env["DOMAIN_STORE"] === "memory")("recorded view mode transitions", () => {
  it.live.each(declarations)(
    "replays untouched history from $lazyTarget to $eagerTarget",
    (declaration) =>
      Effect.gen(function* () {
        const { version, lazyTarget, eagerTarget, secondSource } = declaration;
        const schema = yield* testSchema;
        yield* historyOnly(schema);
        const effects: string[] = [];
        const lazy = world(
          schema,
          version,
          effects,
          (kit) => {
            expect(kit.target).toBe(lazyTarget);
            expect(kit.generation).toBe(version);
            expect(kit.catchUp).toBeDefined();
            return kit;
          },
          undefined,
          { individualOnly: true, lazy: true },
        );
        expect(Domain.verify(lazy.definition)).toEqual([]);
        yield* Effect.gen(function* () {
          const view = yield* lazy.Individual;
          expect((yield* view.snapshot(Marks.ref("a"))).state).toEqual([
            `${version}:0`,
            `${version}:2`,
          ]);
          expect((yield* view.list(Marks.ref("a"))).entries).toHaveLength(2);
        }).pipe(Effect.scoped, Effect.provide(lazy.live));
        let history: NonNullable<ModelHost["history"]> = () => Effect.die("history missing");
        let beforeReplay: { readonly complete: boolean } | undefined;
        const eager = world(
          schema,
          version,
          effects,
          (kit) => {
            expect(kit.target).toBe(eagerTarget);
            expect(kit.generation).toBe(version);
            expect(kit.catchUp).toBeUndefined();
            return kit;
          },
          undefined,
          {
            individualOnly: true,
            secondSource,
            host: (host) => {
              history = host.history ?? history;
              return {
                ...host,
                start: (...args) =>
                  Effect.gen(function* () {
                    beforeReplay = yield* history(eagerTarget);
                    yield* host.start?.(...args) ?? Effect.die("start missing");
                  }),
              };
            },
          },
        );
        expect(Domain.verify(eager.definition)).toEqual([]);
        yield* Effect.gen(function* () {
          const view = yield* eager.Individual;
          expect((yield* view.snapshot(Marks.ref("z"))).state).toEqual([
            `${version}:1`,
            `${version}:3`,
            ...(secondSource ? [`${version}:other`] : []),
          ]);
          expect(
            (yield* view.list(Marks.ref("z"))).entries.map((entry) => entry.event.value),
          ).toEqual(["1", "3", ...(secondSource ? ["other"] : [])]);
          expect((yield* view.list(Marks.ref("a"))).entries).toHaveLength(2);
          expect(beforeReplay).toEqual({ complete: false });
          expect(yield* view.history).toEqual({ complete: true });
          expect(yield* history(eagerTarget)).toEqual({ complete: true });
          yield* drained(schema);
          expect(effects).toEqual([]);
        }).pipe(Effect.scoped, Effect.provide(eager.live));
      }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live.each(declarations)(
    "re-arms completed $eagerTarget atomically and resumes after a pre-start crash",
    (declaration) =>
      Effect.gen(function* () {
        const { version, eagerTarget, secondSource } = declaration;
        const schema = yield* testSchema;
        const sql = yield* Pg.PgClient;
        yield* historyOnly(schema);
        const eagerOptions = { individualOnly: true, secondSource };
        const first = world(schema, version, [], undefined, undefined, eagerOptions);
        yield* drained(schema).pipe(Effect.scoped, Effect.provide(first.live));
        const before =
          yield* sql`SELECT plan FROM ${sql(`${schema}.backfills`)} WHERE target = ${eagerTarget}`;
        const lazy = world(schema, version, [], undefined, undefined, {
          individualOnly: true,
          lazy: true,
        });
        yield* drained(schema).pipe(Effect.scoped, Effect.provide(lazy.live));
        yield* historyOnly(schema, 1, true);
        const crashing = world(schema, version, [], undefined, undefined, {
          ...eagerOptions,
          host: (host) => ({
            ...host,
            start: () =>
              Effect.gen(function* () {
                expect(yield* host.history?.(eagerTarget) ?? Effect.die("history missing")).toEqual(
                  { complete: false },
                );
                return yield* Effect.die("crash before replay");
              }),
          }),
        });
        expect(
          Exit.isFailure(yield* Layer.build(crashing.live).pipe(Effect.scoped, Effect.exit)),
        ).toBe(true);
        expect(
          yield* sql`SELECT catch_up FROM ${sql(`${schema}.views`)} WHERE view = 'Individual'`,
        ).toEqual([{ catch_up: false }]);
        expect(
          yield* sql`SELECT plan, complete, cursor, routed, applied, deduped FROM ${sql(`${schema}.backfills`)} WHERE target = ${eagerTarget}`,
        ).toEqual([
          {
            plan: before[0]?.["plan"],
            complete: false,
            cursor: null,
            routed: 0n,
            applied: 0n,
            deduped: 0n,
          },
        ]);
        const resumed = world(schema, version, [], undefined, undefined, eagerOptions);
        yield* Effect.gen(function* () {
          const view = yield* resumed.Individual;
          expect((yield* view.snapshot(Marks.ref("0"))).state).toEqual([`${version}:0`]);
          expect((yield* view.list(Marks.ref("a"))).entries).toHaveLength(2);
          expect((yield* view.list(Marks.ref("z"))).entries).toHaveLength(secondSource ? 3 : 2);
          expect(yield* view.history).toEqual({ complete: true });
        }).pipe(Effect.scoped, Effect.provide(resumed.live));
      }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live("preserves queued current-generation live policies across @1 to #1", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const sql = yield* Pg.PgClient;
      yield* historyOnly(schema);
      const blocked = yield* Deferred.make<void>();
      const effects: string[] = [];
      const lazy = world(schema, 1, effects, undefined, undefined, {
        individualOnly: true,
        store: (_kit, store) => ({
          ...store,
          receive: () => Deferred.succeed(blocked, undefined).pipe(Effect.andThen(Effect.never)),
        }),
      });
      yield* Effect.gen(function* () {
        const view = yield* lazy.Individual;
        yield* view.snapshot(Marks.ref("a"));
        const marks = yield* Marks;
        yield* marks.send("z", new Mark({ value: "live" }));
        yield* Deferred.await(blocked).pipe(Effect.timeout("5 seconds"));
      }).pipe(Effect.scoped, Effect.provide(lazy.live));
      expect(
        yield* sql`SELECT delivery->'target' AS target, attempts FROM ${sql(`${schema}.outbox`)}`,
      ).toEqual([
        { target: { kind: "view", name: "Individual", generation: 1, inPlace: true }, attempts: 0 },
      ]);
      expect(effects).toEqual([]);
      const eager = world(schema, 1, effects, undefined, undefined, {
        individualOnly: true,
        secondSource: true,
      });
      yield* Effect.gen(function* () {
        const view = yield* eager.Individual;
        expect((yield* view.snapshot(Marks.ref("z"))).state).toEqual([
          "1:1",
          "1:3",
          "1:live",
          "1:other",
        ]);
        expect((yield* view.list(Marks.ref("z"))).entries).toHaveLength(4);
        expect((yield* view.list(Marks.ref("a"))).entries).toHaveLength(2);
        yield* drained(schema);
        expect(effects).toEqual(["live"]);
        expect(yield* view.history).toEqual({ complete: true });
      }).pipe(Effect.scoped, Effect.provide(eager.live));
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live("preserves a committed transition page on an ordinary eager restart", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const sql = yield* Pg.PgClient;
      yield* historyOnly(schema, 132);
      const lazy = world(schema, 0, [], undefined, undefined, { individualOnly: true, lazy: true });
      yield* Layer.build(lazy.live).pipe(Effect.scoped);
      const reached = yield* Deferred.make<void>();
      let applied = 0;
      const blocked = world(
        schema,
        0,
        [],
        (kit) => ({
          ...kit,
          apply: (...args) =>
            Effect.gen(function* () {
              if (++applied === 130) {
                yield* Deferred.succeed(reached, undefined);
                return yield* Effect.never;
              }
              return yield* kit.apply(...args);
            }),
        }),
        undefined,
        { individualOnly: true },
      );
      const starting = yield* Layer.build(blocked.live).pipe(Effect.scoped, Effect.forkChild);
      yield* Deferred.await(reached).pipe(Effect.timeout("10 seconds"));
      const progress =
        yield* sql`SELECT cursor, complete, routed, applied, deduped FROM ${sql(`${schema}.backfills`)} WHERE target = 'view:Individual'`;
      expect(progress).toEqual([
        {
          cursor: { source: "Marks", id: "z", seq: 62 },
          complete: false,
          routed: 128n,
          applied: 128n,
          deduped: 0n,
        },
      ]);
      expect(
        yield* sql`SELECT count(*)::int AS count FROM ${sql(`${schema}.view_entries`)}`,
      ).toEqual([{ count: 128 }]);
      yield* Fiber.interrupt(starting);
      const resumed = world(schema, 0, [], undefined, undefined, {
        individualOnly: true,
        host: (host) => ({
          ...host,
          start: (...args) =>
            Effect.gen(function* () {
              expect(
                yield* sql`SELECT cursor, complete, routed, applied, deduped FROM ${sql(`${schema}.backfills`)} WHERE target = 'view:Individual'`,
              ).toEqual(progress);
              expect(
                yield* host.history?.("view:Individual") ?? Effect.die("history missing"),
              ).toEqual({ complete: false });
              yield* host.start?.(...args) ?? Effect.die("start missing");
            }).pipe(Effect.orDie),
        }),
      });
      yield* Effect.gen(function* () {
        const view = yield* resumed.Individual;
        for (const key of ["a", "z"]) {
          expect((yield* view.list(Marks.ref(key), { take: 200 })).entries).toHaveLength(66);
        }
        expect(yield* view.history).toEqual({ complete: true });
      }).pipe(Effect.scoped, Effect.provide(resumed.live));
      expect(
        yield* sql`SELECT routed, applied, deduped FROM ${sql(`${schema}.backfills`)} WHERE target = 'view:Individual'`,
      ).toEqual([{ routed: 132n, applied: 132n, deduped: 0n }]);
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );
});

import { expect, layer } from "@effect/vitest";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { Deferred, Effect, Fiber, Layer, Schedule } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { CurrentTransformer } from "effect/sql/Statement";
import { WorkItems, WorkItemsChanged, WorkItemStore } from "../../index.js";
import { MoveImportTesting } from "./move-import-testing.js";
import { stores } from "./stores.js";

const { options, access, ref, stored } = MoveImportTesting;
const actor = Actor.make({ id: ActorId.make("owner") });
const holder = { kind: "person", id: "legacy" };
const world = WorkItems.layer(options).pipe(
  Layer.provideMerge(stores[0].layer),
  Layer.provide(access),
);

layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
  "Postgres container lock order",
  (it) => {
    it.effect("locks each distinct container hash once in numeric key order", () =>
      Effect.gen(function* () {
        const store = yield* WorkItemStore;
        const sql = yield* SqlClient;
        const refs = [ref("order-b"), null, ref("order-a"), null, ref("order-b")];
        const expected = yield* sql<{
          key: string;
        }>`select distinct hashtextextended(key, 0)::text as key from (${sql.join(" union all ")(
          refs.map(
            (ref) =>
              sql`select ${JSON.stringify(["work_items.container", ref?.kind ?? null, ref?.id ?? null])}::text as key`,
          ),
        )}) refs`;
        const acquired: unknown[] = [];
        yield* UnitOfWork.atomic(store.lockContainers(refs)).pipe(
          Effect.provideService(CurrentTransformer, (statement) => {
            const [query, params] = statement.compile();
            if (query.includes("pg_advisory_xact_lock")) acquired.push(params[0]);
            return Effect.succeed(statement);
          }),
        );
        expect(acquired).toEqual(
          expected.map(({ key }) => key).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)),
        );
      }),
    );

    it.effect("finishes 40 rounds of opposite cross-container moves without deadlocks", () =>
      Effect.gen(function* () {
        const service = yield* WorkItems;
        const left = ref("opposite-left");
        const right = ref("opposite-right");
        const a = (yield* UnitOfWork.atomic(service.create(actor, { title: "a", container: left })))
          .item;
        const b = (yield* UnitOfWork.atomic(
          service.create(actor, { title: "b", container: right }),
        )).item;
        for (let round = 0; round < 40; round++) {
          const start = yield* Deferred.make<void>();
          let arrivals = 0;
          const outcomes = yield* Effect.forEach(
            [
              { id: a.id, container: round % 2 === 0 ? right : left },
              { id: b.id, container: round % 2 === 0 ? left : right },
            ],
            ({ id, container }) => {
              let firstLock = true;
              return UnitOfWork.atomic(service.move(actor, id, { container })).pipe(
                Effect.provideService(CurrentTransformer, (statement) =>
                  Effect.gen(function* () {
                    if (firstLock && statement.compile()[0].includes("pg_advisory_xact_lock")) {
                      firstLock = false;
                      // Both transactions reach their first lock before either can acquire it.
                      arrivals++;
                      if (arrivals === 2) yield* Deferred.succeed(start, undefined);
                      yield* Deferred.await(start);
                    }
                    return statement;
                  }),
                ),
                Effect.result,
              );
            },
            { concurrency: 2 },
          );
          expect(outcomes, `round ${round}`).toMatchObject([
            { _tag: "Success" },
            { _tag: "Success" },
          ]);
        }
        expect((yield* service.getForSystem(a.id)).container).toEqual(left);
        expect((yield* service.getForSystem(b.id)).container).toEqual(right);
      }),
    );

    it.effect("takes container locks before releasing a holder across a moving subtree", () =>
      Effect.gen(function* () {
        const service = yield* WorkItems;
        const sql = yield* SqlClient;
        const source = ref("release-source");
        const target = ref("release-target");
        const root = stored("release-root", source);
        const child = { ...stored("release-child", source), parent: root.id };
        const other = stored("release-other", target);
        yield* UnitOfWork.atomic(service.import([root, child, other]));
        const ready = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const mover = yield* UnitOfWork.atomic(
          service
            .move(actor, root.id, { container: target })
            .pipe(
              Effect.andThen(Deferred.succeed(ready, undefined)),
              Effect.andThen(Deferred.await(release)),
            ),
        ).pipe(Effect.forkChild);
        yield* Deferred.await(ready);
        const releaser = yield* UnitOfWork.atomic(service.releaseHolder(holder)).pipe(
          Effect.forkChild,
        );
        const waiting =
          sql`select pid from pg_stat_activity where datname = current_database() and wait_event = 'advisory' and query like '%pg_advisory_xact_lock%'`.pipe(
            Effect.repeat({
              until: (rows) => rows.length > 0,
              schedule: Schedule.spaced("10 millis"),
            }),
            Effect.as("waiting"),
          );
        expect(
          yield* Effect.raceFirst(waiting, Fiber.join(releaser).pipe(Effect.as("completed"))),
        ).toBe("waiting");
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(mover);
        yield* Fiber.join(releaser);
        for (const item of [root, child, other]) {
          expect(yield* service.getForSystem(item.id)).toMatchObject({
            holder: null,
            status: item.status,
            container: target,
          });
        }
      }),
    );

    it.effect.each(["move", "import"] as const)(
      "reports a conflict when a %s anchor moves during discovery",
      (operation) =>
        Effect.gen(function* () {
          const service = yield* WorkItems;
          const source = ref(`${operation}-discovery-source`);
          const target = ref(`${operation}-discovery-target`);
          const anchor = (yield* UnitOfWork.atomic(
            service.create(actor, { title: "anchor", container: source }),
          )).item;
          const discovered = yield* Deferred.make<void>();
          const resume = yield* Deferred.make<void>();
          let firstLock = true;
          const imported = {
            ...stored(`${operation}-discovery-child`, source),
            parent: anchor.id,
            holder: null,
          };
          const attempt = yield* UnitOfWork.atomic(
            Effect.gen(function* () {
              if (operation === "move")
                yield* service.move(actor, anchor.id, { container: source });
              else yield* service.import([imported]);
            }),
          ).pipe(
            Effect.provideService(CurrentTransformer, (statement) =>
              Effect.gen(function* () {
                if (firstLock && statement.compile()[0].includes("pg_advisory_xact_lock")) {
                  firstLock = false;
                  yield* Deferred.succeed(discovered, undefined);
                  yield* Deferred.await(resume);
                }
                return statement;
              }),
            ),
            Effect.result,
            Effect.forkChild,
          );
          yield* Deferred.await(discovered);
          yield* UnitOfWork.atomic(service.move(actor, anchor.id, { container: target }));
          yield* Deferred.succeed(resume, undefined);
          expect(yield* Fiber.join(attempt)).toMatchObject({
            _tag: "Failure",
            failure: new WorkItemsChanged(),
          });
          expect((yield* service.getForSystem(anchor.id)).container).toEqual(target);
          if (operation === "import") {
            const store = yield* WorkItemStore;
            expect(yield* store.get(imported.id)).toBeNull();
          }
          expect(new WorkItemsChanged().kind).toBe("conflict");
          expect(new WorkItemsChanged().message).toBe("Work items changed; try again");
        }),
    );

    it.effect("reports a conflict when holder rows move outside discovered containers", () =>
      Effect.gen(function* () {
        const service = yield* WorkItems;
        const store = yield* WorkItemStore;
        const source = ref("release-race-source");
        const target = ref("release-race-target");
        const item = stored("release-race-item", source);
        yield* UnitOfWork.atomic(service.import([item]));
        const discovered = yield* Deferred.make<void>();
        const resume = yield* Deferred.make<void>();
        let firstLock = true;
        const releaser = yield* UnitOfWork.atomic(service.releaseHolder(holder)).pipe(
          Effect.provideService(CurrentTransformer, (statement) =>
            Effect.gen(function* () {
              if (firstLock && statement.compile()[0].includes("pg_advisory_xact_lock")) {
                firstLock = false;
                yield* Deferred.succeed(discovered, undefined);
                yield* Deferred.await(resume);
              }
              return statement;
            }),
          ),
          Effect.result,
          Effect.forkChild,
        );
        yield* Deferred.await(discovered);
        yield* UnitOfWork.atomic(service.move(actor, item.id, { container: target }));
        yield* Deferred.succeed(resume, undefined);
        const outcome = yield* Fiber.join(releaser);
        expect(outcome).toMatchObject({ _tag: "Failure", failure: new WorkItemsChanged() });
        expect((yield* store.get(item.id))?.holder).toEqual(item.holder);
        yield* UnitOfWork.atomic(service.releaseHolder(holder));
        expect((yield* store.get(item.id))?.holder).toBeNull();
      }),
    );
  },
);

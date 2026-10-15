import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { describe, expect, it } from "@effect/vitest";
import { Activity, type ActivityQuery, activityPageSize } from "@example/activity";
import { AuditStore, memoryAuditStore, postgresAuditStore } from "@house-rules/call-audit";
import { Actor, ActorId } from "@house-rules/domain";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { DateTime, Effect, Layer } from "effect";

const moduleList = new URL("../../../../../../migrations.json", import.meta.url).pathname;

const database = Layer.effectDiscard(Migrations.runList(moduleList)).pipe(
  Layer.provideMerge(
    MigrationsTesting.database({
      label: "activity_paging",
      client: (url) => PgClient.layer({ url, maxConnections: 4 }),
    }),
  ),
  Layer.provide(NodeServices.layer),
  Layer.orDie,
);

const stores = [
  ["memory", Activity.layer.pipe(Layer.provideMerge(memoryAuditStore()))],
  [
    "Postgres",
    Activity.layer.pipe(Layer.provideMerge(postgresAuditStore), Layer.provide(database)),
  ],
] as const;

const alice = Actor.make({ id: ActorId.make("alice") });

const seed = (count: number, at: number, requestId: (index: number) => string | null) =>
  Effect.gen(function* seedRows() {
    const store = yield* AuditStore;
    yield* store.erase("alice");
    for (let index = 0; index < count; index += 1) {
      yield* store.record({
        viewerId: "alice",
        capability: "show_me",
        permission: "party:read",
        outcome: "success",
        ms: index,
        kind: "read",
        targetId: null,
        channel: "web",
        requestId: requestId(index),
        recordedAt: DateTime.toDateUtc(DateTime.makeUnsafe(at)),
      });
    }
  });

const allPages = (query: ActivityQuery = {}) =>
  Effect.gen(function* walk() {
    const activity = yield* Activity;
    const pages = [yield* activity.mine(alice, query)];
    for (let next = pages[0]?.next; next !== null && next !== undefined; ) {
      const page = yield* activity.mine(alice, { ...query, ...next });
      pages.push(page);
      next = page.next;
    }
    return pages;
  });

const ties = [
  ["no request id", () => null],
  ["one repeated request id", () => "same-id"],
  ["two repeated request ids", (index: number) => (index % 2 === 0 ? "even" : "odd")],
] as const;

for (const [storeName, layer] of stores) {
  describe(`Activity over the ${storeName} AuditStore`, () => {
    it.layer(layer, { timeout: 60_000 })((test) => {
      for (const [tieName, requestId] of ties) {
        test.effect(`25 calls in one millisecond with ${tieName} page as 20 + 5`, () =>
          Effect.gen(function* tied() {
            yield* seed(activityPageSize + 5, 7_000, requestId);
            const pages = yield* allPages();
            expect(pages.map((page) => page.items.length)).toEqual([activityPageSize, 5]);
            const durations = pages.flatMap((page) => page.items.map((entry) => entry.durationMs));
            // Each row has its own duration, so a lost or doubled row shows here.
            expect([...durations].sort((left, right) => left - right)).toEqual(
              Array.from({ length: activityPageSize + 5 }, (_, index) => index),
            );
          }),
        );
      }
    });
  });
}

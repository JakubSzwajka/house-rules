import { describe, expect, it } from "@effect/vitest";
import { memoryAuditStore } from "@house-rules/call-audit";
import { Actor, ActorId } from "@house-rules/domain";
import { DateTime, Effect, Exit, Layer, Schema } from "effect";
import {
  Activity,
  type ActivityEntry,
  ActivityQuery,
  activityPageSize,
  activityWindow,
  listMyActivityContract,
} from "../index.js";

const row = (
  viewerId: string | null,
  capability: string,
  at: number,
  requestId: string | null = `req-${at}`,
) => ({
  capability,
  permission: "bookings:write",
  viewerId,
  outcome: "success",
  ms: 3,
  kind: "write" as const,
  targetId: "b-1",
  channel: "web",
  requestId,
  recordedAt: DateTime.toDateUtc(DateTime.makeUnsafe(at)),
});

const rows = [
  row("alice", "book_booking", 1_000),
  row("bob", "book_booking", 2_000),
  row("alice", "add_comment", 3_000),
  row(null, "sign_in", 4_000),
];

const alice = Actor.make({ id: ActorId.make("alice") });
const nobody = Actor.make({ id: ActorId.make("nobody") });

const withRows = (seed: Array<ReturnType<typeof row>>) =>
  Effect.provide(Activity.layer.pipe(Layer.provide(memoryAuditStore(seed))));

it.layer(Activity.layer.pipe(Layer.provide(memoryAuditStore(rows))))("Activity", (test) => {
  test.effect("lists only the actor's own calls, newest first, with request id and duration", () =>
    Effect.gen(function* mine() {
      const activity = yield* Activity;
      const page = yield* activity.mine(alice);
      const fields = {
        outcome: "success",
        kind: "write",
        channel: "web",
        targetId: "b-1",
        durationMs: 3,
      };
      expect(page).toEqual({
        items: [
          { ...fields, capability: "add_comment", requestId: "req-3000", recordedAt: 3_000 },
          { ...fields, capability: "book_booking", requestId: "req-1000", recordedAt: 1_000 },
        ],
        next: null,
        moreBeyondWindow: false,
      });
      expect((yield* activity.mine(nobody)).items).toEqual([]);
    }),
  );
});

const many = (count: number) =>
  Array.from({ length: count }, (_, index) => row("alice", "show_booking", index));

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

it.effect("pages go back with a cursor, with no overlap and no gap", () =>
  Effect.gen(function* pages() {
    const [first, second, ...none] = yield* allPages();
    expect(none).toEqual([]);
    expect(first?.items).toHaveLength(activityPageSize);
    expect(first?.items[0]?.recordedAt).toBe(activityPageSize + 4);
    expect(first?.next).toEqual({ beforeAt: 5, skipAtSameTime: 1 });
    expect(second?.items.map((entry) => entry.recordedAt)).toEqual([4, 3, 2, 1, 0]);
    expect(second?.next).toBe(null);
  }).pipe(withRows(many(activityPageSize + 5))),
);

const tiedRows = (requestId: (index: number) => string | null) =>
  Array.from({ length: activityPageSize + 5 }, (_, index) => ({
    ...row("alice", "show_booking", 7, requestId(index)),
    ms: index,
  }));

describe.each([
  ["no request id", () => null],
  ["one repeated request id", () => "same-id"],
  ["two repeated request ids", (index: number) => (index % 2 === 0 ? "even" : "odd")],
])("25 calls in one millisecond with %s", (_name, requestId) => {
  it.effect("page as 20 + 5, none lost and none twice", () =>
    Effect.gen(function* tied() {
      const pages = yield* allPages();
      expect(pages.map((page) => page.items.length)).toEqual([activityPageSize, 5]);
      expect(pages[0]?.next).toEqual({ beforeAt: 7, skipAtSameTime: activityPageSize });
      const durations = pages.flatMap((page) => page.items.map((entry) => entry.durationMs));
      expect([...durations].sort((left, right) => left - right)).toEqual(
        Array.from({ length: activityPageSize + 5 }, (_, index) => index),
      );
    }).pipe(withRows(tiedRows(requestId))),
  );
});

it.effect("a tie that spans three pages carries its skip count forward", () =>
  Effect.gen(function* spans() {
    const pages = yield* allPages();
    expect(pages.map((page) => page.next)).toEqual([
      { beforeAt: 7, skipAtSameTime: 20 },
      { beforeAt: 7, skipAtSameTime: 40 },
      null,
    ]);
    const durations = pages.flatMap((page) => page.items.map((entry) => entry.durationMs));
    expect(new Set(durations).size).toBe(45);
  }).pipe(
    withRows(
      Array.from({ length: 45 }, (_, index) => ({
        ...row("alice", "show_booking", 7, null),
        ms: index,
      })),
    ),
  ),
);

const withReads = [
  ...many(activityPageSize + 5),
  ...Array.from({ length: 30 }, (_, index) => row("alice", "list_my_activity", 100 + index)),
];

it.effect("its own reads stay out before paging, unless asked for", () =>
  Effect.gen(function* ownReads() {
    const hidden = yield* allPages();
    expect(hidden.map((page) => page.items.length)).toEqual([activityPageSize, 5]);
    expect(hidden.flatMap((page) => page.items).some(isRead)).toBe(false);
    const shown = yield* allPages({ includeActivityReads: true });
    expect(shown.map((page) => page.items.length)).toEqual([20, 20, 15]);
    expect(shown[0]?.items.every(isRead)).toBe(true);
  }).pipe(withRows(withReads)),
);

const isRead = (entry: ActivityEntry) => entry.capability === "list_my_activity";

it.effect("past the newest rows it can reach, the page says so", () =>
  Effect.gen(function* edge() {
    const activity = yield* Activity;
    const oldest = yield* activity.mine(alice, { beforeAt: activityPageSize, skipAtSameTime: 0 });
    expect(oldest.items.at(-1)?.recordedAt).toBe(5);
    expect(oldest.next).toBe(null);
    expect(oldest.moreBeyondWindow).toBe(true);
  }).pipe(withRows(many(activityWindow + 5))),
);

const decode = Schema.decodeUnknownExit(ActivityQuery);

it.each([
  ["beforeAt without skipAtSameTime", { beforeAt: 5 }],
  ["skipAtSameTime without beforeAt", { skipAtSameTime: 1 }],
  ["a negative beforeAt", { beforeAt: -1, skipAtSameTime: 0 }],
  ["a negative skipAtSameTime", { beforeAt: 5, skipAtSameTime: -1 }],
  ["a beforeAt past the last date", { beforeAt: 1e308, skipAtSameTime: 0 }],
  ["a skipAtSameTime past the window", { beforeAt: 5, skipAtSameTime: activityWindow }],
  ["a fractional beforeAt", { beforeAt: 5.5, skipAtSameTime: 0 }],
])("the query refuses %s", (_name, query) => {
  expect(Exit.isFailure(decode(query))).toBe(true);
});

it("the query takes a whole cursor, or none", () => {
  expect(Exit.isSuccess(decode({}))).toBe(true);
  expect(Exit.isSuccess(decode({ beforeAt: 5, skipAtSameTime: 0 }))).toBe(true);
  expect(Exit.isSuccess(decode({ includeActivityReads: true }))).toBe(true);
});

it("the contract is a read-only read for activity:read", () => {
  expect([
    listMyActivityContract.name,
    listMyActivityContract.permission,
    listMyActivityContract.annotations.readOnly,
  ]).toEqual(["list_my_activity", "activity:read", true]);
});

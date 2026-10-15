import { expect, it } from "@effect/vitest";
import type { ActivityEntry, MyActivity } from "@example/activity/contract";
import { type Trail, withNewest, withOlder } from "../audit-trail.js";

const entry = (recordedAt: number): ActivityEntry => ({
  capability: "show_me",
  outcome: "success",
  kind: "read",
  channel: "web",
  targetId: null,
  requestId: `req-${recordedAt}`,
  durationMs: 1,
  recordedAt,
});

const newestFirst = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => entry(from - index));

const page = (items: ReadonlyArray<ActivityEntry>, beforeAt: number | null): MyActivity => ({
  items,
  next: beforeAt === null ? null : { beforeAt, skipAtSameTime: 1 },
  moreBeyondWindow: false,
});

const firstPage = page(newestFirst(100, 20), 81);
const secondPage = page(newestFirst(80, 20), 61);

it("two answers to one Load older append the page once", () => {
  const once = withOlder(firstPage, { beforeAt: 81, skipAtSameTime: 1 }, secondPage);
  const twice = withOlder(once, { beforeAt: 81, skipAtSameTime: 1 }, secondPage);
  expect(twice.items).toHaveLength(40);
  expect(new Set(twice.items.map((item) => item.recordedAt)).size).toBe(40);
  expect(twice.next).toEqual({ beforeAt: 61, skipAtSameTime: 1 });
});

it("a page that repeats rows already shown adds only the new ones", () => {
  const overlapping = page(newestFirst(85, 20), 66);
  const merged = withOlder(firstPage, { beforeAt: 81, skipAtSameTime: 1 }, overlapping);
  expect(merged.items.map((item) => item.recordedAt)).toEqual(
    Array.from({ length: 35 }, (_, index) => 100 - index),
  );
});

it("a refresh keeps the older pages already loaded", () => {
  const loaded: Trail = withOlder(firstPage, { beforeAt: 81, skipAtSameTime: 1 }, secondPage);
  const fresh = page(newestFirst(102, 20), 83);
  const merged = withNewest(loaded, fresh);
  expect(merged.items.map((item) => item.recordedAt)).toEqual(
    Array.from({ length: 42 }, (_, index) => 102 - index),
  );
  expect(merged.next).toEqual(loaded.next);
});

it("a refresh after more than a page of new calls starts over, with no gap", () => {
  const fresh = page(newestFirst(140, 20), 121);
  expect(withNewest(firstPage, fresh)).toEqual(fresh);
});

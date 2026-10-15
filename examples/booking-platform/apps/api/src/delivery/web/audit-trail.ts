import {
  type ActivityCursor,
  type ActivityEntry,
  activityOrder,
  type MyActivity,
} from "@example/activity/contract";

export type Trail = MyActivity;

export const keyOf = (entry: ActivityEntry) => JSON.stringify(entry);

const sameCursor = (left: ActivityCursor | null, right: ActivityCursor | null): boolean =>
  left?.beforeAt === right?.beforeAt && left?.skipAtSameTime === right?.skipAtSameTime;

export const withNewest = (trail: Trail | null, page: MyActivity): Trail => {
  const oldestNew = page.items.at(-1);
  const newestKept = trail?.items[0];
  if (trail === null || page.next === null || oldestNew === undefined) return page;
  // More new calls than one page: the gap cannot be filled, so start over from the newest.
  if (newestKept === undefined || activityOrder(newestKept, oldestNew) > 0) return page;
  // The kept rows past the new first page, with their cursor, still hold: new rows only land on top.
  const tail = trail.items.filter((entry) => activityOrder(entry, oldestNew) > 0);
  return tail.length === 0 ? page : { ...trail, items: [...page.items, ...tail] };
};

export const withOlder = (trail: Trail, asked: ActivityCursor, page: MyActivity): Trail => {
  // An answer to a cursor the trail has moved past would repeat rows, so it is dropped.
  if (!sameCursor(trail.next, asked)) return trail;
  const seen = new Set(trail.items.map(keyOf));
  return {
    ...page,
    items: [...trail.items, ...page.items.filter((entry) => !seen.has(keyOf(entry)))],
  };
};

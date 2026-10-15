import {
  type ActivityEntry,
  type ActivityQuery,
  activityOrder,
  activityPageSize,
  activityWindow,
  type MyActivity,
} from "./activity.js";
import { listMyActivityContract } from "./list-my-activity.js";

const atTime = (rows: ReadonlyArray<ActivityEntry>, at: number): number =>
  rows.filter((entry) => entry.recordedAt === at).length;

export const activityPage = (
  window: ReadonlyArray<ActivityEntry>,
  query: ActivityQuery,
): MyActivity => {
  // AuditStore.read has no `before` filter, so the cursor applies here, over the newest rows only.
  const shown =
    query.includeActivityReads === true
      ? [...window]
      : window.filter((entry) => entry.capability !== listMyActivityContract.name);
  const sorted = shown.sort(activityOrder);
  const { beforeAt, skipAtSameTime } = query;
  const atOrBefore =
    beforeAt === undefined ? sorted : sorted.filter((entry) => entry.recordedAt <= beforeAt);
  const skipped =
    beforeAt === undefined ? 0 : Math.min(skipAtSameTime ?? 0, atTime(atOrBefore, beforeAt));
  const rest = atOrBefore.slice(skipped);
  const items = rest.slice(0, activityPageSize);
  const last = items.at(-1);
  const next =
    rest.length > activityPageSize && last !== undefined
      ? {
          beforeAt: last.recordedAt,
          skipAtSameTime:
            atTime(items, last.recordedAt) + (last.recordedAt === beforeAt ? skipped : 0),
        }
      : null;
  return {
    items,
    next,
    moreBeyondWindow: next === null && window.length >= activityWindow,
  };
};

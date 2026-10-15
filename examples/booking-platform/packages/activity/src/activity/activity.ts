import { Schema } from "effect";

export const ActivityEntry = Schema.Struct({
  capability: Schema.String,
  outcome: Schema.String,
  kind: Schema.NullOr(Schema.Literals(["read", "write"])),
  channel: Schema.NullOr(Schema.String),
  targetId: Schema.NullOr(Schema.String),
  requestId: Schema.NullOr(Schema.String),
  durationMs: Schema.Finite,
  recordedAt: Schema.Finite,
});
export type ActivityEntry = typeof ActivityEntry.Type;

const text = (value: string | null): string => value ?? "";

const byText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export const activityOrder = (left: ActivityEntry, right: ActivityEntry): number =>
  // Every field breaks a tie, so rows in one millisecond keep one order on every read and in the dock.
  right.recordedAt - left.recordedAt ||
  byText(text(left.requestId), text(right.requestId)) ||
  byText(left.capability, right.capability) ||
  byText(left.outcome, right.outcome) ||
  byText(text(left.kind), text(right.kind)) ||
  byText(text(left.channel), text(right.channel)) ||
  byText(text(left.targetId), text(right.targetId)) ||
  left.durationMs - right.durationMs;

export const activityPageSize = 20;
export const activityWindow = 1000;

const lastDateMs = 8_640_000_000_000_000;

const BeforeAt = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: lastDateMs }));
const SkipAtSameTime = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: activityWindow - 1 }),
);

export const ActivityCursor = Schema.Struct({
  beforeAt: BeforeAt,
  skipAtSameTime: SkipAtSameTime,
});
export type ActivityCursor = typeof ActivityCursor.Type;

export const ActivityQuery = Schema.Struct({
  beforeAt: Schema.optional(BeforeAt),
  skipAtSameTime: Schema.optional(SkipAtSameTime),
  includeActivityReads: Schema.optional(Schema.Boolean),
}).check(
  Schema.makeFilter((query) =>
    (query.beforeAt === undefined) === (query.skipAtSameTime === undefined)
      ? undefined
      : {
          path: [query.beforeAt === undefined ? "beforeAt" : "skipAtSameTime"],
          issue: "beforeAt and skipAtSameTime come together, from the last page's next.",
        },
  ),
);
export type ActivityQuery = typeof ActivityQuery.Type;

export const MyActivity = Schema.Struct({
  items: Schema.Array(ActivityEntry),
  next: Schema.NullOr(ActivityCursor),
  moreBeyondWindow: Schema.Boolean,
});
export type MyActivity = typeof MyActivity.Type;

export class ActivityUnavailable extends Schema.TaggedError<ActivityUnavailable>()(
  "ActivityUnavailable",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

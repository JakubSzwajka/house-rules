import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const WorkItemId = Schema.String.pipe(Schema.brand("WorkItemId"));
export type WorkItemId = typeof WorkItemId.Type;

export const WorkItemTitle = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(200),
);

export const WorkItemBody = Schema.String.check(Schema.isMaxLength(20_000));

export const WorkItemPriority = Schema.Literals(["low", "medium", "high", "urgent"]);
export type WorkItemPriority = typeof WorkItemPriority.Type;

const daysIn = (year: number, month: number): number =>
  month === 2
    ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
      ? 30
      : 31;

const isCalendarDay = (date: string): boolean => {
  const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month);
};

export const WorkItemDue = Schema.String.check(
  Schema.isBetweenLength(10, 10),
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.makeFilter(isCalendarDay, { expected: "a calendar day as YYYY-MM-DD" }),
);

export const PriorityField = Schema.NullOr(WorkItemPriority).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed(null)),
  Schema.withConstructorDefault(Effect.succeed(null)),
);

export const DueField = Schema.NullOr(WorkItemDue).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed(null)),
  Schema.withConstructorDefault(Effect.succeed(null)),
);

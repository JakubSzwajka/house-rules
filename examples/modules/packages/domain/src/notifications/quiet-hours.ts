import * as Schema from "effect/Schema";

const LocalTime = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/));

export const TimeZone = Schema.String.check(
  Schema.makeFilter((zone) => zone === "UTC" || Intl.supportedValuesOf("timeZone").includes(zone), {
    expected: "an IANA time zone",
  }),
);

export const QuietHours = Schema.Struct({
  start: LocalTime,
  end: LocalTime,
  timeZone: TimeZone,
}).check(
  Schema.makeFilter((hours) => hours.start !== hours.end, { expected: "start and end to differ" }),
);
export type QuietHours = typeof QuietHours.Type;

const minute = 60_000;
const horizon = 49 * 60 * minute;

const localTime = (format: Intl.DateTimeFormat, instant: number) => {
  const parts = format.formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")}`;
};

const quietAt = (format: Intl.DateTimeFormat, instant: number, hours: QuietHours) => {
  const time = localTime(format, instant);
  return hours.start < hours.end
    ? time >= hours.start && time < hours.end
    : time >= hours.start || time < hours.end;
};

const formatFor = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

export const releaseAt = (instant: number, hours: QuietHours): number | null => {
  const format = formatFor(hours.timeZone);
  if (!quietAt(format, instant, hours)) return null;
  // Walk real minutes so skipped and repeated DST hours cannot invent an instant.
  for (
    let next = Math.floor(instant / minute) * minute + minute;
    next <= instant + horizon;
    next += minute
  ) {
    if (!quietAt(format, next, hours)) return next;
  }
  return instant + horizon;
};

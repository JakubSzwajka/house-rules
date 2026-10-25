import type { Delivery, QuietHours } from "./notification.js";

const minute = 60_000;
const formatter = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
const local = (format: Intl.DateTimeFormat, instant: number) => {
  const parts = format.formatToParts(instant);
  const part = (name: string) => parts.find((p) => p.type === name)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
};
export const isQuiet = (instant: number, hours: QuietHours, timeZone: string): boolean => {
  const { time } = local(formatter(timeZone), instant);
  return hours.start < hours.end
    ? time >= hours.start && time < hours.end
    : time >= hours.start || time < hours.end;
};
export const releaseAt = (instant: number, hours: QuietHours, timeZone: string): number => {
  if (!isQuiet(instant, hours, timeZone)) return instant;
  const format = formatter(timeZone);
  // Walk real minutes so skipped and repeated DST hours cannot invent an instant.
  for (
    let next = Math.floor(instant / minute) * minute + minute;
    next <= instant + 49 * 60 * minute;
    next += minute
  ) {
    const { time } = local(format, next);
    const quiet =
      hours.start < hours.end
        ? time >= hours.start && time < hours.end
        : time >= hours.start || time < hours.end;
    if (!quiet) return next;
  }
  return instant + 49 * 60 * minute;
};
export const digestAt = (
  instant: number,
  mode: Delivery["mode"],
  zone: string,
  dailyTime: string,
): number => {
  if (mode === "immediate") return instant;
  const format = formatter(zone);
  const current = local(format, instant);
  const sameDay = current.time < dailyTime;
  for (
    let next = Math.floor(instant / minute) * minute + minute;
    next <= instant + 49 * 60 * minute;
    next += minute
  ) {
    const candidate = local(format, next);
    if (
      mode === "hourly"
        ? candidate.time.endsWith(":00")
        : (sameDay || candidate.date > current.date) && candidate.time >= dailyTime
    )
      return next;
  }
  return instant + 49 * 60 * minute;
};

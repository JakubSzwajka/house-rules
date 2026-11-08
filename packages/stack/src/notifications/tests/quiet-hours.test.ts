import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { QuietHours, releaseAt } from "../index.ts";

const at = Date.parse;
const is = Schema.is(QuietHours);

describe("quiet hours", () => {
  const night = { start: "22:00", end: "07:00", timeZone: "Europe/Warsaw" };

  it("releases at the local end of a window that crosses midnight", () => {
    expect(releaseAt(at("2026-01-05T22:30:00Z"), night)).toBe(at("2026-01-06T06:00:00Z"));
    expect(releaseAt(at("2026-01-05T12:00:00Z"), night)).toBeNull();
  });

  it("releases at the first real minute after a skipped DST hour", () => {
    const hours = { start: "01:00", end: "02:30", timeZone: "America/New_York" };
    expect(releaseAt(at("2026-03-08T06:30:00Z"), hours)).toBe(at("2026-03-08T07:00:00Z"));
  });

  it("accepts only distinct times in a known zone", () => {
    expect(is(night)).toBe(true);
    expect(is({ ...night, end: "22:00" })).toBe(false);
    expect(is({ ...night, timeZone: "Mars/Olympus" })).toBe(false);
    expect(is({ ...night, start: "24:00" })).toBe(false);
  });
});

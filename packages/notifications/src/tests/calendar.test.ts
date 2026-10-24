import { expect, it } from "@effect/vitest";
import { UnitOfWork } from "@house-rules/domain";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { Notifications } from "../index.js";
import { notificationsTesting } from "./notifications.js";
const { actor, world, message } = notificationsTesting;

it.effect("releases a same-day quiet window at the first real minute after a DST gap", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-03-08T06:30:00Z"));
    const notifications = yield* Notifications;
    yield* UnitOfWork.atomic(
      Effect.gen(function* () {
        yield* notifications.setMyTimeZone(actor("spring"), "America/New_York");
        yield* notifications.setMyQuietHours(actor("spring"), {
          start: "01:00",
          end: "02:30",
        });
        yield* notifications.notify(message("spring"));
      }),
    );
    expect(yield* notifications.dueDeliveries()).toEqual([]);
    yield* TestClock.setTime(Date.parse("2026-03-08T07:00:00Z"));
    const due = (yield* notifications.dueDeliveries()).filter((group) => group.channel !== "inapp");
    expect(due).toHaveLength(2);
    for (const group of due)
      expect(group.deliveries[0]?.delivery.dueAt).toBe(Date.parse("2026-03-08T07:00:00Z"));
  }).pipe(Effect.provide(world)),
);

it.effect("keeps a cross-midnight quiet window held through a repeated DST hour", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-01T04:30:00Z"));
    const notifications = yield* Notifications;
    yield* UnitOfWork.atomic(
      Effect.gen(function* () {
        yield* notifications.setMyTimeZone(actor("autumn"), "America/New_York");
        yield* notifications.setMyQuietHours(actor("autumn"), {
          start: "22:00",
          end: "02:00",
        });
        yield* notifications.notify(message("autumn"));
      }),
    );
    yield* TestClock.setTime(Date.parse("2026-11-01T06:59:59Z"));
    expect(yield* notifications.dueDeliveries()).toEqual([]);
    yield* TestClock.setTime(Date.parse("2026-11-01T07:00:00Z"));
    expect(
      (yield* notifications.dueDeliveries()).filter((group) => group.channel !== "inapp"),
    ).toHaveLength(2);
  }).pipe(Effect.provide(world)),
);

it.effect("uses the next local digest time and keeps different people and channels separate", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-01-15T08:00:00Z"));
    const notifications = yield* Notifications;
    yield* UnitOfWork.atomic(
      Effect.gen(function* () {
        for (const id of ["first", "second"]) {
          yield* notifications.setMyPreference(actor(id), {
            category: "news",
            channel: "push",
            mode: "daily",
          });
          yield* notifications.setMyPreference(actor(id), {
            category: "news",
            channel: "email",
            mode: "daily",
          });
          yield* notifications.notify(message(id));
        }
      }),
    );
    const immediate = yield* notifications.dueDeliveries();
    yield* UnitOfWork.atomic(
      notifications.markSent(
        immediate.flatMap((group) => group.deliveries.map((row) => row.delivery.id)),
      ),
    );
    yield* TestClock.setTime(Date.parse("2026-01-16T07:59:59Z"));
    expect(yield* notifications.dueDeliveries()).toEqual([]);
    yield* TestClock.setTime(Date.parse("2026-01-16T08:00:00Z"));
    const due = yield* notifications.dueDeliveries();
    expect(due).toHaveLength(4);
    expect(new Set(due.map((group) => `${group.recipient.id}:${group.channel}`)).size).toBe(4);
    for (const group of due) expect(group.deliveries).toHaveLength(1);
  }).pipe(Effect.provide(world)),
);

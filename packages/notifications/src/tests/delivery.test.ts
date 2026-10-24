import { expect, it } from "@effect/vitest";
import { memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { memoryNotificationStore, NotificationStore, Notifications } from "../index.js";
import { notificationsTesting } from "./notifications.js";
const { actor, options, world, message } = notificationsTesting;

it.effect("holds cross-midnight push and email in a non-UTC zone, never in-app", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-01-15T21:30:00Z"));
    const notifications = yield* Notifications;
    yield* UnitOfWork.atomic(
      Effect.gen(function* () {
        yield* notifications.setMyTimeZone(actor("quiet"), "Europe/Warsaw");
        yield* notifications.setMyQuietHours(actor("quiet"), { start: "22:00", end: "07:00" });
      }),
    );
    yield* UnitOfWork.atomic(notifications.notify(message("quiet")));
    let due = yield* notifications.dueDeliveries();
    expect(due).toEqual([]);
    expect(yield* notifications.unreadCount(actor("quiet"))).toBe(1);
    yield* UnitOfWork.atomic(
      notifications.markSent(
        due.flatMap((group) => group.deliveries.map((row) => row.delivery.id)),
      ),
    );
    yield* TestClock.setTime(Date.parse("2026-01-16T05:59:59Z"));
    expect(yield* notifications.dueDeliveries()).toEqual([]);
    yield* TestClock.setTime(Date.parse("2026-01-16T06:00:00Z"));
    due = yield* notifications.dueDeliveries();
    expect(due.map((group) => group.channel).sort()).toEqual(["email", "push"]);
    for (const group of due) {
      expect(group.deliveries[0]?.delivery.state).toBe("held");
      expect(group.deliveries[0]?.delivery.dueAt).toBe(Date.parse("2026-01-16T06:00:00Z"));
    }
    yield* UnitOfWork.atomic(
      notifications.markSent(
        due.flatMap((group) => group.deliveries.map((row) => row.delivery.id)),
      ),
    );
    expect(yield* notifications.dueDeliveries()).toEqual([]);
  }).pipe(Effect.provide(world)),
);

it.effect("batches hourly and daily digests per recipient and channel at local time", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-01-15T10:15:00Z"));
    const notifications = yield* Notifications;
    yield* UnitOfWork.atomic(
      Effect.gen(function* () {
        yield* notifications.setMyTimeZone(actor("digest"), "Asia/Kolkata");
        yield* notifications.setMyPreference(actor("digest"), {
          category: "news",
          channel: "push",
          mode: "hourly",
        });
        yield* notifications.setMyPreference(actor("digest"), {
          category: "news",
          channel: "email",
          mode: "daily",
        });
        yield* notifications.notify(message("digest"));
        yield* notifications.notify(message("digest"));
      }),
    );
    let due = yield* notifications.dueDeliveries();
    expect(due).toEqual([]);
    expect((yield* notifications.getMyPreferences(actor("digest"))).quietHours).toBeNull();
    yield* UnitOfWork.atomic(
      notifications.markSent(
        due.flatMap((group) => group.deliveries.map((row) => row.delivery.id)),
      ),
    );
    yield* TestClock.setTime(Date.parse("2026-01-15T10:30:00Z"));
    due = yield* notifications.dueDeliveries();
    expect(due).toHaveLength(1);
    expect(due[0]?.channel).toBe("push");
    expect(due[0]?.deliveries).toHaveLength(2);
    yield* UnitOfWork.atomic(
      notifications.markSent(
        due.flatMap((group) => group.deliveries.map((row) => row.delivery.id)),
      ),
    );
    yield* TestClock.setTime(Date.parse("2026-01-16T02:29:59Z"));
    expect(yield* notifications.dueDeliveries()).toEqual([]);
    yield* TestClock.setTime(Date.parse("2026-01-16T02:30:00Z"));
    due = yield* notifications.dueDeliveries();
    expect(due).toHaveLength(1);
    expect(due[0]?.channel).toBe("email");
    expect(due[0]?.deliveries).toHaveLength(2);
    expect(due[0]?.deliveries[0]?.delivery.dueAt).toBe(Date.parse("2026-01-16T02:30:00Z"));
  }).pipe(Effect.provide(world)),
);

it.effect("holds a digest whose due time falls in quiet hours until the window ends", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-01-15T19:15:00Z"));
    const notifications = yield* Notifications;
    yield* UnitOfWork.atomic(
      Effect.gen(function* () {
        yield* notifications.setMyTimeZone(actor("held-digest"), "Europe/Warsaw");
        yield* notifications.setMyQuietHours(actor("held-digest"), {
          start: "21:00",
          end: "07:00",
        });
        yield* notifications.setMyPreference(actor("held-digest"), {
          category: "news",
          channel: "push",
          mode: "hourly",
        });
        yield* notifications.setMyPreference(actor("held-digest"), {
          category: "news",
          channel: "email",
          mode: "off",
        });
        yield* notifications.notify(message("held-digest"));
      }),
    );
    yield* TestClock.setTime(Date.parse("2026-01-15T20:00:00Z"));
    expect(yield* notifications.dueDeliveries()).toEqual([]);
    yield* TestClock.setTime(Date.parse("2026-01-16T06:00:00Z"));
    const due = (yield* notifications.dueDeliveries()).find((group) => group.channel === "push");
    expect(due?.deliveries[0]?.delivery.state).toBe("held");
    expect(due?.deliveries[0]?.delivery.mode).toBe("hourly");
  }).pipe(Effect.provide(world)),
);

it.effect("mandatory categories override stored off/digest modes and quiet hours", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-01-15T23:00:00Z"));
    const store = yield* NotificationStore;
    const notifications = yield* Notifications;
    yield* UnitOfWork.atomic(
      Effect.gen(function* () {
        yield* store.setPreference(
          { kind: "member", id: "mandatory" },
          { category: "security", channel: "email", mode: "off" },
        );
        yield* store.setPreference(
          { kind: "member", id: "mandatory" },
          { category: "security", channel: "push", mode: "daily" },
        );
        yield* notifications.setMyQuietHours(actor("mandatory"), {
          start: "22:00",
          end: "07:00",
        });
        const result = yield* notifications.notify(message("mandatory", "security"));
        expect(result.events[0]?.channels).toEqual(["inapp", "push", "email"]);
      }),
    );
    const due = yield* notifications.dueDeliveries();
    expect(due).toHaveLength(2);
    for (const group of due)
      expect(group.deliveries[0]?.delivery).toMatchObject({
        mode: "immediate",
        state: "pending",
        dueAt: Date.parse("2026-01-15T23:00:00Z"),
      });
  }).pipe(
    Effect.provide(
      Notifications.layer(options).pipe(
        Layer.provideMerge(memoryNotificationStore()),
        Layer.provideMerge(memoryUnitOfWork),
      ),
    ),
  ),
);

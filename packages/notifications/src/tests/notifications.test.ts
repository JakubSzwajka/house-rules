import { expect, it } from "@effect/vitest";
import { memoryUnitOfWork, NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  NotificationCreated,
  NotificationInputInvalid,
  NotificationRead,
  Notifications,
} from "../index.js";
import { notificationsTesting } from "./notifications.js";
const { actor, options, world, message } = notificationsTesting;
class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}

it.effect("uses the configured recipient kind and isolates inbox, reads and preferences", () =>
  Effect.gen(function* () {
    const notifications = yield* Notifications;
    const a = actor("a");
    const b = actor("b");
    const result = yield* UnitOfWork.atomic(
      notifications.notify({
        ...message("a"),
        recipients: [
          { kind: "member", id: "a" },
          { kind: "member", id: "b" },
          { kind: "member", id: "a" },
        ],
      }),
    );
    expect(result.notifications).toHaveLength(2);
    expect(result.events).toHaveLength(2);
    expect(Schema.is(NotificationCreated)(result.events[0])).toBe(true);
    const id = result.notifications[0]?.id ?? "missing";
    expect((yield* notifications.listMine(b)).notifications.map((row) => row.recipient.id)).toEqual(
      ["b"],
    );
    expect((yield* UnitOfWork.atomic(notifications.markRead(b, id))).events).toEqual([]);
    expect(yield* notifications.unreadCount(a)).toBe(1);
    const read = yield* UnitOfWork.atomic(notifications.markRead(a, id));
    expect(read.events).toHaveLength(1);
    expect(Schema.is(NotificationRead)(read.events[0])).toBe(true);
    expect((yield* UnitOfWork.atomic(notifications.markRead(a, id))).events).toEqual([]);
    expect(yield* notifications.unreadCount(a)).toBe(0);
    expect((yield* UnitOfWork.atomic(notifications.markAllRead(b))).events).toHaveLength(1);
    yield* UnitOfWork.atomic(
      notifications.setMyPreference(a, { category: "news", channel: "email", mode: "off" }),
    );
    expect(
      (yield* notifications.getMyPreferences(a)).preferences.find(
        (p) => p.channel === "email" && p.category === "news",
      )?.mode,
    ).toBe("off");
    expect(
      (yield* notifications.getMyPreferences(b)).preferences.find(
        (p) => p.channel === "email" && p.category === "news",
      )?.mode,
    ).toBe("immediate");
  }).pipe(Effect.provide(world)),
);

it.effect("validates config and preferences; all mutations require a unit", () =>
  Effect.gen(function* () {
    const notifications = yield* Notifications;
    expect(yield* Effect.flip(notifications.notify(message("unit")))).toBeInstanceOf(NoOpenUnit);
    expect(yield* Effect.flip(notifications.setMyTimeZone(actor("unit"), "UTC"))).toBeInstanceOf(
      NoOpenUnit,
    );
    expect(
      yield* Effect.flip(UnitOfWork.atomic(notifications.notify(message("invalid", "unknown")))),
    ).toBeInstanceOf(NotificationInputInvalid);
    for (const preference of [
      { category: "security", channel: "email", mode: "off" },
      { category: "news", channel: "inapp", mode: "daily" },
      { category: "unknown", channel: "email", mode: "immediate" },
    ] as const)
      expect(
        yield* Effect.flip(
          UnitOfWork.atomic(notifications.setMyPreference(actor("invalid"), preference)),
        ),
      ).toBeInstanceOf(NotificationInputInvalid);
    expect(
      yield* Effect.flip(
        UnitOfWork.atomic(notifications.setMyTimeZone(actor("invalid"), "Not/A_Zone")),
      ),
    ).toBeInstanceOf(NotificationInputInvalid);
    expect(
      yield* Effect.flip(
        UnitOfWork.atomic(
          notifications.setMyQuietHours(actor("invalid"), {
            start: "07:00",
            end: "07:00",
          }),
        ),
      ),
    ).toBeInstanceOf(NotificationInputInvalid);
  }).pipe(Effect.provide(world)),
);

it.effect(
  "caps pages and selector work and keeps rolled-back notification facts out of storage",
  () =>
    Effect.gen(function* () {
      const notifications = yield* Notifications;
      yield* UnitOfWork.atomic(
        Effect.gen(function* () {
          for (let i = 0; i < 4; i++) yield* notifications.notify(message("paged"));
        }),
      );
      const first = yield* notifications.listMine(actor("paged"), { size: 500 });
      expect(first.notifications).toHaveLength(2);
      expect(first.next).toBeDefined();
      const second = yield* notifications.listMine(
        actor("paged"),
        first.next === undefined ? {} : { cursor: first.next },
      );
      expect(second.notifications).toHaveLength(2);
      expect(second.next).toBeUndefined();
      expect(
        new Set([...first.notifications, ...second.notifications].map((row) => row.id)).size,
      ).toBe(4);
      expect(
        (yield* notifications.dueDeliveries()).flatMap((group) => group.deliveries),
      ).toHaveLength(2);
      expect(
        yield* Effect.flip(
          UnitOfWork.atomic(
            Effect.gen(function* () {
              yield* notifications.notify(message("rolled-back"));
              return yield* new Rollback();
            }),
          ),
        ),
      ).toBeInstanceOf(Rollback);
      expect(yield* notifications.unreadCount(actor("rolled-back"))).toBe(0);
    }).pipe(
      Effect.provide(
        Notifications.layerMemory({ ...options, maxDueBatch: 2 }).pipe(
          Layer.provideMerge(memoryUnitOfWork),
        ),
      ),
    ),
);

it.effect("retains inbox rows when delivery fails and erases all account-owned state", () =>
  Effect.gen(function* () {
    const notifications = yield* Notifications;
    yield* UnitOfWork.atomic(notifications.notify(message("erased")));
    const ids = (yield* notifications.dueDeliveries()).flatMap((group) =>
      group.deliveries.map((row) => row.delivery.id),
    );
    yield* UnitOfWork.atomic(
      Effect.gen(function* () {
        for (const id of ids) yield* notifications.markFailed(id, "private provider error");
      }),
    );
    yield* TestClock.adjust(2000);
    const retried = yield* notifications.dueDeliveries();
    expect(
      retried.flatMap((group) => group.deliveries.map((row) => row.delivery.id)).sort(),
    ).toEqual(ids.sort());
    expect(retried[0]?.deliveries[0]?.delivery.attempts).toBe(1);
    expect(yield* notifications.unreadCount(actor("erased"))).toBe(1);
    yield* UnitOfWork.atomic(notifications.erase({ kind: "member", id: "erased" }));
    expect(yield* notifications.unreadCount(actor("erased"))).toBe(0);
    expect(yield* notifications.dueDeliveries()).toEqual([]);
  }).pipe(Effect.provide(world)),
);

import { describe, expect, it } from "@effect/vitest";
import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { NotificationStore, Notifications } from "../../index.js";
import { notificationsTesting } from "../../tests/notifications.js";
import { stores } from "./stores.js";
const { actor, options, message } = notificationsTesting;
const ref = (id: string) => ({ kind: "member", id });
const instant = (time: string) => Date.parse(`2026-01-15T${time}:00Z`);

for (const { name, layer: storage } of stores) {
  const world = Notifications.layer({
    ...options,
    maxDueBatch: 1,
    maxAttempts: 3,
    retryBaseMs: 100,
    retryCapMs: 300,
  }).pipe(Layer.provideMerge(storage));
  describe(`Notification delivery on ${name}`, { timeout: 30_000 }, () => {
    it.effect("reselects retries after capped backoff, then leaves a terminal failed row", () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(1000);
        const notifications = yield* Notifications;
        const store = yield* NotificationStore;
        yield* UnitOfWork.atomic(notifications.notify(message("retry")));
        const first = (yield* notifications.dueDeliveries())[0]?.deliveries[0]?.delivery;
        expect(first).toBeDefined();
        const id = first?.id ?? "missing";
        for (const [attempt, at, dueAt] of [
          [1, 1000, 1200],
          [2, 1200, 1500],
        ] as const) {
          yield* TestClock.setTime(at);
          yield* UnitOfWork.atomic(notifications.markFailed(id, `failure ${attempt}`));
          expect(
            (yield* store.deliveries(ref("retry"))).find((row) => row.delivery.id === id)?.delivery,
          ).toMatchObject({
            state: "pending",
            attempts: attempt,
            dueAt,
            retryAt: dueAt,
            lastError: `failure ${attempt}`,
          });
          // Settle the other external channel so it cannot hide a retry at the group cap.
          const other = (yield* notifications.dueDeliveries()).flatMap((group) =>
            group.deliveries.map((row) => row.delivery.id),
          );
          yield* UnitOfWork.atomic(notifications.markSent(other));
          yield* TestClock.setTime(dueAt - 1);
          expect(yield* notifications.dueDeliveries()).toEqual([]);
          yield* TestClock.setTime(dueAt);
          expect((yield* notifications.dueDeliveries())[0]?.deliveries[0]?.delivery).toMatchObject({
            id,
            state: "pending",
            attempts: attempt,
          });
        }
        yield* UnitOfWork.atomic(notifications.markFailed(id, "dead end"));
        const terminal = (yield* store.deliveries(ref("retry"))).find(
          (row) => row.delivery.id === id,
        )?.delivery;
        expect(terminal).toMatchObject({ state: "failed", attempts: 3, lastError: "dead end" });
        yield* UnitOfWork.atomic(notifications.markFailed(id, "late failure"));
        yield* UnitOfWork.atomic(notifications.markSent([id]));
        expect(
          (yield* store.deliveries(ref("retry"))).find((row) => row.delivery.id === id)?.delivery,
        ).toEqual(terminal);
        yield* TestClock.setTime(1_000_000);
        expect(yield* notifications.dueDeliveries()).toEqual([]);
        expect(yield* notifications.unreadCount(actor("retry"))).toBe(1);
      }).pipe(Effect.provide(world)),
    );

    it.effect(
      "never queues in-app work, so 101 inbox-only notifications cannot starve senders",
      () =>
        Effect.gen(function* () {
          const notifications = yield* Notifications;
          const store = yield* NotificationStore;
          yield* UnitOfWork.atomic(
            Effect.gen(function* () {
              for (const channel of ["push", "email"] as const)
                yield* notifications.setMyPreference(actor("inbox"), {
                  category: "news",
                  channel,
                  mode: "off",
                });
              for (let i = 0; i < 101; i++) yield* notifications.notify(message("inbox"));
              const created = yield* notifications.notify(message("external"));
              expect(created.events[0]?.channels).toEqual(["inapp", "push", "email"]);
            }),
          );
          expect(yield* store.deliveries(ref("inbox"))).toEqual([]);
          expect(yield* notifications.unreadCount(actor("inbox"))).toBe(101);
          const seen: string[] = [];
          for (let i = 0; i < 2; i++) {
            const groups = yield* notifications.dueDeliveries();
            expect(groups).toHaveLength(1);
            seen.push(...groups.map((group) => group.channel));
            yield* UnitOfWork.atomic(
              notifications.markSent(
                groups.flatMap((group) => group.deliveries.map((row) => row.delivery.id)),
              ),
            );
          }
          expect(seen.sort()).toEqual(["email", "push"]);
        }).pipe(Effect.provide(world)),
    );

    it.effect(
      "keeps hourly and daily groups separate and never splits a group at the batch cap",
      () =>
        Effect.gen(function* () {
          const notifications = yield* Notifications;
          const store = yield* NotificationStore;
          yield* UnitOfWork.atomic(
            Effect.gen(function* () {
              for (const [category, mode] of [
                ["news", "hourly"],
                ["updates", "daily"],
              ] as const) {
                yield* notifications.setMyPreference(actor("group"), {
                  category,
                  channel: "email",
                  mode,
                });
                for (let i = 0; i < 3; i++) yield* notifications.notify(message("group", category));
              }
            }),
          );
          yield* TestClock.setTime(instant("08:00"));
          const modes: string[] = [];
          for (let i = 0; i < 2; i++) {
            const groups = yield* notifications.dueDeliveries();
            expect(groups).toHaveLength(1);
            const group = groups[0];
            expect(group?.deliveries).toHaveLength(3);
            expect(new Set(group?.deliveries.map((row) => row.delivery.mode)).size).toBe(1);
            modes.push(group?.mode ?? "missing");
            yield* UnitOfWork.atomic(
              notifications.markSent(
                groups.flatMap((g) => g.deliveries.map((row) => row.delivery.id)),
              ),
            );
          }
          expect(modes.sort()).toEqual(["daily", "hourly"]);
          expect(yield* notifications.dueDeliveries()).toEqual([]);
          expect(
            (yield* store.deliveries(ref("group"))).every((row) => row.delivery.state === "sent"),
          ).toBe(true);
        }).pipe(
          Effect.provide(
            Notifications.layer({
              ...options,
              categories: [
                { name: "news", defaultChannels: ["email"], mandatory: false },
                { name: "updates", defaultChannels: ["email"], mandatory: false },
              ],
              maxDueBatch: 1,
            }).pipe(Layer.provideMerge(storage)),
          ),
          (effect) => Effect.andThen(TestClock.setTime(instant("07:15")), effect),
        ),
    );
  });
}

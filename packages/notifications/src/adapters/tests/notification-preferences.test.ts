import { describe, expect, it } from "@effect/vitest";
import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { NotificationStore, Notifications } from "../../index.js";
import { notificationsTesting } from "../../tests/notifications.js";
import { stores } from "./stores.js";
const { actor, options, message } = notificationsTesting;
const ref = (id: string) => ({ kind: "member", id });
const instant = (time: string) => Date.parse(`2026-01-15T${time}:00Z`);
class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}

for (const { name, layer: storage } of stores) {
  const world = Notifications.layer(options).pipe(Layer.provideMerge(storage));
  describe(`Notification preferences on ${name}`, { timeout: 30_000 }, () => {
    it.effect(
      "uses the person's zone for digests without quiet hours, and UTC only when unset",
      () =>
        Effect.gen(function* () {
          const notifications = yield* Notifications;
          const store = yield* NotificationStore;
          const owner = actor("zone-digests");
          yield* UnitOfWork.atomic(
            Effect.gen(function* () {
              yield* notifications.setMyTimeZone(owner, "Asia/Kolkata");
              yield* notifications.setMyPreference(owner, {
                category: "news",
                channel: "push",
                mode: "hourly",
              });
              yield* notifications.setMyPreference(owner, {
                category: "news",
                channel: "email",
                mode: "daily",
              });
              yield* notifications.notify(message("zone-digests"));
            }),
          );
          expect((yield* notifications.getMyPreferences(owner)).quietHours).toBeNull();
          const rows = yield* store.deliveries(ref("zone-digests"));
          expect(rows.find((row) => row.delivery.channel === "push")?.delivery.dueAt).toBe(
            instant("10:30"),
          );
          expect(rows.find((row) => row.delivery.channel === "email")?.delivery.dueAt).toBe(
            Date.parse("2026-01-16T02:30:00Z"),
          );
          yield* UnitOfWork.atomic(notifications.setMyTimeZone(owner, null));
          const utc = yield* store.deliveries(ref("zone-digests"));
          expect(utc.find((row) => row.delivery.channel === "push")?.delivery.dueAt).toBe(
            instant("11:00"),
          );
          expect(utc.find((row) => row.delivery.channel === "email")?.delivery.dueAt).toBe(
            Date.parse("2026-01-16T08:00:00Z"),
          );
        }).pipe(Effect.provide(world), (effect) =>
          // Set the epoch before acquiring the SQL pool, not across decades of idle timers.
          Effect.andThen(TestClock.setTime(instant("10:15")), effect),
        ),
    );

    it.effect(
      "refreshes queued digests on quiet hours, zone and mode changes, but not mandatory rows",
      () =>
        Effect.gen(function* () {
          const notifications = yield* Notifications;
          const store = yield* NotificationStore;
          const owner = actor("refresh");
          const rows = () => store.deliveries(ref("refresh"));
          yield* UnitOfWork.atomic(
            Effect.gen(function* () {
              yield* notifications.setMyPreference(owner, {
                category: "news",
                channel: "email",
                mode: "hourly",
              });
              yield* notifications.notify(message("refresh"));
              yield* notifications.notify(message("refresh", "security"));
            }),
          );
          const mandatory = (yield* rows()).filter(
            (row) => row.notification.category === "security",
          );
          const email = (yield* rows()).find(
            (row) => row.notification.category === "news" && row.delivery.channel === "email",
          );
          expect(email?.delivery).toMatchObject({ state: "pending", dueAt: instant("11:00") });
          yield* UnitOfWork.atomic(
            notifications.setMyQuietHours(owner, { start: "11:00", end: "12:00" }),
          );
          expect(
            (yield* rows()).find((row) => row.delivery.id === email?.delivery.id)?.delivery,
          ).toMatchObject({ state: "held", dueAt: instant("12:00") });
          yield* UnitOfWork.atomic(
            notifications.setMyQuietHours(owner, { start: "16:00", end: "17:00" }),
          );
          expect(
            (yield* rows()).find((row) => row.delivery.id === email?.delivery.id)?.delivery,
          ).toMatchObject({ state: "pending", dueAt: instant("11:00") });
          yield* UnitOfWork.atomic(notifications.setMyTimeZone(owner, "Asia/Kolkata"));
          expect(
            (yield* rows()).find((row) => row.delivery.id === email?.delivery.id)?.delivery,
          ).toMatchObject({ state: "held", dueAt: instant("11:30") });
          expect((yield* notifications.getMyPreferences(owner)).timeZone).toBe("Asia/Kolkata");
          expect((yield* notifications.getMyPreferences(actor("other"))).timeZone).toBeNull();
          yield* UnitOfWork.atomic(
            notifications.setMyPreference(owner, {
              category: "news",
              channel: "email",
              mode: "immediate",
            }),
          );
          expect(
            (yield* rows()).find((row) => row.delivery.id === email?.delivery.id)?.delivery,
          ).toMatchObject({ mode: "immediate", state: "pending", dueAt: instant("10:15") });
          for (const channel of ["email", "push"] as const)
            yield* UnitOfWork.atomic(
              notifications.setMyPreference(owner, { category: "news", channel, mode: "off" }),
            );
          const cancelled = (yield* rows()).filter((row) => row.notification.category === "news");
          expect(cancelled).toHaveLength(2);
          for (const row of cancelled)
            expect(row.delivery).toMatchObject({ state: "cancelled", sentAt: null, attempts: 0 });
          yield* UnitOfWork.atomic(notifications.markSent(cancelled.map((row) => row.delivery.id)));
          expect((yield* rows()).filter((row) => row.notification.category === "news")).toEqual(
            cancelled,
          );
          expect((yield* rows()).filter((row) => row.notification.category === "security")).toEqual(
            mandatory,
          );
          yield* UnitOfWork.atomic(notifications.setMyTimeZone(owner, null));
          expect((yield* notifications.getMyPreferences(owner)).timeZone).toBeNull();
          expect(
            (yield* rows()).find((row) => row.delivery.id === email?.delivery.id)?.delivery.state,
          ).toBe("cancelled");
        }).pipe(Effect.provide(world), (effect) =>
          Effect.andThen(TestClock.setTime(instant("10:15")), effect),
        ),
    );

    it.effect("requests only unsettled ledger rows for every preference refresh", () => {
      const queries: unknown[] = [];
      const observed = Layer.effect(
        NotificationStore,
        Effect.map(NotificationStore, (store) =>
          NotificationStore.of({
            ...store,
            deliveries: (recipient, query) => {
              queries.push(query);
              return store.deliveries(recipient, query);
            },
          }),
        ),
      ).pipe(Layer.provideMerge(storage));
      return Effect.gen(function* () {
        const notifications = yield* Notifications;
        const owner = actor("refresh-query");
        yield* UnitOfWork.atomic(
          Effect.gen(function* () {
            yield* notifications.setMyPreference(owner, {
              category: "news",
              channel: "email",
              mode: "hourly",
            });
            yield* notifications.setMyQuietHours(owner, { start: "22:00", end: "07:00" });
            yield* notifications.setMyTimeZone(owner, "Asia/Kolkata");
          }),
        );
        expect(queries).toEqual([
          { unsettledOnly: true },
          { unsettledOnly: true },
          { unsettledOnly: true },
        ]);
      }).pipe(Effect.provide(Notifications.layer(options).pipe(Layer.provideMerge(observed))));
    });

    it.effect("recomputes retry holds on preference changes without shortening backoff", () =>
      Effect.gen(function* () {
        const notifications = yield* Notifications;
        const store = yield* NotificationStore;
        const owner = actor("retry-refresh");
        const rows = () => store.deliveries(ref(owner.id));
        yield* UnitOfWork.atomic(notifications.notify(message(owner.id)));
        const id = (yield* rows()).find((row) => row.delivery.channel === "push")?.delivery.id;
        expect(id).toBeDefined();
        const retryId = id ?? "missing";
        const current = () =>
          rows().pipe(Effect.map((items) => items.find((row) => row.delivery.id === retryId)));
        const backoff = instant("10:15") + 2000;
        yield* UnitOfWork.atomic(notifications.markFailed(retryId, "try again"));
        expect((yield* current())?.delivery).toMatchObject({
          state: "pending",
          dueAt: backoff,
          attempts: 1,
        });
        yield* UnitOfWork.atomic(
          notifications.setMyQuietHours(owner, { start: "10:00", end: "12:00" }),
        );
        expect((yield* current())?.delivery).toMatchObject({
          state: "held",
          dueAt: instant("12:00"),
        });
        yield* UnitOfWork.atomic(
          notifications.setMyQuietHours(owner, { start: "10:00", end: "11:00" }),
        );
        expect((yield* current())?.delivery).toMatchObject({
          state: "held",
          dueAt: instant("11:00"),
        });
        yield* UnitOfWork.atomic(notifications.setMyTimeZone(owner, "Asia/Kolkata"));
        expect((yield* current())?.delivery).toMatchObject({ state: "pending", dueAt: backoff });
        yield* UnitOfWork.atomic(
          notifications.setMyQuietHours(owner, { start: "15:00", end: "18:00" }),
        );
        expect((yield* current())?.delivery).toMatchObject({
          state: "held",
          dueAt: instant("12:30"),
        });
        yield* UnitOfWork.atomic(notifications.setMyQuietHours(owner, null));
        expect((yield* current())?.delivery).toMatchObject({ state: "pending", dueAt: backoff });
        yield* UnitOfWork.atomic(
          notifications.setMyPreference(owner, {
            category: "news",
            channel: "push",
            mode: "hourly",
          }),
        );
        expect((yield* current())?.delivery).toMatchObject({
          state: "pending",
          dueAt: instant("10:30"),
        });
        yield* UnitOfWork.atomic(
          notifications.setMyPreference(owner, {
            category: "news",
            channel: "push",
            mode: "immediate",
          }),
        );
        expect((yield* current())?.delivery).toMatchObject({ state: "pending", dueAt: backoff });
        yield* TestClock.setTime(backoff - 1);
        expect(
          (yield* notifications.dueDeliveries()).flatMap((group) =>
            group.deliveries.map((row) => row.delivery.id),
          ),
        ).not.toContain(retryId);
        yield* TestClock.setTime(backoff);
        expect(
          (yield* notifications.dueDeliveries()).flatMap((group) =>
            group.deliveries.map((row) => row.delivery.id),
          ),
        ).toContain(retryId);
      }).pipe(Effect.provide(world), (effect) =>
        Effect.andThen(TestClock.setTime(instant("10:15")), effect),
      ),
    );

    it.effect("rolls preference, zone, quiet hours and refreshed rows back in the same unit", () =>
      Effect.gen(function* () {
        const notifications = yield* Notifications;
        const store = yield* NotificationStore;
        const owner = actor("rollback-refresh");
        yield* UnitOfWork.atomic(notifications.notify(message("rollback-refresh")));
        const before = yield* store.deliveries(ref("rollback-refresh"));
        expect(
          yield* Effect.flip(
            UnitOfWork.atomic(
              Effect.gen(function* () {
                yield* notifications.setMyQuietHours(owner, { start: "10:00", end: "12:00" });
                yield* notifications.setMyTimeZone(owner, "Asia/Kolkata");
                yield* notifications.setMyPreference(owner, {
                  category: "news",
                  channel: "email",
                  mode: "off",
                });
                return yield* new Rollback();
              }),
            ),
          ),
        ).toBeInstanceOf(Rollback);
        expect(yield* store.deliveries(ref("rollback-refresh"))).toEqual(before);
        expect(yield* notifications.getMyPreferences(owner)).toMatchObject({
          quietHours: null,
          timeZone: null,
        });
        expect(yield* store.preferences(ref("rollback-refresh"))).toEqual([]);
      }).pipe(Effect.provide(world), (effect) =>
        Effect.andThen(TestClock.setTime(instant("10:15")), effect),
      ),
    );
  });
}

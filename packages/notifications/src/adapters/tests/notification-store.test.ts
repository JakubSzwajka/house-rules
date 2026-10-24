import { expect, layer } from "@effect/vitest";
import { NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import {
  type Delivery,
  type Notification,
  NotificationStore,
  NotificationStoreUnavailable,
} from "../../index.js";
import { stores } from "./stores.js";
class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}
const retry = { maxAttempts: 3, baseMs: 100, capMs: 300 };
const recipient = (id: string) => ({ kind: "person", id });
const record = (id: string, owner = id, createdAt = 100): Notification => ({
  id,
  recipient: recipient(owner),
  category: "news",
  title: "Title",
  body: "Body",
  data: { nested: [true, "value", 1, null] },
  createdAt,
  readAt: null,
});
const delivery = (id: string, owner = id, dueAt = 100): Delivery => ({
  id: `d-${id}`,
  notificationId: id,
  recipient: recipient(owner),
  channel: "email",
  mode: "immediate",
  state: "pending",
  dueAt,
  retryAt: null,
  sentAt: null,
  attempts: 0,
  lastError: null,
});
for (const { name, layer: world } of stores)
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `NotificationStore on ${name}`,
    (it) => {
      it.effect("stores JSON, filters inbox by recipient and pages newest first", () =>
        Effect.gen(function* () {
          const store = yield* NotificationStore;
          yield* UnitOfWork.atomic(
            Effect.forEach(
              [
                record("list-a", "list"),
                record("list-b", "list"),
                record("list-c", "list", 101),
                record("list-private", "private"),
              ],
              (row) => store.insert(row, []),
            ),
          );
          expect((yield* store.list(recipient("list"), { size: 2 })).map((row) => row.id)).toEqual([
            "list-c",
            "list-b",
          ]);
          const page = yield* store.list(recipient("list"), {
            size: 2,
            after: { createdAt: 100, id: "list-b" },
          });
          expect(page).toEqual([record("list-a", "list")]);
          expect(yield* store.list({ kind: "org", id: "list" }, { size: 10 })).toEqual([]);
          expect(yield* store.unreadCount(recipient("list"))).toBe(3);
          expect(
            yield* UnitOfWork.atomic(store.markRead(recipient("private"), 200, "list-a")),
          ).toEqual([]);
          expect(
            (yield* UnitOfWork.atomic(store.markRead(recipient("list"), 200, "list-a")))[0]?.readAt,
          ).toBe(200);
          expect(
            yield* UnitOfWork.atomic(store.markRead(recipient("list"), 300, "list-a")),
          ).toEqual([]);
          expect(yield* store.unreadCount(recipient("list"))).toBe(2);
          expect(yield* UnitOfWork.atomic(store.markRead(recipient("list"), 400))).toHaveLength(2);
        }),
      );
      it.effect("upserts preferences and quiet hours without leaking between recipients", () =>
        Effect.gen(function* () {
          const store = yield* NotificationStore;
          const ref = recipient("preferences");
          yield* UnitOfWork.atomic(
            Effect.gen(function* () {
              yield* store.setPreference(ref, { category: "news", channel: "email", mode: "off" });
              yield* store.setPreference(ref, {
                category: "news",
                channel: "email",
                mode: "daily",
              });
              yield* store.setQuietHours(ref, {
                start: "22:00",
                end: "07:00",
              });
              yield* store.setTimeZone(ref, "Europe/Warsaw");
            }),
          );
          expect(yield* store.preferences(ref)).toEqual([
            { category: "news", channel: "email", mode: "daily" },
          ]);
          expect(yield* store.quietHours(ref)).toEqual({ start: "22:00", end: "07:00" });
          expect(yield* store.timeZone(ref)).toBe("Europe/Warsaw");
          expect(yield* store.timeZone(recipient("someone-else"))).toBeNull();
          expect(yield* store.preferences(recipient("someone-else"))).toEqual([]);
          expect(yield* store.quietHours(recipient("someone-else"))).toBeNull();
          yield* UnitOfWork.atomic(store.setQuietHours(ref, null));
          expect(yield* store.quietHours(ref)).toBeNull();
        }),
      );
      it.effect(
        "bounds and orders due work, excludes future/sent/failed and settles idempotently",
        () =>
          Effect.gen(function* () {
            const store = yield* NotificationStore;
            yield* UnitOfWork.atomic(
              Effect.gen(function* () {
                for (const id of ["due-a", "due-b", "due-held", "due-future", "due-failed"]) {
                  const row = delivery(id, "due", id === "due-future" ? 1000 : 100);
                  yield* store.insert(record(id, "due"), [
                    { ...row, state: id === "due-held" ? "held" : "pending" },
                  ]);
                }
                yield* store.markFailed("d-due-failed", "provider detail", 100, {
                  ...retry,
                  maxAttempts: 1,
                });
              }),
            );
            expect((yield* store.due(100, 2)).map((row) => row.delivery.id)).toEqual([
              "d-due-a",
              "d-due-b",
            ]);
            expect((yield* store.due(100, 10)).map((row) => row.delivery.id)).toEqual([
              "d-due-a",
              "d-due-b",
              "d-due-held",
            ]);
            yield* UnitOfWork.atomic(store.markSent(["d-due-a", "d-due-a", "missing"], 200));
            const sent = (yield* store.deliveries(recipient("due"))).find(
              (row) => row.delivery.id === "d-due-a",
            )?.delivery;
            expect(sent).toMatchObject({ state: "sent", sentAt: 200, attempts: 1 });
            yield* UnitOfWork.atomic(store.markSent(["d-due-a"], 300));
            expect(
              (yield* store.deliveries(recipient("due"))).find(
                (row) => row.delivery.id === "d-due-a",
              )?.delivery,
            ).toEqual(sent);
            yield* UnitOfWork.atomic(store.markFailed("d-due-a", "late failure", 400, retry));
            expect(
              (yield* store.deliveries(recipient("due"))).find(
                (row) => row.delivery.id === "d-due-a",
              )?.delivery,
            ).toEqual(sent);
            expect((yield* store.due(100, 10)).map((row) => row.delivery.id)).toEqual([
              "d-due-b",
              "d-due-held",
            ]);
            expect(yield* store.unreadCount(recipient("due"))).toBe(5);
          }),
      );
      it.effect("loads only unsettled rows for refresh without reading terminal history", () =>
        Effect.gen(function* () {
          const store = yield* NotificationStore;
          const owner = recipient("refresh-query");
          yield* UnitOfWork.atomic(
            Effect.gen(function* () {
              for (const state of ["pending", "held", "sent", "failed", "cancelled"] as const) {
                const id = `refresh-query-${state}`;
                yield* store.insert(record(id, owner.id), [
                  { ...delivery(id, owner.id, 9999), state },
                ]);
              }
              yield* store.insert(record("refresh-query-other", "other"), [
                delivery("refresh-query-other", "other"),
              ]);
            }),
          );
          expect(yield* store.deliveries(owner)).toHaveLength(5);
          expect(
            (yield* store.deliveries(owner, { unsettledOnly: true })).map(
              (row) => row.delivery.state,
            ),
          ).toEqual(["held", "pending"]);
          expect(
            yield* store.deliveries({ kind: "org", id: owner.id }, { unsettledOnly: true }),
          ).toEqual([]);
        }),
      );
      it.effect("rejects duplicate natural delivery keys", () =>
        Effect.gen(function* () {
          const store = yield* NotificationStore;
          const row = delivery("duplicate");
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                store.insert(record("duplicate"), [row, { ...row, id: "another-id" }]),
              ),
            ),
          ).toBeInstanceOf(NotificationStoreUnavailable);
          expect(yield* store.list(recipient("duplicate"), { size: 10 })).toEqual([]);
        }),
      );
      it.effect("requires a live unit for every write", () =>
        Effect.gen(function* () {
          const store = yield* NotificationStore;
          const ref = recipient("outside");
          const writes = [
            store.insert(record("outside"), []),
            store.markRead(ref, 100),
            store.setPreference(ref, { category: "news", channel: "email", mode: "off" }),
            store.setQuietHours(ref, null),
            store.markSent([], 100),
            store.markFailed("outside", "error", 100, retry),
            store.setTimeZone(ref, "UTC"),
            store.reschedule("outside", { mode: "daily", state: "cancelled", dueAt: 100 }),
            store.erase(ref),
          ];
          for (const write of writes) expect(yield* Effect.flip(write)).toBeInstanceOf(NoOpenUnit);
        }),
      );
      it.effect("rolls back the inbox, ledger, preferences and cascades together", () =>
        Effect.gen(function* () {
          const store = yield* NotificationStore;
          const ref = recipient("rollback");
          yield* UnitOfWork.atomic(
            Effect.gen(function* () {
              yield* store.insert(record("rollback", "rollback"), [
                delivery("rollback", "rollback", 9999),
              ]);
              yield* store.setPreference(ref, {
                category: "news",
                channel: "push",
                mode: "hourly",
              });
              yield* store.setQuietHours(ref, {
                start: "22:00",
                end: "07:00",
              });
              yield* store.setTimeZone(ref, "America/New_York");
            }),
          );
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                Effect.gen(function* () {
                  yield* store.markFailed("d-rollback", "retry before rollback", 100, retry);
                  yield* store.reschedule("d-rollback", {
                    mode: "hourly",
                    state: "held",
                    dueAt: 20_000,
                  });
                  yield* store.markRead(ref, 200);
                  yield* store.markSent(["d-rollback"], 200);
                  yield* store.markFailed("d-rollback", "ignored", 300, retry);
                  yield* store.setTimeZone(ref, "UTC");
                  yield* store.setPreference(ref, {
                    category: "news",
                    channel: "push",
                    mode: "off",
                  });
                  yield* store.erase(ref);
                  yield* store.insert(record("new-rollback"), [delivery("new-rollback")]);
                  return yield* new Rollback();
                }),
              ),
            ),
          ).toBeInstanceOf(Rollback);
          expect(yield* store.unreadCount(ref)).toBe(1);
          expect((yield* store.preferences(ref))[0]?.mode).toBe("hourly");
          expect(yield* store.quietHours(ref)).not.toBeNull();
          expect(yield* store.timeZone(ref)).toBe("America/New_York");
          expect(yield* store.list(recipient("new-rollback"), { size: 1 })).toEqual([]);
          expect(
            (yield* store.due(9999, 100)).find((row) => row.delivery.id === "d-rollback")?.delivery,
          ).toEqual(delivery("rollback", "rollback", 9999));
          yield* UnitOfWork.atomic(store.erase(ref));
          expect(yield* store.list(ref, { size: 10 })).toEqual([]);
          expect(yield* store.preferences(ref)).toEqual([]);
          expect(yield* store.quietHours(ref)).toBeNull();
          expect(yield* store.timeZone(ref)).toBeNull();
          expect(
            (yield* store.due(9999, 100)).find((row) => row.delivery.id === "d-rollback"),
          ).toBeUndefined();
        }),
      );
      it.effect("returns defensive copies", () =>
        Effect.gen(function* () {
          const store = yield* NotificationStore;
          const row = record("copies");
          yield* UnitOfWork.atomic(store.insert(row, [delivery("copies", "copies", 20000)]));
          const [first] = yield* store.list(recipient("copies"), { size: 1 });
          if (first !== undefined) Object.assign(first, { title: "mutated" });
          expect((yield* store.list(recipient("copies"), { size: 1 }))[0]?.title).toBe("Title");
        }),
      );
    },
  );

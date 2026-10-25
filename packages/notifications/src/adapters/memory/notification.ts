import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  type Delivery,
  type Notification,
  NotificationStoreUnavailable,
  type Preference,
  type QuietHours,
  type Recipient,
} from "../../notification/notification.js";
import { NotificationStore } from "../../storage.js";
const same = (a: Recipient, b: Recipient) => a.kind === b.kind && a.id === b.id;
const key = (recipient: Recipient) => JSON.stringify([recipient.kind, recipient.id]);
export const memoryNotificationStore = (): Layer.Layer<NotificationStore> =>
  Layer.sync(NotificationStore, () => {
    const notifications = new Map<string, Notification>();
    const deliveries = new Map<string, Delivery>();
    const preferences = new Map<string, readonly Preference[]>();
    const quiet = new Map<string, QuietHours>();
    const timeZones = new Map<string, string>();
    const change = Effect.fn("NotificationStore.memory.change")(function* (run: () => void) {
      yield* UnitOfWork.required;
      const snapshots = [
        new Map(notifications),
        new Map(deliveries),
        new Map(preferences),
        new Map(quiet),
        new Map(timeZones),
      ] as const;
      yield* UnitOfWork.onRollback(
        Effect.sync(() => {
          notifications.clear();
          for (const [id, row] of snapshots[0]) notifications.set(id, row);
          deliveries.clear();
          for (const [id, row] of snapshots[1]) deliveries.set(id, row);
          preferences.clear();
          for (const [id, rows] of snapshots[2]) preferences.set(id, rows);
          quiet.clear();
          for (const [id, row] of snapshots[3]) quiet.set(id, row);
          timeZones.clear();
          for (const [id, row] of snapshots[4]) timeZones.set(id, row);
        }),
      );
      run();
    });
    return NotificationStore.of({
      insert: Effect.fn("NotificationStore.memory.insert")(function* (
        notification: Notification,
        rows: readonly Delivery[],
      ) {
        yield* UnitOfWork.required;
        const naturalKeys = rows.map((row) =>
          JSON.stringify([row.notificationId, row.channel, key(row.recipient)]),
        );
        if (
          notifications.has(notification.id) ||
          new Set(rows.map((row) => row.id)).size !== rows.length ||
          new Set(naturalKeys).size !== rows.length ||
          rows.some(
            (row) =>
              deliveries.has(row.id) ||
              row.notificationId !== notification.id ||
              !same(row.recipient, notification.recipient),
          )
        )
          return yield* new NotificationStoreUnavailable({
            cause: "Duplicate or inconsistent notification delivery.",
          });
        yield* change(() => {
          notifications.set(notification.id, structuredClone(notification));
          for (const row of rows) deliveries.set(row.id, structuredClone(row));
        });
      }),
      list: (recipient, page) =>
        Effect.sync(() =>
          [...notifications.values()]
            .filter(
              (row) =>
                same(row.recipient, recipient) &&
                (page.after === undefined ||
                  row.createdAt < page.after.createdAt ||
                  (row.createdAt === page.after.createdAt && row.id < page.after.id)),
            )
            .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id === b.id ? 0 : -1))
            .slice(0, page.size)
            .map((row) => structuredClone(row)),
        ),
      unreadCount: (recipient) =>
        Effect.sync(
          () =>
            [...notifications.values()].filter(
              (row) => same(row.recipient, recipient) && row.readAt === null,
            ).length,
        ),
      markRead: Effect.fn("NotificationStore.memory.markRead")(function* (
        recipient: Recipient,
        at: number,
        id?: string,
      ) {
        const changed: Notification[] = [];
        yield* change(() => {
          for (const [rowId, row] of notifications)
            if (
              same(row.recipient, recipient) &&
              row.readAt === null &&
              (id === undefined || rowId === id)
            ) {
              const next = { ...row, readAt: at };
              notifications.set(rowId, next);
              changed.push(structuredClone(next));
            }
        });
        return changed.sort((a, b) => (a.id < b.id ? -1 : a.id === b.id ? 0 : 1));
      }),
      preferences: (recipient) =>
        Effect.sync(() => structuredClone(preferences.get(key(recipient)) ?? [])),
      setPreference: (recipient, preference) =>
        change(() => {
          const entries = preferences.get(key(recipient)) ?? [];
          preferences.set(key(recipient), [
            ...entries.filter(
              (row) => row.category !== preference.category || row.channel !== preference.channel,
            ),
            structuredClone(preference),
          ]);
        }),
      quietHours: (recipient) =>
        Effect.sync(() => structuredClone(quiet.get(key(recipient)) ?? null)),
      setQuietHours: (recipient, hours) =>
        change(() => {
          if (hours === null) quiet.delete(key(recipient));
          else quiet.set(key(recipient), structuredClone(hours));
        }),
      timeZone: (recipient) => Effect.sync(() => timeZones.get(key(recipient)) ?? null),
      setTimeZone: (recipient, timeZone) =>
        change(() => {
          if (timeZone === null) timeZones.delete(key(recipient));
          else timeZones.set(key(recipient), timeZone);
        }),
      deliveries: (recipient, query) =>
        Effect.sync(() =>
          [...deliveries.values()]
            .filter(
              (row) =>
                same(row.recipient, recipient) &&
                (!query?.unsettledOnly || row.state === "pending" || row.state === "held"),
            )
            .sort((a, b) => (a.id < b.id ? -1 : a.id === b.id ? 0 : 1))
            .flatMap((delivery) => {
              const notification = notifications.get(delivery.notificationId);
              return notification === undefined
                ? []
                : [structuredClone({ delivery, notification })];
            }),
        ),
      delivery: (id) =>
        Effect.sync(() => {
          const delivery = deliveries.get(id);
          const notification =
            delivery === undefined ? undefined : notifications.get(delivery.notificationId);
          return delivery === undefined || notification === undefined
            ? null
            : structuredClone({ delivery, notification });
        }),
      reschedule: (id, schedule) =>
        change(() => {
          const row = deliveries.get(id);
          if (row !== undefined && (row.state === "pending" || row.state === "held"))
            deliveries.set(id, {
              ...row,
              mode: schedule.mode,
              state: schedule.state,
              dueAt: schedule.dueAt,
            });
        }),
      due: (at, limit) =>
        Effect.sync(() => {
          const rows = [...deliveries.values()]
            .filter((row) => (row.state === "pending" || row.state === "held") && row.dueAt <= at)
            .sort((a, b) => a.dueAt - b.dueAt || (a.id < b.id ? -1 : a.id === b.id ? 0 : 1));
          const groups = new Set<string>();
          return rows
            .filter((row) => {
              const group =
                row.mode === "immediate"
                  ? row.id
                  : JSON.stringify([key(row.recipient), row.channel, row.mode]);
              if (!groups.has(group) && groups.size >= limit) return false;
              groups.add(group);
              return true;
            })
            .flatMap((delivery) => {
              const notification = notifications.get(delivery.notificationId);
              return notification === undefined
                ? []
                : [structuredClone({ delivery, notification })];
            });
        }),
      markSent: (ids, at) =>
        change(() => {
          for (const id of new Set(ids)) {
            const row = deliveries.get(id);
            if (
              row !== undefined &&
              row.state !== "sent" &&
              row.state !== "failed" &&
              row.state !== "cancelled"
            )
              deliveries.set(id, {
                ...row,
                state: "sent",
                sentAt: at,
                attempts: row.attempts + 1,
                lastError: null,
              });
          }
        }),
      markFailed: (id, error, at, retry) =>
        change(() => {
          const row = deliveries.get(id);
          if (row !== undefined && (row.state === "pending" || row.state === "held")) {
            const attempts = row.attempts + 1;
            const retryAt = at + Math.min(retry.baseMs * 2 ** attempts, retry.capMs);
            deliveries.set(id, {
              ...row,
              state: attempts >= retry.maxAttempts ? "failed" : "pending",
              dueAt: attempts >= retry.maxAttempts ? row.dueAt : retryAt,
              retryAt: attempts >= retry.maxAttempts ? row.retryAt : retryAt,
              attempts,
              lastError: error,
            });
          }
        }),
      erase: (recipient) =>
        change(() => {
          for (const [id, row] of deliveries)
            if (same(row.recipient, recipient)) deliveries.delete(id);
          for (const [id, row] of notifications)
            if (same(row.recipient, recipient)) notifications.delete(id);
          preferences.delete(key(recipient));
          quiet.delete(key(recipient));
          timeZones.delete(key(recipient));
        }),
    });
  });

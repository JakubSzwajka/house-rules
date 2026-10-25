import { type Actor, UnitOfWork } from "@house-rules/domain";
import { DateTime, Effect, Random, Schema } from "effect";
import type { NotificationStore } from "../storage.js";
import {
  type Channel,
  type Delivery,
  type DueDelivery,
  type Notification,
  NotificationInputInvalid,
  NotificationPage,
  NotifyInput,
  Preference,
  QuietHours,
  Recipient,
  type ReadResult,
  TimeZone,
} from "./notification.js";
import type { NotificationsOptions } from "./options.js";
import { digestAt, releaseAt } from "./timing.js";

const invalid = () => new NotificationInputInvalid({ message: "Invalid notification input." });
const decode =
  <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  (value: unknown) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(Effect.mapError(invalid));
const now = DateTime.now.pipe(Effect.map(DateTime.toEpochMillis));
const newId = Effect.all(
  Array.from({ length: 4 }, () => Random.nextIntBetween(0, 0xffff_ffff)),
).pipe(Effect.map((words) => words.map((word) => word.toString(16).padStart(8, "0")).join("")));
const readResult = (notifications: readonly Notification[]): ReadResult => ({
  notifications,
  events: notifications.map((n) => ({
    kind: "NotificationRead",
    notificationId: n.id,
    recipient: n.recipient,
  })),
});
export const makeNotifications = (
  store: NotificationStore["Service"],
  options: NotificationsOptions,
) => {
  const mine = (actor: Actor): Recipient => ({ kind: options.recipientKind, id: actor.id });
  const categoryOf = (name: string) =>
    options.categories.find((category) => category.name === name);
  const modeFor = (
    category: NotificationsOptions["categories"][number],
    channel: Channel,
    preferences: readonly Preference[],
  ) => {
    const saved = preferences.find((p) => p.category === category.name && p.channel === channel);
    if (channel === "inapp") return "immediate" as const;
    if (category.mandatory)
      return category.defaultChannels.includes(channel) ||
        (saved !== undefined && saved.mode !== "off")
        ? ("immediate" as const)
        : ("off" as const);
    return (
      saved?.mode ??
      (category.defaultChannels.includes(channel) ? ("immediate" as const) : ("off" as const))
    );
  };
  const refresh = Effect.fn("Notifications.refresh")(function* (recipient: Recipient) {
    const at = yield* now;
    const preferences = yield* store.preferences(recipient);
    const hours = yield* store.quietHours(recipient);
    const timeZone = (yield* store.timeZone(recipient)) ?? "UTC";
    for (const { delivery, notification } of yield* store.deliveries(recipient, {
      unsettledOnly: true,
    })) {
      const category = categoryOf(notification.category);
      if (
        category === undefined ||
        category.mandatory ||
        delivery.channel === "inapp" ||
        (delivery.state !== "pending" && delivery.state !== "held")
      )
        continue;
      const mode = modeFor(category, delivery.channel, preferences);
      if (mode === "off") {
        yield* store.reschedule(delivery.id, { ...delivery, state: "cancelled" });
        continue;
      }
      // Keep elapsed digest times due, and never shorten an outstanding retry backoff.
      const base = Math.max(
        at,
        digestAt(notification.createdAt, mode, timeZone, options.dailyDigestTime ?? "08:00"),
        delivery.retryAt ?? 0,
      );
      const dueAt = hours === null ? base : releaseAt(base, hours, timeZone);
      yield* store.reschedule(delivery.id, {
        mode,
        dueAt,
        state: dueAt > base ? "held" : "pending",
      });
    }
  });
  return {
    notify: Effect.fn("Notifications.notify")(function* (input: NotifyInput) {
      yield* UnitOfWork.required;
      const decoded = yield* decode(NotifyInput)(input);
      const category = categoryOf(decoded.category);
      if (category === undefined) return yield* invalid();
      const at = yield* now;
      const notifications: Notification[] = [];
      const events: {
        kind: "NotificationCreated";
        notificationId: string;
        recipient: Recipient;
        channels: Channel[];
      }[] = [];
      const seen = new Set<string>();
      for (const recipient of decoded.recipients) {
        const key = JSON.stringify([recipient.kind, recipient.id]);
        if (seen.has(key)) continue;
        seen.add(key);
        const preferences = yield* store.preferences(recipient);
        const hours = yield* store.quietHours(recipient);
        const timeZone = (yield* store.timeZone(recipient)) ?? "UTC";
        const notification: Notification = {
          id: yield* newId,
          recipient,
          category: category.name,
          title: decoded.title,
          body: decoded.body,
          data: decoded.data,
          createdAt: at,
          readAt: null,
        };
        const deliveries: Delivery[] = [];
        const channels: Channel[] = [];
        for (const channel of options.channels) {
          const mode = modeFor(category, channel, preferences);
          if (mode === "off") continue;
          channels.push(channel);
          // The inbox row is the in-app delivery, not unsettled work for a sender.
          if (channel === "inapp") continue;
          const base = digestAt(at, mode, timeZone, options.dailyDigestTime ?? "08:00");
          const dueAt =
            !category.mandatory && hours !== null ? releaseAt(base, hours, timeZone) : base;
          deliveries.push({
            id: yield* newId,
            notificationId: notification.id,
            recipient,
            channel,
            mode,
            state: dueAt > base ? "held" : "pending",
            dueAt,
            retryAt: null,
            sentAt: null,
            attempts: 0,
            lastError: null,
          });
        }
        yield* store.insert(notification, deliveries);
        notifications.push(notification);
        events.push({
          kind: "NotificationCreated",
          notificationId: notification.id,
          recipient,
          channels,
        });
      }
      return { notifications, events };
    }),
    listMine: Effect.fn("Notifications.listMine")(function* (
      actor: Actor,
      page?: NotificationPage,
    ) {
      const decoded = yield* decode(NotificationPage)(page ?? {});
      const size = Math.min(decoded.size ?? options.maxPageSize, options.maxPageSize);
      const rows = yield* store.list(mine(actor), {
        size: size + 1,
        ...(decoded.cursor === undefined ? {} : { after: decoded.cursor }),
      });
      const notifications = rows.slice(0, size);
      const last = notifications[notifications.length - 1];
      return rows.length > size && last !== undefined
        ? { notifications, next: { createdAt: last.createdAt, id: last.id } }
        : { notifications };
    }),
    unreadCount: (actor: Actor) => store.unreadCount(mine(actor)),
    markRead: Effect.fn("Notifications.markRead")(function* (actor: Actor, notificationId: string) {
      yield* UnitOfWork.required;
      const id = yield* decode(Schema.NonEmptyString)(notificationId);
      return readResult(yield* store.markRead(mine(actor), yield* now, id));
    }),
    markAllRead: Effect.fn("Notifications.markAllRead")(function* (actor: Actor) {
      yield* UnitOfWork.required;
      return readResult(yield* store.markRead(mine(actor), yield* now));
    }),
    getMyPreferences: Effect.fn("Notifications.getMyPreferences")(function* (actor: Actor) {
      const saved = yield* store.preferences(mine(actor));
      return {
        preferences: options.categories.flatMap((category) =>
          options.channels.map((channel) => ({
            category: category.name,
            channel,
            mode: modeFor(category, channel, saved),
          })),
        ),
        quietHours: yield* store.quietHours(mine(actor)),
        timeZone: yield* store.timeZone(mine(actor)),
      };
    }),
    setMyPreference: Effect.fn("Notifications.setMyPreference")(function* (
      actor: Actor,
      preference: Preference,
    ) {
      yield* UnitOfWork.required;
      const decoded = yield* decode(Preference)(preference);
      const category = categoryOf(decoded.category);
      if (category === undefined || !options.channels.includes(decoded.channel))
        return yield* invalid();
      if ((decoded.channel === "inapp" || category.mandatory) && decoded.mode !== "immediate")
        return yield* invalid();
      yield* store.setPreference(mine(actor), decoded);
      yield* refresh(mine(actor));
    }),
    setMyQuietHours: Effect.fn("Notifications.setMyQuietHours")(function* (
      actor: Actor,
      hours: QuietHours | null,
    ) {
      yield* UnitOfWork.required;
      const decoded = yield* decode(Schema.NullOr(QuietHours))(hours);
      yield* store.setQuietHours(mine(actor), decoded);
      yield* refresh(mine(actor));
    }),
    setMyTimeZone: Effect.fn("Notifications.setMyTimeZone")(function* (
      actor: Actor,
      timeZone: string | null,
    ) {
      yield* UnitOfWork.required;
      yield* store.setTimeZone(mine(actor), yield* decode(Schema.NullOr(TimeZone))(timeZone));
      yield* refresh(mine(actor));
    }),
    dueDeliveries: Effect.fn("Notifications.dueDeliveries")(function* () {
      const at = yield* now;
      const rows = yield* store.due(at, options.maxDueBatch ?? 100);
      const groups = new Map<string, DueDelivery>();
      for (const row of rows) {
        const { delivery } = row;
        const recipientKey = JSON.stringify([delivery.recipient.kind, delivery.recipient.id]);
        const key =
          delivery.mode === "immediate"
            ? delivery.id
            : JSON.stringify([recipientKey, delivery.channel, delivery.mode]);
        const group = groups.get(key);
        groups.set(key, {
          recipient: delivery.recipient,
          channel: delivery.channel,
          mode: group?.mode ?? delivery.mode,
          deliveries: [...(group?.deliveries ?? []), row],
        });
      }
      return [...groups.values()];
    }),
    markSent: Effect.fn("Notifications.markSent")(function* (deliveryIds: readonly string[]) {
      yield* UnitOfWork.required;
      const ids = yield* decode(Schema.Array(Schema.NonEmptyString))(deliveryIds);
      yield* store.markSent(ids, yield* now);
    }),
    markFailed: Effect.fn("Notifications.markFailed")(function* (
      deliveryId: string,
      error: string,
    ) {
      yield* UnitOfWork.required;
      const id = yield* decode(Schema.NonEmptyString)(deliveryId);
      const detail = yield* decode(Schema.String)(error);
      const at = yield* now;
      const retry = {
        maxAttempts: options.maxAttempts ?? 5,
        baseMs: options.retryBaseMs ?? 1000,
        capMs: options.retryCapMs ?? 3_600_000,
      };
      yield* store.markFailed(id, detail, at, retry);
      const item = yield* store.delivery(id);
      if (item === null || item.delivery.state !== "pending") return;
      if (item.delivery.channel === "inapp") return;
      const category = categoryOf(item.notification.category);
      if (category === undefined || category.mandatory) return;
      const hours = yield* store.quietHours(item.delivery.recipient);
      if (hours === null) return;
      const retryAt = item.delivery.retryAt ?? at;
      const dueAt = releaseAt(
        retryAt,
        hours,
        (yield* store.timeZone(item.delivery.recipient)) ?? "UTC",
      );
      if (dueAt > retryAt)
        yield* store.reschedule(item.delivery.id, { ...item.delivery, state: "held", dueAt });
    }),
    erase: Effect.fn("Notifications.erase")(function* (recipient: Recipient) {
      yield* UnitOfWork.required;
      yield* store.erase(yield* decode(Recipient)(recipient));
    }),
  };
};
export type NotificationsService = ReturnType<typeof makeNotifications>;

import * as Domain from "@alchemy.run/domain";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  attributionOf,
  can,
  CurrentActor,
  Delivery,
  type Permission,
  PersonId,
  requirePermission,
} from "@house-rules/stack";
import { AddDevice, DeviceAdded } from "./add-device.command.ts";
import { MarkRead, NotificationsRead } from "./mark-read.command.ts";
import { NotInboxOwner } from "./not-inbox-owner.rejection.ts";
import { Channel, InboxItem, Preference } from "./notification.ts";
import { NotificationCreated, Notify } from "./notify.command.ts";
import { NotificationsPermissions } from "./permissions.ts";
import { QuietHours, releaseAt } from "./quiet-hours.ts";
import { NotificationReleased, ReleaseNotification } from "./release-notification.command.ts";
import { DeviceRemoved, RemoveDevice } from "./remove-device.command.ts";
import { EmailAddressSet, SetEmailAddress } from "./set-email-address.command.ts";
import { PreferenceSet, SetPreference } from "./set-preference.command.ts";
import { QuietHoursSet, SetQuietHours } from "./set-quiet-hours.command.ts";
import {
  NotificationDelivered,
  NotificationDeliveryFailed,
  SettleDelivery,
} from "./settle-delivery.command.ts";

const LedgerLine = Schema.Struct({
  channel: Channel,
  at: Schema.Int,
  failure: Schema.NullOr(Schema.String),
});

export const InboxEntry = Schema.Struct({
  ...InboxItem.fields,
  waiting: Schema.Array(Channel),
  heldUntil: Schema.NullOr(Schema.Int),
  ledger: Schema.Array(LedgerLine),
});
export type InboxEntry = typeof InboxEntry.Type;

export const InboxState = Schema.Struct({
  email: Schema.NullOr(Delivery.EmailAddress),
  devices: Schema.Array(Delivery.PushSubscription),
  preferences: Schema.Array(Preference),
  quietHours: Schema.NullOr(QuietHours),
  notifications: Schema.Array(InboxEntry),
});
export type InboxState = typeof InboxState.Type;

const owner = Effect.fn("requireInboxOwner")(function* (permission: Permission, inbox: PersonId) {
  const actor = yield* requirePermission(permission);
  if (actor._tag !== "Person" || actor.id !== inbox) return yield* new NotInboxOwner();
  return attributionOf(actor);
});

const reachable = (s: InboxState, channel: Channel) =>
  channel === "email" ? s.email !== null : s.devices.length > 0;

const savedFor = (s: InboxState, category: string, channel: Channel) =>
  s.preferences.find((p) => p.category === category && p.channel === channel)?.enabled;

const channelsFor = (s: InboxState, cmd: Notify) =>
  Channel.literals.filter((channel) => {
    const saved = savedFor(s, cmd.category, channel);
    const wanted = cmd.mandatory
      ? cmd.channels.includes(channel) || saved === true
      : (saved ?? cmd.channels.includes(channel));
    return wanted && reachable(s, channel);
  });

const entryOf = (s: InboxState, id: string) => s.notifications.find((n) => n.id === id);

const updateEntry = (s: InboxState, id: string, f: (n: InboxEntry) => InboxEntry): InboxState => ({
  ...s,
  notifications: s.notifications.map((n) => (n.id === id ? f(n) : n)),
});

const settle = (
  s: InboxState,
  e: NotificationDelivered | NotificationDeliveryFailed,
  failure: string | null,
) => ({
  ...updateEntry(s, e.notificationId, (n) => ({
    ...n,
    waiting: n.waiting.filter((c) => c !== e.channel),
    ledger: [...n.ledger, { channel: e.channel, at: e.at, failure }],
  })),
  devices: s.devices.filter((d) => !e.gone.includes(d.endpoint)),
});

export class Inbox extends Domain.Aggregate("Inbox", {
  id: PersonId,
  state: InboxState,
  initial: { email: null, devices: [], preferences: [], quietHours: null, notifications: [] },
  commands: [
    Notify,
    ReleaseNotification,
    SettleDelivery,
    MarkRead,
    SetPreference,
    SetQuietHours,
    SetEmailAddress,
    AddDevice,
    RemoveDevice,
  ],
  decide: {
    Notify: Effect.fn(function* (s, cmd, { now }) {
      yield* requirePermission(NotificationsPermissions.notify);
      if (entryOf(s, cmd.notificationId)) return [];
      const createdAt = DateTime.toEpochMillis(now);
      const channels = channelsFor(s, cmd);
      const heldUntil =
        cmd.mandatory || s.quietHours === null || channels.length === 0
          ? null
          : releaseAt(createdAt, s.quietHours);
      return [
        new NotificationCreated({
          notificationId: cmd.notificationId,
          category: cmd.category,
          title: cmd.title,
          body: cmd.body,
          data: cmd.data,
          createdAt,
          channels,
          heldUntil,
        }),
      ];
    }),
    ReleaseNotification: Effect.fn(function* (s, cmd) {
      const entry = entryOf(s, cmd.notificationId);
      if (!can(yield* CurrentActor, NotificationsPermissions.deliver)) return [];
      if (entry === undefined || entry.heldUntil === null) return [];
      const channels = entry.waiting.filter(
        (c) => (savedFor(s, entry.category, c) ?? true) && reachable(s, c),
      );
      return [new NotificationReleased({ notificationId: entry.id, channels })];
    }),
    SettleDelivery: Effect.fn(function* (s, cmd, { now }) {
      yield* requirePermission(NotificationsPermissions.deliver);
      const entry = entryOf(s, cmd.notificationId);
      if (entry === undefined || entry.heldUntil !== null || !entry.waiting.includes(cmd.channel))
        return [];
      const settled = {
        notificationId: entry.id,
        channel: cmd.channel,
        at: DateTime.toEpochMillis(now),
        gone: cmd.gone,
      };
      return [
        cmd.failure === null
          ? new NotificationDelivered(settled)
          : new NotificationDeliveryFailed({ ...settled, reason: cmd.failure }),
      ];
    }),
    MarkRead: Effect.fn(function* (s, cmd, { id, now }) {
      const attribution = yield* owner(NotificationsPermissions.write, id);
      const notificationIds = s.notifications
        .filter((n) => n.readAt === null)
        .filter((n) => cmd.notificationIds === "all" || cmd.notificationIds.includes(n.id))
        .map((n) => n.id);
      if (notificationIds.length === 0) return [];
      return [
        new NotificationsRead({ notificationIds, at: DateTime.toEpochMillis(now), ...attribution }),
      ];
    }),
    SetPreference: Effect.fn(function* (s, cmd, { id }) {
      const attribution = yield* owner(NotificationsPermissions.write, id);
      if (savedFor(s, cmd.category, cmd.channel) === cmd.enabled) return [];
      return [
        new PreferenceSet({
          category: cmd.category,
          channel: cmd.channel,
          enabled: cmd.enabled,
          ...attribution,
        }),
      ];
    }),
    SetQuietHours: Effect.fn(function* (_, cmd, { id }) {
      const attribution = yield* owner(NotificationsPermissions.write, id);
      return [new QuietHoursSet({ quietHours: cmd.quietHours, ...attribution })];
    }),
    SetEmailAddress: Effect.fn(function* (s, cmd, { id }) {
      const attribution = yield* owner(NotificationsPermissions.write, id);
      if (s.email === cmd.address) return [];
      return [new EmailAddressSet({ address: cmd.address, ...attribution })];
    }),
    AddDevice: Effect.fn(function* (s, cmd, { id }) {
      const attribution = yield* owner(NotificationsPermissions.write, id);
      if (s.devices.some((d) => d.endpoint === cmd.subscription.endpoint)) return [];
      return [new DeviceAdded({ subscription: cmd.subscription, ...attribution })];
    }),
    RemoveDevice: Effect.fn(function* (s, cmd, { id }) {
      const attribution = yield* owner(NotificationsPermissions.write, id);
      if (!s.devices.some((d) => d.endpoint === cmd.endpoint)) return [];
      return [new DeviceRemoved({ endpoint: cmd.endpoint, ...attribution })];
    }),
  },
  evolve: {
    NotificationCreated: (s, e) => ({
      ...s,
      notifications: [
        ...s.notifications,
        {
          id: e.notificationId,
          category: e.category,
          title: e.title,
          body: e.body,
          data: e.data,
          createdAt: e.createdAt,
          readAt: null,
          waiting: e.channels,
          heldUntil: e.heldUntil,
          ledger: [],
        },
      ],
    }),
    NotificationReleased: (s, e) =>
      updateEntry(s, e.notificationId, (n) => ({ ...n, waiting: e.channels, heldUntil: null })),
    NotificationDelivered: (s, e) => settle(s, e, null),
    NotificationDeliveryFailed: (s, e) => settle(s, e, e.reason),
    NotificationsRead: (s, e) => ({
      ...s,
      notifications: s.notifications.map((n) =>
        e.notificationIds.includes(n.id) ? { ...n, readAt: e.at } : n,
      ),
    }),
    PreferenceSet: (s, e) => ({
      ...s,
      preferences: [
        ...s.preferences.filter((p) => p.category !== e.category || p.channel !== e.channel),
        { category: e.category, channel: e.channel, enabled: e.enabled },
      ],
    }),
    QuietHoursSet: (s, e) => ({ ...s, quietHours: e.quietHours }),
    EmailAddressSet: (s, e) => ({ ...s, email: e.address }),
    DeviceAdded: (s, e) => ({ ...s, devices: [...s.devices, e.subscription] }),
    DeviceRemoved: (s, e) => ({
      ...s,
      devices: s.devices.filter((d) => d.endpoint !== e.endpoint),
    }),
  },
}) {}

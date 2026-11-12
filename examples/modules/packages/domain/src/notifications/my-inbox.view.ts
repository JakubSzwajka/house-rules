import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Forbidden, requirePermission, Session } from "@house-rules/stack";
import { Inbox } from "./inbox.aggregate.ts";
import { NotInboxOwner } from "./not-inbox-owner.rejection.ts";
import { InboxItem, Preference } from "./notification.ts";
import { NotificationsPermissions } from "./permissions.ts";
import { QuietHours } from "./quiet-hours.ts";

export class MyInbox extends Domain.View("MyInbox", {
  from: [Inbox],
  key: Inbox,
  middleware: [Session],
  rejects: [Forbidden, NotInboxOwner],
  state: Schema.Struct({
    notifications: Schema.Array(InboxItem),
    unread: Schema.Int,
    preferences: Schema.Array(Preference),
    quietHours: Schema.NullOr(QuietHours),
  }),
  initial: { notifications: [], unread: 0, preferences: [], quietHours: null },
  evolve: {
    NotificationCreated: (v, e) => ({
      ...v,
      unread: v.unread + 1,
      notifications: [
        {
          id: e.notificationId,
          category: e.category,
          title: e.title,
          body: e.body,
          data: e.data,
          createdAt: e.createdAt,
          readAt: null,
        },
        ...v.notifications,
      ],
    }),
    NotificationsRead: (v, e) => ({
      ...v,
      unread: v.unread - e.notificationIds.length,
      notifications: v.notifications.map((n) =>
        e.notificationIds.includes(n.id) ? { ...n, readAt: e.at } : n,
      ),
    }),
    PreferenceSet: (v, e) => ({
      ...v,
      preferences: [
        ...v.preferences.filter((p) => p.category !== e.category || p.channel !== e.channel),
        { category: e.category, channel: e.channel, enabled: e.enabled },
      ],
    }),
    QuietHoursSet: (v, e) => ({ ...v, quietHours: e.quietHours }),
  },
  validate: Effect.fn(function* (request) {
    const actor = yield* requirePermission(NotificationsPermissions.read);
    if (actor._tag !== "Person" || actor.id !== request.key.id) return yield* new NotInboxOwner();
  }),
}) {}

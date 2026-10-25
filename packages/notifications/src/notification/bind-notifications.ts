import { type Binding, bindOperation } from "@house-rules/application";
import { Effect } from "effect";
import { NotificationForbidden } from "./notification.js";
import type { NotificationsService } from "./notifications.js";
import { NotificationsOperations as operations } from "./operations.js";
const forbidden = () =>
  Effect.fail(new NotificationForbidden({ message: "This notification action is not allowed." }));
export const bindNotifications = (service: NotificationsService): readonly Binding[] => [
  bindOperation(operations.notify, (input, { caller }) =>
    caller.kind === "system" ? service.notify(input) : forbidden(),
  ),
  bindOperation(operations.listMine, ({ page }, { caller }) =>
    caller.kind === "person" ? service.listMine(caller.actor, page) : forbidden(),
  ),
  bindOperation(operations.unreadCount, (_, { caller }) =>
    caller.kind === "person" ? service.unreadCount(caller.actor) : forbidden(),
  ),
  bindOperation(operations.markRead, ({ notificationId }, { caller }) =>
    caller.kind === "person" ? service.markRead(caller.actor, notificationId) : forbidden(),
  ),
  bindOperation(operations.markAllRead, (_, { caller }) =>
    caller.kind === "person" ? service.markAllRead(caller.actor) : forbidden(),
  ),
  bindOperation(operations.getMyPreferences, (_, { caller }) =>
    caller.kind === "person" ? service.getMyPreferences(caller.actor) : forbidden(),
  ),
  bindOperation(operations.setMyPreference, (input, { caller }) =>
    caller.kind === "person" ? service.setMyPreference(caller.actor, input) : forbidden(),
  ),
  bindOperation(operations.setMyQuietHours, ({ quietHours }, { caller }) =>
    caller.kind === "person" ? service.setMyQuietHours(caller.actor, quietHours) : forbidden(),
  ),
  bindOperation(operations.setMyTimeZone, ({ timeZone }, { caller }) =>
    caller.kind === "person" ? service.setMyTimeZone(caller.actor, timeZone) : forbidden(),
  ),
  bindOperation(operations.dueDeliveries, (_, { caller }) =>
    caller.kind === "system" ? service.dueDeliveries() : forbidden(),
  ),
  bindOperation(operations.markSent, ({ deliveryIds }, { caller }) =>
    caller.kind === "system" ? service.markSent(deliveryIds) : forbidden(),
  ),
  bindOperation(operations.markFailed, ({ deliveryId, error }, { caller }) =>
    caller.kind === "system" ? service.markFailed(deliveryId, error) : forbidden(),
  ),
];

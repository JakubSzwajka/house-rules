import { Inbox } from "./inbox.aggregate.ts";
import { MyInbox } from "./my-inbox.view.ts";
import { NotificationDelivery, NotificationDeliveryLive } from "./notification-delivery.policy.ts";

export { AddDevice, DeviceAdded } from "./add-device.command.ts";
export { Inbox, InboxEntry, InboxState } from "./inbox.aggregate.ts";
export { MarkRead, NotificationsRead } from "./mark-read.command.ts";
export { MyInbox } from "./my-inbox.view.ts";
export { NotInboxOwner } from "./not-inbox-owner.rejection.ts";
export {
  Channel,
  InboxItem,
  NotificationContent,
  NotificationId,
  Preference,
} from "./notification.ts";
export {
  deliverer,
  NotificationDelivery,
  NotificationDeliveryLive,
  PUSH_TTL_SECONDS,
} from "./notification-delivery.policy.ts";
export { NotificationCreated, Notify } from "./notify.command.ts";
export { NotificationsPermissions } from "./permissions.ts";
export { QuietHours, releaseAt, TimeZone } from "./quiet-hours.ts";
export { NotificationReleased, ReleaseNotification } from "./release-notification.command.ts";
export { DeviceRemoved, RemoveDevice } from "./remove-device.command.ts";
export { EmailAddressSet, SetEmailAddress } from "./set-email-address.command.ts";
export { PreferenceSet, SetPreference } from "./set-preference.command.ts";
export { QuietHoursSet, SetQuietHours } from "./set-quiet-hours.command.ts";
export {
  NotificationDelivered,
  NotificationDeliveryFailed,
  SettleDelivery,
} from "./settle-delivery.command.ts";

export const aggregates = [Inbox] as const;
export const views = [MyInbox] as const;
export const policies = [NotificationDelivery] as const;
export const handlers = NotificationDeliveryLive;

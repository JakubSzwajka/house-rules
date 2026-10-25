import { defineOperation, NoInput } from "@house-rules/domain/contract";
import { Schema } from "effect";
import {
  DueDelivery,
  MyPreferences,
  NotificationForbidden,
  NotificationInputInvalid,
  NotificationList,
  NotificationPage,
  NotificationStoreUnavailable,
  NotifyInput,
  NotifyResult,
  Preference,
  QuietHours,
  ReadResult,
  TimeZone,
} from "./notification.js";
import { NotificationPermissions } from "./permissions.js";
const failure = Schema.Union([
  NotificationForbidden,
  NotificationInputInvalid,
  NotificationStoreUnavailable,
]);
const notify = defineOperation("Notifications.notify", {
  description:
    "Create inbox notifications and channel ledger rows for app-selected recipients. System callers only.",
  input: NotifyInput,
  output: NotifyResult,
  failure,
  permission: NotificationPermissions.write,
  transactional: true,
});
const listMine = defineOperation("Notifications.listMine", {
  description: "Read the caller's inbox, newest first.",
  input: Schema.Struct({ page: Schema.optionalKey(NotificationPage) }),
  output: NotificationList,
  failure,
  permission: NotificationPermissions.read,
  readOnly: true,
});
const unreadCount = defineOperation("Notifications.unreadCount", {
  description: "Count the caller's unread notifications.",
  input: NoInput,
  output: Schema.Int,
  failure,
  permission: NotificationPermissions.read,
  readOnly: true,
});
const markRead = defineOperation("Notifications.markRead", {
  description: "Mark one owned notification read and return its event fact once.",
  input: Schema.Struct({ notificationId: Schema.NonEmptyString }),
  output: ReadResult,
  failure,
  permission: NotificationPermissions.write,
  transactional: true,
});
const markAllRead = defineOperation("Notifications.markAllRead", {
  description: "Mark the caller's unread inbox read and return event facts.",
  input: NoInput,
  output: ReadResult,
  failure,
  permission: NotificationPermissions.write,
  transactional: true,
});
const getMyPreferences = defineOperation("Notifications.getMyPreferences", {
  description: "Read effective channel preferences, time zone and quiet hours for the caller.",
  input: NoInput,
  output: MyPreferences,
  failure,
  permission: NotificationPermissions.read,
  readOnly: true,
});
const setMyPreference = defineOperation("Notifications.setMyPreference", {
  description: "Set a caller-owned category and channel preference.",
  input: Preference,
  output: Schema.Void,
  failure,
  permission: NotificationPermissions.write,
  transactional: true,
});
const setMyQuietHours = defineOperation("Notifications.setMyQuietHours", {
  description: "Set or clear the caller's local quiet window and refresh queued deliveries.",
  input: Schema.Struct({ quietHours: Schema.NullOr(QuietHours) }),
  output: Schema.Void,
  failure,
  permission: NotificationPermissions.write,
  transactional: true,
});
const setMyTimeZone = defineOperation("Notifications.setMyTimeZone", {
  description: "Set or clear the caller's IANA time zone and refresh queued deliveries.",
  input: Schema.Struct({ timeZone: Schema.NullOr(TimeZone) }),
  output: Schema.Void,
  failure,
  permission: NotificationPermissions.write,
  transactional: true,
});
const dueDeliveries = defineOperation("Notifications.dueDeliveries", {
  description:
    "Select bounded complete due groups by recipient, channel and mode. System callers only.",
  input: NoInput,
  output: Schema.Array(DueDelivery),
  failure,
  permission: NotificationPermissions.deliver,
  readOnly: true,
});
const markSent = defineOperation("Notifications.markSent", {
  description: "Settle sent ledger rows idempotently. System callers only.",
  input: Schema.Struct({ deliveryIds: Schema.Array(Schema.NonEmptyString) }),
  output: Schema.Void,
  failure,
  permission: NotificationPermissions.deliver,
  transactional: true,
});
const markFailed = defineOperation("Notifications.markFailed", {
  description: "Record a failed send without changing the inbox. System callers only.",
  input: Schema.Struct({ deliveryId: Schema.NonEmptyString, error: Schema.String }),
  output: Schema.Void,
  failure,
  permission: NotificationPermissions.deliver,
  transactional: true,
});
export const NotificationsOperations = {
  notify,
  listMine,
  unreadCount,
  markRead,
  markAllRead,
  getMyPreferences,
  setMyPreference,
  setMyQuietHours,
  setMyTimeZone,
  dueDeliveries,
  markSent,
  markFailed,
} as const;

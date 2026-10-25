import type { MountDefinition } from "@house-rules/application";
import { Notifications } from "./facade.js";
import { NotificationsOperations } from "./contract.js";
import { bindNotifications } from "./notification/bind-notifications.js";
export const NotificationsMount = {
  map: { name: "notifications", kind: "package", package: "@house-rules/notifications" },
  service: Notifications,
  operations: Object.values(NotificationsOperations),
  bind: bindNotifications,
} satisfies MountDefinition<Notifications, Notifications["Service"]>;
export { Notifications } from "./facade.js";
export { bindNotifications } from "./notification/bind-notifications.js";
export { NotificationCategory, NotificationsOptions } from "./notification/options.js";
export { NotificationStore } from "./storage.js";
export { memoryNotificationStore } from "./adapters/memory/notification.js";
export { postgresNotificationStore } from "./adapters/postgres/notification.js";
export {
  Channel,
  Delivery,
  DeliveryItem,
  DeliveryMode,
  DueDelivery,
  LocalTime,
  MyPreferences,
  Notification,
  NotificationCreated,
  NotificationCursor,
  NotificationEvents,
  NotificationForbidden,
  NotificationInputInvalid,
  NotificationList,
  NotificationNotFound,
  NotificationPage,
  type NotificationPermission,
  NotificationPermissions,
  NotificationRead,
  NotificationStoreUnavailable,
  NotificationsOperations,
  NotifyInput,
  NotifyResult,
  Preference,
  QuietHours,
  ReadResult,
  Recipient,
  TimeZone,
} from "./contract.js";

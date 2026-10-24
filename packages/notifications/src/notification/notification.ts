import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export const Recipient = Schema.Struct({ kind: Schema.NonEmptyString, id: Schema.NonEmptyString });
export type Recipient = typeof Recipient.Type;
export const Channel = Schema.Literals(["inapp", "push", "email"]);
export type Channel = typeof Channel.Type;
export const DeliveryMode = Schema.Literals(["immediate", "hourly", "daily", "off"]);
export type DeliveryMode = typeof DeliveryMode.Type;
export const LocalTime = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/));
export const TimeZone = Schema.NonEmptyString.check(
  Schema.makeFilter((zone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }),
);
export const QuietHours = Schema.Struct({
  start: LocalTime,
  end: LocalTime,
}).check(Schema.makeFilter((hours) => hours.start !== hours.end));
export type QuietHours = typeof QuietHours.Type;
export const Notification = Schema.Struct({
  id: Schema.NonEmptyString,
  recipient: Recipient,
  category: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  body: Schema.String,
  data: Schema.Json,
  createdAt: Schema.Int,
  readAt: Schema.NullOr(Schema.Int),
});
export type Notification = typeof Notification.Type;
export const NotifyInput = Schema.Struct({
  recipients: Schema.Array(Recipient).check(Schema.isMinLength(1)),
  category: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  body: Schema.String,
  data: Schema.Json,
});
export type NotifyInput = typeof NotifyInput.Type;
export const NotificationCreated = Schema.Struct({
  kind: Schema.Literal("NotificationCreated"),
  notificationId: Schema.NonEmptyString,
  recipient: Recipient,
  channels: Schema.Array(Channel),
});
export type NotificationCreated = typeof NotificationCreated.Type;
export const NotificationRead = Schema.Struct({
  kind: Schema.Literal("NotificationRead"),
  notificationId: Schema.NonEmptyString,
  recipient: Recipient,
});
export type NotificationRead = typeof NotificationRead.Type;
export const NotifyResult = Schema.Struct({
  notifications: Schema.Array(Notification),
  events: Schema.Array(NotificationCreated),
});
export type NotifyResult = typeof NotifyResult.Type;
export const ReadResult = Schema.Struct({
  notifications: Schema.Array(Notification),
  events: Schema.Array(NotificationRead),
});
export type ReadResult = typeof ReadResult.Type;
export const NotificationCursor = Schema.Struct({
  createdAt: Schema.Int,
  id: Schema.NonEmptyString,
});
export type NotificationCursor = typeof NotificationCursor.Type;
export const NotificationPage = Schema.Struct({
  size: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  cursor: Schema.optionalKey(NotificationCursor),
});
export type NotificationPage = typeof NotificationPage.Type;
export const NotificationList = Schema.Struct({
  notifications: Schema.Array(Notification),
  next: Schema.optionalKey(NotificationCursor),
});
export type NotificationList = typeof NotificationList.Type;
export const Preference = Schema.Struct({
  category: Schema.NonEmptyString,
  channel: Channel,
  mode: DeliveryMode,
});
export type Preference = typeof Preference.Type;
export const MyPreferences = Schema.Struct({
  preferences: Schema.Array(Preference),
  quietHours: Schema.NullOr(QuietHours),
  timeZone: Schema.NullOr(TimeZone),
});
export type MyPreferences = typeof MyPreferences.Type;
export const Delivery = Schema.Struct({
  id: Schema.NonEmptyString,
  notificationId: Schema.NonEmptyString,
  recipient: Recipient,
  channel: Channel,
  mode: Schema.Literals(["immediate", "hourly", "daily"]),
  state: Schema.Literals(["pending", "held", "sent", "failed", "cancelled"]),
  dueAt: Schema.Int,
  retryAt: Schema.NullOr(Schema.Int),
  sentAt: Schema.NullOr(Schema.Int),
  attempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  lastError: Schema.NullOr(Schema.String),
});
export type Delivery = typeof Delivery.Type;
export const DeliveryItem = Schema.Struct({ delivery: Delivery, notification: Notification });
export type DeliveryItem = typeof DeliveryItem.Type;
export const DueDelivery = Schema.Struct({
  recipient: Recipient,
  channel: Channel,
  mode: Delivery.fields.mode,
  deliveries: Schema.Array(DeliveryItem),
});
export type DueDelivery = typeof DueDelivery.Type;
export class NotificationInputInvalid extends Schema.TaggedError<NotificationInputInvalid>()(
  "NotificationInputInvalid",
  { kind: errorKind("invalid"), message: Schema.String },
) {}
export class NotificationNotFound extends Schema.TaggedError<NotificationNotFound>()(
  "NotificationNotFound",
  { kind: errorKind("not_found"), message: Schema.String },
) {}
export class NotificationForbidden extends Schema.TaggedError<NotificationForbidden>()(
  "NotificationForbidden",
  { kind: errorKind("forbidden"), message: Schema.String },
) {}
export class NotificationStoreUnavailable extends Schema.TaggedError<NotificationStoreUnavailable>()(
  "NotificationStoreUnavailable",
  { kind: errorKind("unavailable"), cause: Schema.Defect() },
) {
  override get message(): string {
    return "Notifications are unavailable. Try again shortly.";
  }
}

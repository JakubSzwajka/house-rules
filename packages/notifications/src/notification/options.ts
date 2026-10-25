import { Schema } from "effect";
import { Channel, LocalTime } from "./notification.js";
const positive = Schema.Int.check(Schema.isGreaterThan(0));
export const NotificationCategory = Schema.Struct({
  name: Schema.NonEmptyString,
  defaultChannels: Schema.Array(Channel),
  mandatory: Schema.Boolean,
});
export type NotificationCategory = typeof NotificationCategory.Type;
export const NotificationsOptions = Schema.Struct({
  recipientKind: Schema.NonEmptyString,
  channels: Schema.Array(Channel).check(Schema.isMinLength(1)),
  categories: Schema.Array(NotificationCategory).check(Schema.isMinLength(1)),
  dailyDigestTime: Schema.optionalKey(LocalTime),
  maxPageSize: positive,
  maxDueBatch: Schema.optionalKey(positive),
  maxAttempts: Schema.optionalKey(positive),
  retryBaseMs: Schema.optionalKey(positive),
  retryCapMs: Schema.optionalKey(positive),
}).check(
  Schema.makeFilter(
    (options) =>
      new Set(options.channels).size === options.channels.length &&
      new Set(options.categories.map((category) => category.name)).size ===
        options.categories.length &&
      options.categories.every(
        (category) =>
          new Set(category.defaultChannels).size === category.defaultChannels.length &&
          category.defaultChannels.every((channel) => options.channels.includes(channel)),
      ),
  ),
);
export type NotificationsOptions = typeof NotificationsOptions.Type;

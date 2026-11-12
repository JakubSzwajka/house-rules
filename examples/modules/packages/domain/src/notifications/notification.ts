import * as Schema from "effect/Schema";
import { Delivery } from "@house-rules/stack";

export const NotificationId = Schema.String.pipe(Schema.brand("NotificationId"));
export type NotificationId = typeof NotificationId.Type;

export const Channel = Schema.Literals(["email", "push"]);
export type Channel = typeof Channel.Type;

export const Preference = Schema.Struct({
  category: Schema.String,
  channel: Channel,
  enabled: Schema.Boolean,
});
export type Preference = typeof Preference.Type;

export const NotificationContent = {
  category: Schema.String,
  title: Delivery.EmailLine,
  body: Schema.String,
  data: Schema.Json,
};

export const InboxItem = Schema.Struct({
  id: NotificationId,
  ...NotificationContent,
  createdAt: Schema.Int,
  readAt: Schema.NullOr(Schema.Int),
});
export type InboxItem = typeof InboxItem.Type;

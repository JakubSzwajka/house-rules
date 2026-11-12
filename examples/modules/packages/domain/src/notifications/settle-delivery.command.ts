import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Delivery, Forbidden, PersonId, Session } from "@house-rules/stack";
import { Channel, NotificationId } from "./notification.ts";

const settled = {
  notificationId: NotificationId,
  channel: Channel,
  at: Schema.Int,
  gone: Schema.Array(Delivery.PushEndpoint),
};

export class NotificationDelivered extends Domain.Event("NotificationDelivered", settled) {}

export class NotificationDeliveryFailed extends Domain.Event("NotificationDeliveryFailed", {
  ...settled,
  reason: Schema.String,
}) {}

export class SettleDelivery extends Domain.Command("SettleDelivery", {
  target: PersonId,
  middleware: [Session],
  input: {
    notificationId: NotificationId,
    channel: Channel,
    failure: Schema.NullOr(Schema.String),
    gone: Schema.Array(Delivery.PushEndpoint),
  },
  events: [NotificationDelivered, NotificationDeliveryFailed],
  rejects: [Forbidden],
}) {}

import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { PersonId } from "../actor/actor.ts";
import { Session } from "../auth/session.middleware.ts";
import { PushEndpoint } from "../delivery/push.external.ts";
import { Channel, NotificationId } from "./notification.ts";

const settled = {
  notificationId: NotificationId,
  channel: Channel,
  at: Schema.Int,
  gone: Schema.Array(PushEndpoint),
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
    gone: Schema.Array(PushEndpoint),
  },
  events: [NotificationDelivered, NotificationDeliveryFailed],
  rejects: [Forbidden],
}) {}

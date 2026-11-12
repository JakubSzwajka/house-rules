import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden, PersonId, Session } from "@house-rules/stack";
import { Channel, NotificationContent, NotificationId } from "./notification.ts";

export class NotificationCreated extends Domain.Event("NotificationCreated", {
  notificationId: NotificationId,
  ...NotificationContent,
  createdAt: Schema.Int,
  channels: Schema.Array(Channel),
  heldUntil: Schema.NullOr(Schema.Int),
}) {}

export class Notify extends Domain.Command("Notify", {
  target: PersonId,
  middleware: [Session],
  input: {
    notificationId: NotificationId,
    ...NotificationContent,
    channels: Schema.Array(Channel),
    mandatory: Schema.Boolean,
  },
  events: [NotificationCreated],
  rejects: [Forbidden],
}) {}

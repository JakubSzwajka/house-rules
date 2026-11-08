import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { PersonId } from "../actor/actor.ts";
import { Session } from "../auth/session.middleware.ts";
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

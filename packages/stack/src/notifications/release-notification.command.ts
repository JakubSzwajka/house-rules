import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { PersonId } from "../actor/actor.ts";
import { Session } from "../auth/session.middleware.ts";
import { Channel, NotificationId } from "./notification.ts";

export class NotificationReleased extends Domain.Event("NotificationReleased", {
  notificationId: NotificationId,
  channels: Schema.Array(Channel),
}) {}

export class ReleaseNotification extends Domain.Command("ReleaseNotification", {
  target: PersonId,
  middleware: [Session],
  input: { notificationId: NotificationId },
  events: [NotificationReleased],
  rejects: [],
}) {}

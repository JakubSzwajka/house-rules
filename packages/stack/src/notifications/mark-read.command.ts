import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { PersonId, ActedFor } from "../actor/actor.ts";
import { Session } from "../auth/session.middleware.ts";
import { NotInboxOwner } from "./not-inbox-owner.rejection.ts";
import { NotificationId } from "./notification.ts";

export class NotificationsRead extends Domain.Event("NotificationsRead", {
  notificationIds: Schema.Array(NotificationId),
  at: Schema.Int,
  by: Schema.String,
  for: ActedFor,
}) {}

export class MarkRead extends Domain.Command("MarkRead", {
  target: PersonId,
  middleware: [Session],
  input: {
    notificationIds: Schema.Union([Schema.Array(NotificationId), Schema.Literal("all")]),
  },
  events: [NotificationsRead],
  rejects: [Forbidden, NotInboxOwner],
}) {}

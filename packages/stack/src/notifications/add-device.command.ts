import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { PersonId } from "../actor/actor.ts";
import { Session } from "../auth/session.middleware.ts";
import { PushSubscription } from "../delivery/push.external.ts";
import { NotInboxOwner } from "./not-inbox-owner.rejection.ts";

export class DeviceAdded extends Domain.Event("DeviceAdded", {
  subscription: PushSubscription,
  by: Schema.String,
}) {}

export class AddDevice extends Domain.Command("AddDevice", {
  target: PersonId,
  middleware: [Session],
  input: { subscription: PushSubscription },
  events: [DeviceAdded],
  rejects: [Forbidden, NotInboxOwner],
}) {}

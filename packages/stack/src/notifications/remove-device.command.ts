import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { PersonId, ActedFor } from "../actor/actor.ts";
import { Session } from "../auth/session.middleware.ts";
import { PushEndpoint } from "../delivery/push.external.ts";
import { NotInboxOwner } from "./not-inbox-owner.rejection.ts";

export class DeviceRemoved extends Domain.Event("DeviceRemoved", {
  endpoint: PushEndpoint,
  by: Schema.String,
  for: ActedFor,
}) {}

export class RemoveDevice extends Domain.Command("RemoveDevice", {
  target: PersonId,
  middleware: [Session],
  input: { endpoint: PushEndpoint },
  events: [DeviceRemoved],
  rejects: [Forbidden, NotInboxOwner],
}) {}

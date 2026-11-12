import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor, Delivery, Forbidden, PersonId, Session } from "@house-rules/stack";
import { NotInboxOwner } from "./not-inbox-owner.rejection.ts";

export class DeviceRemoved extends Domain.Event("DeviceRemoved", {
  endpoint: Delivery.PushEndpoint,
  by: Schema.String,
  for: ActedFor,
}) {}

export class RemoveDevice extends Domain.Command("RemoveDevice", {
  target: PersonId,
  middleware: [Session],
  input: { endpoint: Delivery.PushEndpoint },
  events: [DeviceRemoved],
  rejects: [Forbidden, NotInboxOwner],
}) {}

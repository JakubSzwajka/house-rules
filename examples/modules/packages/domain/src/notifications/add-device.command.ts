import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor, Delivery, Forbidden, PersonId, Session } from "@house-rules/stack";
import { NotInboxOwner } from "./not-inbox-owner.rejection.ts";

export class DeviceAdded extends Domain.Event("DeviceAdded", {
  subscription: Delivery.PushSubscription,
  by: Schema.String,
  for: ActedFor,
}) {}

export class AddDevice extends Domain.Command("AddDevice", {
  target: PersonId,
  middleware: [Session],
  input: { subscription: Delivery.PushSubscription },
  events: [DeviceAdded],
  rejects: [Forbidden, NotInboxOwner],
}) {}

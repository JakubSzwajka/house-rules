import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { WorkItemId } from "./work-item.id.ts";

export class ParentConfirmed extends Domain.Event("ParentConfirmed", {
  parent: WorkItemId,
  container: Schema.NullOr(Schema.String),
}) {}

export class ConfirmParent extends Domain.Command("ConfirmParent", {
  target: WorkItemId,
  middleware: [Session],
  input: { parent: WorkItemId, container: Schema.NullOr(Schema.String) },
  events: [ParentConfirmed],
  rejects: [Forbidden],
}) {}

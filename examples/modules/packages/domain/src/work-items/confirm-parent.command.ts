import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden, Session } from "@house-rules/stack";
import { WorkItemId } from "./work-item.id.ts";

export class WorkItemParentConfirmed extends Domain.Event("WorkItemParentConfirmed", {
  parent: WorkItemId,
  container: Schema.NullOr(Schema.String),
}) {}

export class ConfirmParent extends Domain.Command("ConfirmParent", {
  target: WorkItemId,
  middleware: [Session],
  input: { parent: WorkItemId, container: Schema.NullOr(Schema.String) },
  events: [WorkItemParentConfirmed],
  rejects: [Forbidden],
}) {}

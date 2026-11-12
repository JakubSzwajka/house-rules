import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden, Session } from "@house-rules/stack";
import { WorkItemId } from "./work-item.id.ts";

export const RefusalReason = Schema.Literals(["missing", "too-deep"]);

export class WorkItemParentRefused extends Domain.Event("WorkItemParentRefused", {
  parent: WorkItemId,
  reason: RefusalReason,
}) {}

export class RefuseParent extends Domain.Command("RefuseParent", {
  target: WorkItemId,
  middleware: [Session],
  input: { parent: WorkItemId, reason: RefusalReason },
  events: [WorkItemParentRefused],
  rejects: [Forbidden],
}) {}

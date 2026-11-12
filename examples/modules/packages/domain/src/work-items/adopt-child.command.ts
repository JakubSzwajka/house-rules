import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden, Session } from "@house-rules/stack";
import { WorkItemId } from "./work-item.id.ts";
import { WorkItemNotFound } from "./work-item-not-found.rejection.ts";

export class WorkItemChildAdopted extends Domain.Event("WorkItemChildAdopted", {
  child: WorkItemId,
  container: Schema.NullOr(Schema.String),
}) {}

export class TooDeep extends Domain.Rejection("TooDeep", {}, { httpApiStatus: 409 }) {}

export class AdoptChild extends Domain.Command("AdoptChild", {
  target: WorkItemId,
  middleware: [Session],
  input: { child: WorkItemId },
  events: [WorkItemChildAdopted],
  rejects: [Forbidden, WorkItemNotFound, TooDeep],
}) {}

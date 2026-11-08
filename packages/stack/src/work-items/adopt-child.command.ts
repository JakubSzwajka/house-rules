import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { WorkItemId } from "./work-item.id.ts";
import { WorkItemNotFound } from "./work-item-not-found.rejection.ts";

export class ChildAdopted extends Domain.Event("ChildAdopted", {
  child: WorkItemId,
  container: Schema.NullOr(Schema.String),
}) {}

export class TooDeep extends Domain.Rejection("TooDeep", {}, { httpApiStatus: 409 }) {}

export class AdoptChild extends Domain.Command("AdoptChild", {
  target: WorkItemId,
  middleware: [Session],
  input: { child: WorkItemId },
  events: [ChildAdopted],
  rejects: [Forbidden, WorkItemNotFound, TooDeep],
}) {}

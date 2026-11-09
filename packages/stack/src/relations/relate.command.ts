import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { EdgeId, NodeId } from "./edge.id.ts";
import { ActedFor } from "../actor/actor.ts";

export const Endpoints = { from: NodeId, type: Schema.NonEmptyString, to: NodeId };

export class EdgeRelated extends Domain.Event("EdgeRelated", {
  ...Endpoints,
  by: Schema.String,
  for: ActedFor,
}) {}

export class EdgeIdMismatch extends Domain.Rejection(
  "EdgeIdMismatch",
  { expected: Schema.String },
  { httpApiStatus: 400 },
) {}

export class Relate extends Domain.Command("Relate", {
  target: EdgeId,
  middleware: [Session],
  input: Endpoints,
  events: [EdgeRelated],
  rejects: [Forbidden, EdgeIdMismatch],
}) {}

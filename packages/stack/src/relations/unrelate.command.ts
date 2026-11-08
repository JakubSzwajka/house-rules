import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { EdgeId } from "./edge.id.ts";
import { Endpoints } from "./relate.command.ts";

export class EdgeUnrelated extends Domain.Event("EdgeUnrelated", {
  ...Endpoints,
  by: Schema.String,
}) {}

export class Unrelate extends Domain.Command("Unrelate", {
  target: EdgeId,
  middleware: [Session],
  events: [EdgeUnrelated],
  rejects: [Forbidden],
}) {}

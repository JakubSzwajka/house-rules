import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { requirePermission } from "../access/require-permission.ts";
import { authorOf } from "../actor/actor.ts";
import { EdgeId, edgeId } from "./edge.id.ts";
import { RelationsPermissions } from "./permissions.ts";
import { EdgeIdMismatch, Endpoints, Relate, EdgeRelated } from "./relate.command.ts";
import { Unrelate, EdgeUnrelated } from "./unrelate.command.ts";

export class Edge extends Domain.Aggregate("Edge", {
  id: EdgeId,
  state: Schema.NullOr(Schema.Struct(Endpoints)),
  initial: null,
  commands: [Relate, Unrelate],
  decide: {
    Relate: Effect.fn(function* (s, cmd, { id }) {
      const actor = yield* requirePermission(RelationsPermissions.write);
      const expected = edgeId(cmd.from, cmd.type, cmd.to);
      if (id !== expected) return yield* new EdgeIdMismatch({ expected });
      if (s !== null) return [];
      return [new EdgeRelated({ from: cmd.from, type: cmd.type, to: cmd.to, by: authorOf(actor) })];
    }),
    Unrelate: Effect.fn(function* (s) {
      const actor = yield* requirePermission(RelationsPermissions.write);
      if (s === null) return [];
      return [new EdgeUnrelated({ ...s, by: authorOf(actor) })];
    }),
  },
  evolve: {
    EdgeRelated: (_, e) => ({ from: e.from, type: e.type, to: e.to }),
    EdgeUnrelated: () => null,
  },
}) {}

import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { requirePermission } from "../access/require-permission.ts";
import { Session } from "../auth/session.middleware.ts";
import { Edge } from "./edge.aggregate.ts";
import { NodeId } from "./edge.id.ts";
import { RelationsPermissions } from "./permissions.ts";

export const Link = Schema.Struct({ type: Schema.String, node: Schema.String });
export type Link = typeof Link.Type;

const without = (links: ReadonlyArray<Link>, type: string, node: string) =>
  links.filter((link) => link.type !== type || link.node !== node);

export class NodeEdges extends Domain.View("NodeEdges", {
  from: [Edge],
  key: NodeId,
  middleware: [Session],
  rejects: [Forbidden],
  state: Schema.Struct({ out: Schema.Array(Link), in: Schema.Array(Link) }),
  initial: { out: [], in: [] },
  keyOf: {
    EdgeRelated: { out: ({ event }) => event.from, in: ({ event }) => event.to },
    EdgeUnrelated: { out: ({ event }) => event.from, in: ({ event }) => event.to },
  },
  evolve: {
    EdgeRelated: {
      out: (v, e) => ({ ...v, out: [...v.out, { type: e.type, node: e.to }] }),
      in: (v, e) => ({ ...v, in: [...v.in, { type: e.type, node: e.from }] }),
    },
    EdgeUnrelated: {
      out: (v, e) => ({ ...v, out: without(v.out, e.type, e.to) }),
      in: (v, e) => ({ ...v, in: without(v.in, e.type, e.from) }),
    },
  },
  validate: Effect.fn(function* () {
    yield* requirePermission(RelationsPermissions.read);
  }),
}) {}

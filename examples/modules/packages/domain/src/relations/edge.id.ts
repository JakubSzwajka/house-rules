import * as Schema from "effect/Schema";

export const EdgeId = Schema.String.pipe(Schema.brand("EdgeId"));
export type EdgeId = typeof EdgeId.Type;

export const NodeId = Schema.NonEmptyString;
export type NodeId = typeof NodeId.Type;

export const edgeId = (from: string, type: string, to: string): EdgeId =>
  EdgeId.make(JSON.stringify([from, type, to]));

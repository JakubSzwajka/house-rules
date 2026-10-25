import { Schema } from "effect";
import { NodeRef, Relation } from "./relation.js";

const endpoints = { type: Schema.NonEmptyString, source: NodeRef, target: NodeRef };
export const RelationEvents = {
  Related: Schema.Struct({ kind: Schema.Literal("Related"), ...endpoints }),
  Unrelated: Schema.Struct({ kind: Schema.Literal("Unrelated"), ...endpoints }),
} as const;
export const RelateResult = Schema.Struct({
  relation: Relation,
  events: Schema.Array(RelationEvents.Related),
});
export type RelateResult = typeof RelateResult.Type;
export const UnrelateResult = Schema.Struct({ events: Schema.Array(RelationEvents.Unrelated) });
export type UnrelateResult = typeof UnrelateResult.Type;

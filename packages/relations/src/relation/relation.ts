import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export const NodeRef = Schema.Struct({ kind: Schema.NonEmptyString, id: Schema.NonEmptyString });
export type NodeRef = typeof NodeRef.Type;
export const RelationDirection = Schema.Literals(["out", "in", "both"]);
export type RelationDirection = typeof RelationDirection.Type;
export const RelationCursor = Schema.Struct({ createdAt: Schema.Int, id: Schema.NonEmptyString });
export type RelationCursor = typeof RelationCursor.Type;
export const RelationPage = Schema.Struct({
  size: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  cursor: Schema.optionalKey(RelationCursor),
});
export type RelationPage = typeof RelationPage.Type;
export const Relation = Schema.Struct({
  id: Schema.NonEmptyString,
  type: Schema.NonEmptyString,
  source: NodeRef,
  target: NodeRef,
  createdAt: Schema.Int,
});
export type Relation = typeof Relation.Type;
export const RelateInput = Schema.Struct({
  type: Schema.NonEmptyString,
  source: NodeRef,
  target: NodeRef,
});
export type RelateInput = typeof RelateInput.Type;
export const ListRelationsInput = Schema.Struct({
  node: NodeRef,
  type: Schema.optionalKey(Schema.NonEmptyString),
  direction: RelationDirection,
  page: Schema.optionalKey(RelationPage),
});
export type ListRelationsInput = typeof ListRelationsInput.Type;
export const RelationList = Schema.Struct({
  edges: Schema.Array(Relation),
  next: Schema.optionalKey(RelationCursor),
});
export type RelationList = typeof RelationList.Type;
export const SubgraphInput = Schema.Struct({
  root: NodeRef,
  type: Schema.NonEmptyString,
  direction: RelationDirection,
  depth: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type SubgraphInput = typeof SubgraphInput.Type;
export const RelationGraph = Schema.Struct({
  nodes: Schema.Array(NodeRef),
  edges: Schema.Array(Relation),
});
export type RelationGraph = typeof RelationGraph.Type;

export class RelationTypeUnknown extends Schema.TaggedError<RelationTypeUnknown>()(
  "RelationTypeUnknown",
  {
    kind: errorKind("invalid"),
  },
) {
  override get message(): string {
    return "Unknown relation type.";
  }
}
export class RelationEndpointInvalid extends Schema.TaggedError<RelationEndpointInvalid>()(
  "RelationEndpointInvalid",
  {
    kind: errorKind("invalid"),
  },
) {
  override get message(): string {
    return "Invalid relation endpoint.";
  }
}
export class RelationsInputInvalid extends Schema.TaggedError<RelationsInputInvalid>()(
  "RelationsInputInvalid",
  {
    kind: errorKind("invalid"),
  },
) {
  override get message(): string {
    return "Invalid relations input or options.";
  }
}
export class DuplicateRelation extends Schema.TaggedError<DuplicateRelation>()(
  "DuplicateRelation",
  {
    kind: errorKind("conflict"),
  },
) {
  override get message(): string {
    return "This relation already exists.";
  }
}
export class RelationCardinalityExceeded extends Schema.TaggedError<RelationCardinalityExceeded>()(
  "RelationCardinalityExceeded",
  {
    kind: errorKind("conflict"),
  },
) {
  override get message(): string {
    return "Relation cardinality exceeded.";
  }
}
export class RelationCycle extends Schema.TaggedError<RelationCycle>()("RelationCycle", {
  kind: errorKind("conflict"),
}) {
  override get message(): string {
    return "This relation would create a cycle.";
  }
}
export class RelationNotFound extends Schema.TaggedError<RelationNotFound>()("RelationNotFound", {
  kind: errorKind("not_found"),
}) {
  override get message(): string {
    return "Relation not found.";
  }
}
export class GraphTooLarge extends Schema.TaggedError<GraphTooLarge>()("GraphTooLarge", {
  kind: errorKind("invalid"),
}) {
  override get message(): string {
    return "The relation graph exceeds its configured size limit.";
  }
}
export class RelationsStoreUnavailable extends Schema.TaggedError<RelationsStoreUnavailable>()(
  "RelationsStoreUnavailable",
  {
    kind: errorKind("unavailable"),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Relations are unavailable. Try again shortly.";
  }
}

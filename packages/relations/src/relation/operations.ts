import { defineOperation } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { RelateResult, UnrelateResult } from "./events.js";
import { RelationsPermissions } from "./permissions.js";
import {
  DuplicateRelation,
  GraphTooLarge,
  ListRelationsInput,
  RelateInput,
  RelationCardinalityExceeded,
  RelationCycle,
  RelationEndpointInvalid,
  RelationList,
  RelationNotFound,
  RelationGraph,
  RelationsInputInvalid,
  RelationsStoreUnavailable,
  RelationTypeUnknown,
  SubgraphInput,
} from "./relation.js";
const readFailure = Schema.Union([
  RelationTypeUnknown,
  RelationEndpointInvalid,
  RelationsInputInvalid,
  RelationsStoreUnavailable,
]);
const relate = defineOperation("Relations.relate", {
  description:
    "Connect two opaque nodes after structural validation. The app checks access and existence first.",
  input: RelateInput,
  output: RelateResult,
  failure: Schema.Union([
    RelationTypeUnknown,
    RelationEndpointInvalid,
    DuplicateRelation,
    RelationCardinalityExceeded,
    RelationCycle,
    GraphTooLarge,
    RelationsStoreUnavailable,
  ]),
  permission: RelationsPermissions.write,
  transactional: true,
});
const unrelate = defineOperation("Relations.unrelate", {
  description: "Remove one structural edge by id. The app checks endpoint access first.",
  input: Schema.Struct({ id: Schema.NonEmptyString }),
  output: UnrelateResult,
  failure: Schema.Union([RelationNotFound, RelationsStoreUnavailable]),
  permission: RelationsPermissions.write,
  transactional: true,
  destructive: true,
});
const listRelations = defineOperation("Relations.listRelations", {
  description: "Page edges touching an opaque node. Direction follows stored endpoint order.",
  input: ListRelationsInput,
  output: RelationList,
  failure: readFailure,
  permission: RelationsPermissions.read,
  readOnly: true,
});
const subgraph = defineOperation("Relations.subgraph", {
  description: "Traverse one relation type breadth first, within configured graph bounds.",
  input: SubgraphInput,
  output: RelationGraph,
  failure: Schema.Union([readFailure, GraphTooLarge]),
  permission: RelationsPermissions.read,
  readOnly: true,
});
export const RelationsOperations = { relate, unrelate, listRelations, subgraph } as const;

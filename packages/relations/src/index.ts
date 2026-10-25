import type { MountDefinition } from "@house-rules/application";
import { Relations } from "./facade.js";
import { RelationsOperations } from "./contract.js";
import { bindRelations } from "./relation/bind-relations.js";
export const RelationsMount = {
  map: { name: "relations", kind: "package", package: "@house-rules/relations" },
  service: Relations,
  operations: Object.values(RelationsOperations),
  bind: bindRelations,
} satisfies MountDefinition<Relations, Relations["Service"]>;
export { Relations } from "./facade.js";
export { bindRelations } from "./relation/bind-relations.js";
export { RelationsOptions, RelationType } from "./relation/options.js";
export { RelationStore } from "./storage.js";
export { memoryRelationStore } from "./adapters/memory/relation.js";
export { postgresRelationStore } from "./adapters/postgres/relation.js";
export {
  RelateResult,
  RelationEvents,
  UnrelateResult,
  DuplicateRelation,
  GraphTooLarge,
  ListRelationsInput,
  NodeRef,
  RelateInput,
  Relation,
  RelationCardinalityExceeded,
  RelationCursor,
  RelationCycle,
  RelationDirection,
  RelationEndpointInvalid,
  RelationGraph,
  RelationList,
  RelationNotFound,
  RelationPage,
  RelationsInputInvalid,
  RelationsStoreUnavailable,
  RelationTypeUnknown,
  SubgraphInput,
  RelationsOperations,
  RelationsPermissions,
  type RelationsPermission,
} from "./contract.js";

import { type Binding, bindOperation } from "@house-rules/application";
import type { makeRelations } from "./relations.js";
import { RelationsOperations } from "./operations.js";
export const bindRelations = (service: ReturnType<typeof makeRelations>): readonly Binding[] => [
  bindOperation(RelationsOperations.relate, (input) => service.relate(input)),
  bindOperation(RelationsOperations.unrelate, ({ id }) => service.unrelate(id)),
  bindOperation(RelationsOperations.listRelations, (input) => service.listRelations(input)),
  bindOperation(RelationsOperations.subgraph, (input) => service.subgraph(input)),
];

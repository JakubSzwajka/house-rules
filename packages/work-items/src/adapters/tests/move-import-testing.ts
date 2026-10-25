import { CurrentActor, defineFeature, May } from "@house-rules/application";
import { Actor, ActorId } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  WorkItemAccess,
  WorkItemInputInvalid,
  WorkItemPermissions,
  WorkItems,
  WorkItemsOperations as operations,
  type WorkItem,
} from "../../index.js";

const create = defineFeature("test_moveCreate", {
  ...operations.create,
  permission: null,
  edges: [operations.create],
  handler: (input, { call }) => call(operations.create, input),
});
const move = defineFeature("test_move", {
  ...operations.move,
  permission: null,
  edges: [operations.move],
  handler: (input, { call }) => call(operations.move, input),
});
const rollback = defineFeature("test_moveRollback", {
  ...operations.move,
  permission: null,
  edges: [operations.move],
  handler: (input, { call }) =>
    call(operations.move, input).pipe(
      Effect.andThen(Effect.fail(new WorkItemInputInvalid({ message: "Fail after moving." }))),
    ),
});
const read = defineFeature("test_moveRead", {
  ...operations.get,
  permission: null,
  edges: [operations.get],
  handler: (input, { call }) => call(operations.get, input),
});
const start = { kind: "system", reason: "Import legacy items", startedBy: "test" } as const;
const importItems = defineFeature("test_import", {
  ...operations.import,
  permission: null,
  edges: [operations.import],
  start,
  handler: (input, { call }) => call(operations.import, input),
});
const personImport = defineFeature("test_personImport", {
  ...operations.import,
  permission: null,
  edges: [operations.import],
  handler: (input, { call }) => call(operations.import, input),
});
const systemMove = defineFeature("test_systemMove", {
  ...operations.move,
  permission: null,
  edges: [operations.move],
  start,
  handler: (input, { call }) => call(operations.move, input),
});
const features = [create, move, rollback, read, importItems, personImport, systemMove];
const permissions = Object.values(WorkItemPermissions);
const caller = Layer.merge(
  Layer.succeed(CurrentActor, Actor.make({ id: ActorId.make("owner") })),
  Layer.succeedContext(
    May.context(May.fixed(permissions), { features, system: permissions, via: "test" }),
  ),
);
const system = Layer.succeedContext(May.system(features, { system: permissions, via: "test" }));
const access = Layer.succeed(WorkItemAccess, {
  access: (_actor, ref) => Effect.succeed(ref?.id === "denied" ? "none" : "write"),
  visibleContainers: () => Effect.succeed({ containers: [], inbox: true }),
});
const options = {
  ...WorkItems.presets.board,
  idStrategy: "sequence",
  maxDepth: 2,
  maxTreeSize: 4,
} as const;
const ref = (id: string) => ({ kind: "project", id });
const stored = (id: string, container = ref("import")): WorkItem => ({
  id,
  title: "Imported",
  body: "body",
  status: "doing",
  holder: { kind: "person", id: "legacy" },
  container,
  parent: null,
  attributes: { legacy: true },
  createdAt: 123,
  updatedAt: 456,
  closedAt: null,
});
export const MoveImportTesting = {
  create,
  move,
  rollback,
  read,
  importItems,
  personImport,
  systemMove,
  features,
  caller,
  system,
  access,
  options,
  ref,
  stored,
};

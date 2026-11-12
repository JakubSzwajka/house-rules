import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import { type Actor, agent, AgentId, CurrentActor, person, PersonId } from "@house-rules/stack";
import * as WorkItems from "../index.ts";

const { board, CurrentWorkflow, WorkItem, WorkItemCreated, WorkItemId, WorkItemsPermissions } =
  WorkItems;

export class Model extends Domain.Model("WorkItemsTest", {
  aggregates: [...WorkItems.aggregates],
  views: [...WorkItems.views],
  policies: [...WorkItems.policies],
}) {}

export const story = Story.make(Model, { layer: WorkItems.handlers });
export const w1 = WorkItemId.make("w-1");
export const w2 = WorkItemId.make("w-2");
export const w3 = WorkItemId.make("w-3");
export const item1 = WorkItem.ref(w1);
export const item2 = WorkItem.ref(w2);
export const item3 = WorkItem.ref(w3);
export const ann = PersonId.make("ann");
export const bob = PersonId.make("bob");
export const worker = (id: string) => person(id, { permissions: [WorkItemsPermissions.write] });
export const claudeId = AgentId.make("agent:claude");
export const claude = agent("agent:claude", "ann", {
  name: "Claude",
  permissions: [WorkItemsPermissions.write],
});
export const lead = person("lea", {
  permissions: [WorkItemsPermissions.write, WorkItemsPermissions.assign],
});

export const strict: WorkItems.Workflow = {
  ...board,
  transitions: { todo: ["doing"], doing: ["todo", "done"], done: [] },
};

export const as = (actor: Actor, workflow: WorkItems.Workflow = board) =>
  [Story.provide(CurrentActor, actor), Story.provide(CurrentWorkflow, workflow)] as const;

export const created = (fields: Partial<typeof WorkItemCreated.Type> = {}) =>
  new WorkItemCreated({
    title: "Fix the roof",
    body: "",
    status: "todo",
    closedAt: null,
    container: "p-1",
    parent: null,
    by: "ann",
    ...fields,
  });

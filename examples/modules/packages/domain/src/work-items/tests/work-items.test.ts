import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Forbidden, person } from "@house-rules/stack";
import * as WorkItems from "../index.ts";
import {
  ann,
  as,
  bob,
  created,
  item1,
  lead,
  Model,
  story,
  strict,
  w1,
  worker,
} from "./fixtures.ts";

const {
  AssignWorkItem,
  ChangeWorkItemStatus,
  ContainerWorkItems,
  CreateWorkItem,
  EditWorkItem,
  TransitionNotAllowed,
  WorkItemAssigned,
  WorkItemEdited,
  WorkItemExists,
  WorkItemNotFound,
  WorkItemsPermissions,
  WorkItemStatusChanged,
} = WorkItems;

const t0 = Date.parse("2026-01-02T09:00:00Z");
const t1 = Date.parse("2026-01-03T09:00:00Z");

describe("work items", () => {
  it("the model is well defined", () => expect(Domain.verify(Model)).toEqual([]));

  it.effect("creates an item in the workflow's initial state, in its container", () =>
    story(
      ...as(worker("ann")),
      Story.when(item1, new CreateWorkItem({ title: "Fix the roof", container: "p-1" })),
      Story.then(item1, created()),
      Story.view(ContainerWorkItems, "p-1", (v) =>
        expect(v.items[w1]).toMatchObject({ title: "Fix the roof", status: "todo", holder: null }),
      ),
    ),
  );

  it.effect("refuses an id already taken, and a person without work_items:write", () =>
    story(
      Story.given(item1, created()),
      ...as(worker("ann")),
      Story.when(item1, new CreateWorkItem({ title: "Again" })),
      Story.rejected(new WorkItemExists()),
      ...as(person("bob", { permissions: [WorkItemsPermissions.read] })),
      Story.when(item1, new EditWorkItem({ title: "Mine" })),
      Story.rejected(new Forbidden({ permission: WorkItemsPermissions.write })),
    ),
  );

  it.effect("edits content, records nothing for an unchanged edit, refuses a missing item", () =>
    story(
      Story.given(item1, created()),
      ...as(worker("bob")),
      Story.when(item1, new EditWorkItem({ body: "Leaks over the door" })),
      Story.then(
        item1,
        new WorkItemEdited({ title: "Fix the roof", body: "Leaks over the door", by: "bob" }),
      ),
      Story.when(item1, new EditWorkItem({ title: "Fix the roof" })),
      Story.then(item1),
      Story.when(
        WorkItems.WorkItem.ref(WorkItems.WorkItemId.make("nope")),
        new EditWorkItem({ title: "x" }),
      ),
      Story.rejected(new WorkItemNotFound()),
    ),
  );

  it.effect("moves along allowed transitions and refuses the rest", () =>
    story(
      Story.given(item1, created()),
      ...as(worker("ann"), strict),
      Story.when(item1, new ChangeWorkItemStatus({ status: "done" })),
      Story.rejected(new TransitionNotAllowed({ from: "todo", to: "done" })),
      Story.when(item1, new ChangeWorkItemStatus({ status: "shipped" })),
      Story.rejected(new TransitionNotAllowed({ from: "todo", to: "shipped" })),
      Story.when(item1, new ChangeWorkItemStatus({ status: "doing" })),
      Story.then(
        item1,
        new WorkItemStatusChanged({ from: "todo", to: "doing", closedAt: null, by: "ann" }),
      ),
    ),
  );

  it.effect("stamps closedAt on closing, keeps it within a category, clears it on reopening", () =>
    story(
      Story.given(item1, created()),
      ...as(worker("ann")),
      Story.clock(t0),
      Story.when(item1, new ChangeWorkItemStatus({ status: "done" })),
      Story.then(
        item1,
        new WorkItemStatusChanged({ from: "todo", to: "done", closedAt: t0, by: "ann" }),
      ),
      Story.clock(t1),
      Story.when(item1, new ChangeWorkItemStatus({ status: "dropped" })),
      Story.then(
        item1,
        new WorkItemStatusChanged({ from: "done", to: "dropped", closedAt: t1, by: "ann" }),
      ),
      Story.when(item1, new ChangeWorkItemStatus({ status: "todo" })),
      Story.then(
        item1,
        new WorkItemStatusChanged({ from: "dropped", to: "todo", closedAt: null, by: "ann" }),
      ),
    ),
  );

  it.effect("assigns a holder with work_items:assign only", () =>
    story(
      Story.given(item1, created()),
      ...as(worker("ann")),
      Story.when(item1, new AssignWorkItem({ holder: bob })),
      Story.rejected(new Forbidden({ permission: WorkItemsPermissions.assign })),
      ...as(lead),
      Story.when(item1, new AssignWorkItem({ holder: bob })),
      Story.then(item1, new WorkItemAssigned({ from: null, to: bob, by: "lea" })),
      Story.when(item1, new AssignWorkItem({ holder: ann })),
      Story.then(item1, new WorkItemAssigned({ from: bob, to: ann, by: "lea" })),
      Story.when(item1, new AssignWorkItem({ holder: ann })),
      Story.then(item1),
    ),
  );

  it.effect(
    "refuses a workflow with a repeated or unknown state, a closed claim state, or a release it cannot make",
    () =>
      Effect.gen(function* () {
        const { board } = WorkItems;
        for (const workflow of [
          { ...board, states: [...board.states, { name: "todo", category: "open" as const }] },
          { ...board, initial: "nowhere" },
          { ...board, transitions: { todo: ["nowhere"] } },
          { ...board, claim: "done" },
          { ...board, transitions: { todo: ["doing"], doing: ["done"], done: [] } },
        ]) {
          const failed = yield* Layer.build(WorkItems.workflowConfig(workflow)).pipe(Effect.flip);
          expect(failed._tag).toBe("SchemaError");
        }
      }).pipe(Effect.scoped),
  );
});

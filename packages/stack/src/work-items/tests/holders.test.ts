import { Story } from "@alchemy.run/domain/Story";
import { describe, expect, it } from "@effect/vitest";
import { agent, type PartyId, system } from "../../actor/actor.ts";
import { Forbidden } from "../../access/forbidden.rejection.ts";
import * as WorkItems from "../index.ts";
import {
  ann,
  as,
  bob,
  claude,
  claudeId,
  created,
  item1,
  item2,
  lead,
  story,
  strict,
  w1,
  w2,
  worker,
} from "./fixtures.ts";

const {
  ClaimWorkItem,
  HeldWorkItems,
  NotHolder,
  ReleaseWorkItem,
  TransitionNotAllowed,
  WorkItemAssigned,
  WorkItemClaimed,
  WorkItemClosed,
  WorkItemHeld,
  WorkItemReleased,
  WorkItemsPermissions,
  WorkItemStatusChanged,
} = WorkItems;

const claimed = (holder: PartyId = ann) =>
  new WorkItemClaimed({ holder, from: "todo", to: "doing", by: holder });

describe("holders", () => {
  it.effect("claims an unheld item and moves it to the claim state", () =>
    story(
      Story.given(item1, created()),
      ...as(worker("ann")),
      Story.when(item1, new ClaimWorkItem()),
      Story.then(item1, claimed()),
      Story.when(item1, new ClaimWorkItem()),
      Story.then(item1),
      Story.view(HeldWorkItems, ann, (v) =>
        expect(v.items[w1]).toMatchObject({ status: "doing", holder: ann }),
      ),
    ),
  );

  it.effect("refuses an item someone else holds, a closed item and a missing item", () =>
    story(
      Story.given(item1, created(), claimed(bob)),
      Story.given(
        item2,
        created(),
        new WorkItemStatusChanged({ from: "todo", to: "done", closedAt: 1, by: "ann" }),
      ),
      ...as(worker("ann")),
      Story.when(item1, new ClaimWorkItem()),
      Story.rejected(new WorkItemHeld({ holder: bob })),
      Story.when(item2, new ClaimWorkItem()),
      Story.rejected(new WorkItemClosed({ status: "done" })),
      Story.when(WorkItems.WorkItem.ref(WorkItems.WorkItemId.make("w-9")), new ClaimWorkItem()),
      Story.rejected(new WorkItems.WorkItemNotFound()),
    ),
  );

  it.effect("refuses a claim the workflow does not allow", () =>
    story(
      Story.given(item1, created()),
      ...as(worker("ann"), { ...strict, transitions: { todo: [], doing: ["todo"] } }),
      Story.when(item1, new ClaimWorkItem()),
      Story.rejected(new TransitionNotAllowed({ from: "todo", to: "doing" })),
    ),
  );

  it.effect("lets no system actor hold an item", () =>
    story(
      Story.given(item1, created()),
      ...as(system("bot", [WorkItemsPermissions.write])),
      Story.when(item1, new ClaimWorkItem()),
      Story.rejected(new Forbidden({ permission: WorkItemsPermissions.write })),
    ),
  );

  it.effect("lets an agent claim and hold an item as itself", () =>
    story(
      Story.given(item1, created()),
      Story.given(item2, created(), claimed(ann)),
      ...as(claude),
      Story.when(item1, new ClaimWorkItem()),
      Story.then(item1, claimed(claudeId)),
      Story.when(item1, new ClaimWorkItem()),
      Story.then(item1),
      Story.when(item2, new ClaimWorkItem()),
      Story.rejected(new WorkItemHeld({ holder: ann })),
      Story.view(HeldWorkItems, claudeId, (v) => {
        expect(Object.keys(v.items)).toEqual([w1]);
        expect(v.items[w1]).toMatchObject({ status: "doing", holder: claudeId });
      }),
      Story.view(HeldWorkItems, ann, (v) => expect(Object.keys(v.items)).toEqual([w2])),
    ),
  );

  it.effect("refuses an agent without the permission, and a person on an agent's item", () =>
    story(
      Story.given(item1, created(), claimed(claudeId)),
      ...as(agent("idle", "ann")),
      Story.when(item1, new ClaimWorkItem()),
      Story.rejected(new Forbidden({ permission: WorkItemsPermissions.write })),
      ...as(worker("ann")),
      Story.when(item1, new ClaimWorkItem()),
      Story.rejected(new WorkItemHeld({ holder: claudeId })),
      Story.when(item1, new ReleaseWorkItem()),
      Story.rejected(new NotHolder({ holder: claudeId })),
    ),
  );

  it.effect("lets an agent release its own item and not its person's", () =>
    story(
      Story.given(item1, created(), claimed(claudeId)),
      Story.given(item2, created(), claimed(ann)),
      ...as(claude),
      Story.when(item2, new ReleaseWorkItem()),
      Story.rejected(new NotHolder({ holder: ann })),
      Story.when(item1, new ReleaseWorkItem()),
      Story.then(
        item1,
        new WorkItemReleased({
          holder: claudeId,
          from: "doing",
          to: "todo",
          closedAt: null,
          by: "claude",
        }),
      ),
      Story.view(HeldWorkItems, claudeId, { items: {} }),
    ),
  );

  it.effect("assigns an item to an agent and back to a person", () =>
    story(
      ...as(lead),
      Story.given(item1, created()),
      Story.when(item1, new WorkItems.AssignWorkItem({ holder: claudeId })),
      Story.then(item1, new WorkItemAssigned({ from: null, to: claudeId, by: "lea" })),
      Story.view(HeldWorkItems, claudeId, (v) =>
        expect(v.items[w1]).toMatchObject({ holder: claudeId }),
      ),
      Story.when(item1, new WorkItems.AssignWorkItem({ holder: ann })),
      Story.then(item1, new WorkItemAssigned({ from: claudeId, to: ann, by: "lea" })),
      Story.view(HeldWorkItems, claudeId, { items: {} }),
      Story.view(HeldWorkItems, ann, (v) => expect(Object.keys(v.items)).toEqual([w1])),
    ),
  );

  it.effect("releases by the holder, moving the release state back", () =>
    story(
      Story.given(item1, created(), claimed()),
      ...as(worker("ann")),
      Story.when(item1, new ReleaseWorkItem()),
      Story.then(
        item1,
        new WorkItemReleased({ holder: ann, from: "doing", to: "todo", closedAt: null, by: "ann" }),
      ),
      Story.when(item1, new ReleaseWorkItem()),
      Story.then(item1),
      Story.view(HeldWorkItems, ann, { items: {} }),
    ),
  );

  it.effect("refuses a release by someone who is not the holder", () =>
    story(
      Story.given(item1, created(), claimed()),
      ...as(worker("bob")),
      Story.when(item1, new ReleaseWorkItem()),
      Story.rejected(new NotHolder({ holder: ann })),
    ),
  );

  it.effect("lets an assigner release any holder", () =>
    story(
      Story.given(item1, created(), claimed()),
      ...as(lead),
      Story.when(item1, new ReleaseWorkItem()),
      Story.then(
        item1,
        new WorkItemReleased({ holder: ann, from: "doing", to: "todo", closedAt: null, by: "lea" }),
      ),
    ),
  );

  it.effect("keeps each person's held items as holders change", () =>
    story(
      ...as(lead),
      Story.given(item1, created()),
      Story.given(item2, created({ title: "Paint the fence" })),
      Story.when(item1, new WorkItems.AssignWorkItem({ holder: ann })),
      Story.then(item1, new WorkItemAssigned({ from: null, to: ann, by: "lea" })),
      Story.when(item2, new WorkItems.AssignWorkItem({ holder: ann })),
      Story.then(item2, new WorkItemAssigned({ from: null, to: ann, by: "lea" })),
      Story.when(item1, new WorkItems.AssignWorkItem({ holder: bob })),
      Story.then(item1, new WorkItemAssigned({ from: ann, to: bob, by: "lea" })),
      Story.view(HeldWorkItems, ann, (v) => expect(Object.keys(v.items)).toEqual([w2])),
      Story.view(HeldWorkItems, bob, (v) =>
        expect(v.items[w1]).toMatchObject({ title: "Fix the roof" }),
      ),
    ),
  );
});

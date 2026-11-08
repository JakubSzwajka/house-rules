import { Story } from "@alchemy.run/domain/Story";
import { describe, expect, it } from "@effect/vitest";
import { system } from "../../actor/actor.ts";
import { Forbidden } from "../../access/forbidden.rejection.ts";
import * as WorkItems from "../index.ts";
import {
  ann,
  as,
  bob,
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

const claimed = (holder = ann) =>
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

  it.effect("lets only people hold items", () =>
    story(
      Story.given(item1, created()),
      ...as(system("bot", [WorkItemsPermissions.write])),
      Story.when(item1, new ClaimWorkItem()),
      Story.rejected(new Forbidden({ permission: WorkItemsPermissions.write })),
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

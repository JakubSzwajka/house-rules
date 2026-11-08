import { Story } from "@alchemy.run/domain/Story";
import { describe, expect, it } from "@effect/vitest";
import { system } from "../../actor/actor.ts";
import { Forbidden } from "../../access/forbidden.rejection.ts";
import * as WorkItems from "../index.ts";
import { as, created, item1, item2, item3, story, w1, w2, w3, worker } from "./fixtures.ts";

const {
  AdoptChild,
  ChildAdopted,
  ContainerWorkItems,
  CreateWorkItem,
  ParentConfirmed,
  ParentRefused,
  TooDeep,
  WorkItemCard,
  WorkItemNotFound,
  WorkItemsPermissions,
} = WorkItems;

const self = WorkItems.WorkItem.ref(WorkItems.WorkItemId.make("w-self"));
const child = (parent = w1) => created({ title: "Gutters", container: null, parent });

describe("hierarchy", () => {
  it.effect("adopts a child under a root, and the child joins the parent's container", () =>
    story(
      Story.given(item1, created()),
      ...as(worker("ann")),
      Story.when(item2, new CreateWorkItem({ title: "Gutters", container: "p-9", parent: w1 })),
      Story.then(item2, child(), new ParentConfirmed({ parent: w1, container: "p-1" })),
      Story.then(item1, new ChildAdopted({ child: w2, container: "p-1" })),
      Story.view(WorkItemCard, item1, { children: [w2] }),
      Story.view(ContainerWorkItems, "p-1", (v) =>
        expect(v.items[w2]).toMatchObject({ parent: { id: w1, confirmed: true } }),
      ),
    ),
  );

  it.effect("refuses a parent that does not exist; the child stays a root in the inbox", () =>
    story(
      ...as(worker("ann")),
      Story.when(item2, new CreateWorkItem({ title: "Gutters", parent: w1 })),
      Story.then(item2, child(), new ParentRefused({ parent: w1, reason: "missing" })),
      Story.then(item1),
      Story.view(WorkItemCard, item2, { parent: null, container: null }),
    ),
  );

  it.effect("refuses a parent that is a child, or the item itself: one level, so no cycles", () =>
    story(
      Story.given(item1, created()),
      Story.given(item2, child(), new ParentConfirmed({ parent: w1, container: "p-1" })),
      ...as(worker("ann")),
      Story.when(item3, new CreateWorkItem({ title: "Ladder", parent: w2 })),
      Story.then(
        item3,
        created({ title: "Ladder", container: null, parent: w2 }),
        new ParentRefused({ parent: w2, reason: "too-deep" }),
      ),
      Story.when(self, new CreateWorkItem({ title: "Itself", parent: self.id })),
      Story.then(
        self,
        created({ title: "Itself", container: null, parent: self.id }),
        new ParentRefused({ parent: self.id, reason: "too-deep" }),
      ),
    ),
  );

  it.effect("refuses to adopt under an item whose own parent is still pending", () =>
    story(
      Story.given(item2, child()),
      ...as(system("seed", [WorkItemsPermissions.link])),
      Story.when(item2, new AdoptChild({ child: w3 })),
      Story.rejected(new TooDeep()),
    ),
  );

  it.effect("lets only the system actor with work_items:link adopt", () =>
    story(
      Story.given(item1, created()),
      ...as(worker("ann")),
      Story.when(item1, new AdoptChild({ child: w3 })),
      Story.rejected(new Forbidden({ permission: WorkItemsPermissions.link })),
      ...as(system("seed", [WorkItemsPermissions.link])),
      Story.when(item1, new AdoptChild({ child: w3 })),
      Story.then(item1, new ChildAdopted({ child: w3, container: "p-1" })),
      Story.when(item1, new AdoptChild({ child: w3 })),
      Story.then(item1),
      Story.when(WorkItems.WorkItem.ref(w2), new AdoptChild({ child: w3 })),
      Story.rejected(new WorkItemNotFound()),
    ),
  );
});

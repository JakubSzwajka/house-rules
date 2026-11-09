import { Story } from "@alchemy.run/domain/Story";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { person } from "../../actor/actor.ts";
import { Forbidden } from "../../access/forbidden.rejection.ts";
import * as WorkItems from "../index.ts";
import { foldWorkItem } from "../work-item-state.ts";
import { ann, as, claude, claudeId, created, item1, lead, story, w1, worker } from "./fixtures.ts";

const {
  AssignWorkItem,
  ContainerWorkItems,
  CreateWorkItem,
  EditWorkItem,
  HeldWorkItems,
  WorkItemCard,
  WorkItemCreated,
  WorkItemDue,
  WorkItemEdited,
  WorkItemPriority,
  WorkItemsPermissions,
  WorkItemState,
} = WorkItems;

const urgentToday = { priority: "urgent", due: "2026-03-01" } as const;
const edited = (fields: Partial<typeof WorkItemEdited.Type> = {}) =>
  new WorkItemEdited({ title: "Fix the roof", body: "", by: "bob", ...fields });

describe("work item priority and due date", () => {
  it.effect("creates an item with a priority and a due date that every view shows", () =>
    story(
      ...as(lead),
      Story.when(
        item1,
        new CreateWorkItem({ title: "Fix the roof", container: "p-1", ...urgentToday }),
      ),
      Story.then(item1, created({ ...urgentToday, by: "lea" })),
      Story.when(item1, new AssignWorkItem({ holder: claudeId })),
      Story.then(item1, new WorkItems.WorkItemAssigned({ from: null, to: claudeId, by: "lea" })),
      Story.view(WorkItemCard, item1, (v) => expect(v).toMatchObject(urgentToday)),
      Story.view(ContainerWorkItems, "p-1", (v) => expect(v.items[w1]).toMatchObject(urgentToday)),
      Story.view(HeldWorkItems, claudeId, (v) => expect(v.items[w1]).toMatchObject(urgentToday)),
    ),
  );

  it.effect("creates an item with neither by default", () =>
    story(
      ...as(worker("ann")),
      Story.when(item1, new CreateWorkItem({ title: "Fix the roof", container: "p-1" })),
      Story.then(item1, created()),
      Story.state(item1, (s) => expect(s).toMatchObject({ priority: null, due: null })),
    ),
  );

  it.effect("edits, keeps and clears the priority and the due date", () =>
    story(
      Story.given(item1, created()),
      ...as(worker("bob")),
      Story.when(item1, new EditWorkItem(urgentToday)),
      Story.then(item1, edited(urgentToday)),
      Story.when(item1, new EditWorkItem({ title: "Fix the whole roof" })),
      Story.then(item1, edited({ ...urgentToday, title: "Fix the whole roof" })),
      Story.when(item1, new EditWorkItem({ priority: "urgent" })),
      Story.then(item1),
      Story.when(item1, new EditWorkItem({ priority: null, due: null })),
      Story.then(item1, edited({ title: "Fix the whole roof", priority: null, due: null })),
      Story.view(ContainerWorkItems, "p-1", (v) =>
        expect(v.items[w1]).toMatchObject({ priority: null, due: null }),
      ),
    ),
  );

  it.effect("lets an agent with the grant set the priority, and refuses a reader", () =>
    story(
      Story.given(item1, created()),
      ...as(person("rae", { permissions: [WorkItemsPermissions.read] })),
      Story.when(item1, new EditWorkItem({ priority: "high" })),
      Story.rejected(new Forbidden({ permission: WorkItemsPermissions.write })),
      ...as(claude),
      Story.when(item1, new EditWorkItem({ priority: "high" })),
      Story.then(item1, edited({ priority: "high", by: "agent:claude", for: ann })),
    ),
  );

  it("accepts only the four priorities and calendar days as YYYY-MM-DD", () => {
    expect(["low", "medium", "high", "urgent"].every(Schema.is(WorkItemPriority))).toBe(true);
    expect(["none", "", "URGENT"].some(Schema.is(WorkItemPriority))).toBe(false);
    expect(["2026-03-01", "2024-02-29", "2026-12-31"].every(Schema.is(WorkItemDue))).toBe(true);
    expect(
      ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-3-1", "tomorrow", ""].some(
        Schema.is(WorkItemDue),
      ),
    ).toBe(false);
  });

  it("refuses a due date with a trailing line terminator or any extra character", () => {
    const padded = ["\n", "\r", "\r\n", "\u2028", "\u2029", " ", "0"].map(
      (end) => `2026-03-01${end}`,
    );
    expect(padded.some(Schema.is(WorkItemDue))).toBe(false);
    expect(["\n2026-03-01", "+2026-03-01", "02026-03-01"].some(Schema.is(WorkItemDue))).toBe(false);
  });

  it.effect("refuses a command with an unknown priority or a day that does not exist", () =>
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownEffect(CreateWorkItem);
      const valid = { _tag: "CreateWorkItem", title: "Fix the roof", ...urgentToday };
      expect(yield* decode(valid)).toMatchObject(urgentToday);
      for (const bad of [{ priority: "someday" }, { due: "2026-02-30" }, { due: "2026-03-01\n" }])
        expect((yield* decode({ ...valid, ...bad }).pipe(Effect.flip))._tag).toBe("SchemaError");
    }),
  );

  it.effect("folds events and state stored before priority and due existed", () =>
    Effect.gen(function* () {
      const old = {
        title: "Fix the roof",
        body: "",
        status: "todo",
        closedAt: null,
        container: "p-1",
        parent: null,
        by: "ann",
      };
      const createdBefore = yield* Schema.decodeEffect(WorkItemCreated)({
        _tag: "WorkItemCreated",
        ...old,
      });
      const editedBefore = yield* Schema.decodeEffect(WorkItemEdited)({
        _tag: "WorkItemEdited",
        title: "Fix it",
        body: "",
        by: "ann",
      });
      const state = foldWorkItem.WorkItemEdited(
        foldWorkItem.WorkItemCreated(null, createdBefore),
        editedBefore,
      );
      expect(state).toMatchObject({ title: "Fix it", priority: null, due: null, holder: null });
      expect([createdBefore.for, editedBefore.for]).toEqual([null, null]);
      const stored = yield* Schema.decodeEffect(WorkItemState)({
        title: "Fix the roof",
        body: "",
        status: "doing",
        closedAt: null,
        holder: ann,
        container: "p-1",
        parent: null,
        children: [],
      });
      expect(stored).toMatchObject({ holder: ann, priority: null, due: null });
    }),
  );
});

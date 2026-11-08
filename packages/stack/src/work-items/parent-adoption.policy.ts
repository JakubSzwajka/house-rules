import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import { CurrentActor } from "../actor/current-actor.context.ts";
import { AdoptChild, ChildAdopted } from "./adopt-child.command.ts";
import { ConfirmParent } from "./confirm-parent.command.ts";
import { WorkItemCreated } from "./create-work-item.command.ts";
import { hierarchyKeeper } from "./permissions.ts";
import { RefuseParent } from "./refuse-parent.command.ts";
import { WorkItem } from "./work-item.aggregate.ts";

export class ParentAdoption extends Domain.Policy("ParentAdoption", {
  from: WorkItem,
  on: [WorkItemCreated, ChildAdopted],
}) {}

export const ParentAdoptionLive = ParentAdoption.toLayer(
  Effect.gen(function* () {
    const items = yield* WorkItem;
    return Effect.fn(
      function* ({ source, event }) {
        if (event._tag === "ChildAdopted") {
          const confirm = new ConfirmParent({ parent: source.id, container: event.container });
          yield* items.send(event.child, confirm);
          return;
        }
        const parent = event.parent;
        if (parent === null) return;
        const refuse = (reason: "missing" | "too-deep") => () =>
          items.send(source.id, new RefuseParent({ parent, reason }));
        yield* items
          .send(parent, new AdoptChild({ child: source.id }))
          .pipe(
            Effect.catchTags({ WorkItemNotFound: refuse("missing"), TooDeep: refuse("too-deep") }),
          );
      },
      Effect.orDie,
      Effect.provideService(CurrentActor, hierarchyKeeper),
    );
  }),
);

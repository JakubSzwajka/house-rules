import type { Actor } from "@house-rules/domain";
import { Context, type Effect, Schema } from "effect";
import { type WorkItemAccessUnavailable, WorkItemRef } from "./work-item.js";
export const WorkItemVisibility = Schema.Struct({
  containers: Schema.Array(WorkItemRef),
  inbox: Schema.Boolean,
});
export type WorkItemVisibility = typeof WorkItemVisibility.Type;
export const configuredVisibility = (
  visibility: WorkItemVisibility,
  containerKinds: ReadonlyArray<string>,
): WorkItemVisibility => ({
  ...visibility,
  containers: visibility.containers.filter(({ kind }) => containerKinds.includes(kind)),
});
export class WorkItemAccess extends Context.Service<
  WorkItemAccess,
  {
    readonly access: (
      actor: Actor,
      container: WorkItemRef | null,
    ) => Effect.Effect<"write" | "read" | "none", WorkItemAccessUnavailable>;
    readonly visibleContainers: (
      actor: Actor,
    ) => Effect.Effect<WorkItemVisibility, WorkItemAccessUnavailable>;
  }
>()("@house-rules/work-items/WorkItemAccess") {}

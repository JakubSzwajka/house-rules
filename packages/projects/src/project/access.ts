import type { Actor } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { ProjectAccessUnavailable } from "./project.js";
export class ProjectAccess extends Context.Service<
  ProjectAccess,
  {
    readonly access: (
      actor: Actor,
      projectId: string | null,
    ) => Effect.Effect<"write" | "read" | "none", ProjectAccessUnavailable>;
    readonly visibleProjects: (
      actor: Actor,
    ) => Effect.Effect<ReadonlyArray<string>, ProjectAccessUnavailable>;
  }
>()("@house-rules/projects/ProjectAccess") {}

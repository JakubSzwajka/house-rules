import type { NoOpenUnit } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type {
  Project,
  ProjectRef,
  ProjectSlugTaken,
  ProjectStoreUnavailable,
} from "./project/project.js";
export class ProjectStore extends Context.Service<
  ProjectStore,
  {
    readonly lock: Effect.Effect<void, ProjectStoreUnavailable | NoOpenUnit>;
    readonly get: (ref: ProjectRef) => Effect.Effect<Project | undefined, ProjectStoreUnavailable>;
    readonly list: (
      status?: string,
      visibleIds?: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<Project>, ProjectStoreUnavailable>;
    readonly insert: (
      project: Project,
    ) => Effect.Effect<void, ProjectStoreUnavailable | ProjectSlugTaken | NoOpenUnit>;
    readonly replace: (
      project: Project,
    ) => Effect.Effect<void, ProjectStoreUnavailable | ProjectSlugTaken | NoOpenUnit>;
  }
>()("@house-rules/projects/ProjectStore") {}

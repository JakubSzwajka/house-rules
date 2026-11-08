import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import * as Schema from "effect/Schema";
import { ProjectSettings, ProjectStatuses } from "./project-settings.context.ts";

export class ProjectsConfig extends RpcMiddleware.Service<
  ProjectsConfig,
  { provides: ProjectSettings }
>()("HouseRules/Projects/ProjectsConfig") {}

export const projectsConfig = (statuses: ProjectStatuses) =>
  Layer.effect(
    ProjectsConfig,
    Effect.map(
      Schema.decodeEffect(ProjectStatuses)(statuses),
      (valid) => (effect) => Effect.provideService(effect, ProjectSettings, valid),
    ),
  );

import { type Binding, bindOperation } from "@house-rules/application";
import { Effect } from "effect";
import type { makeProjects } from "./projects.js";
import { ProjectsOperations } from "./operations.js";
import { ProjectAccessDenied } from "./project.js";
export const bindProjects = (service: ReturnType<typeof makeProjects>): readonly Binding[] => [
  bindOperation(ProjectsOperations.create, (input, { caller }) =>
    caller.kind === "person"
      ? service.create(caller.actor, input)
      : Effect.fail(new ProjectAccessDenied()),
  ),
  bindOperation(ProjectsOperations.update, ({ ref, patch }, { caller }) =>
    caller.kind === "person"
      ? service.update(caller.actor, ref, patch)
      : Effect.fail(new ProjectAccessDenied()),
  ),
  bindOperation(ProjectsOperations.show, (ref, { caller }) =>
    caller.kind === "person"
      ? service.show(caller.actor, ref)
      : Effect.fail(new ProjectAccessDenied()),
  ),
  bindOperation(ProjectsOperations.list, (filter, { caller }) =>
    caller.kind === "person"
      ? service.list(caller.actor, filter)
      : Effect.fail(new ProjectAccessDenied()),
  ),
  bindOperation(ProjectsOperations.archive, (ref, { caller }) =>
    caller.kind === "person"
      ? service.archive(caller.actor, ref)
      : Effect.fail(new ProjectAccessDenied()),
  ),
];

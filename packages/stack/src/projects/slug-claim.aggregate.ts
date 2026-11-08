import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { authorOf } from "../actor/actor.ts";
import { requirePermission } from "../access/require-permission.ts";
import { ProjectSettings } from "./project-settings.context.ts";
import { ChangeProjectSlug, ProjectSlugClaimed } from "./change-project-slug.command.ts";
import { CreateProject, ProjectSlugReserved } from "./create-project.command.ts";
import { ProjectsPermissions } from "./permissions.ts";
import { ProjectId, ProjectSlug } from "./project.id.ts";
import { ReleaseSlug, ProjectSlugReleased } from "./release-slug.command.ts";
import { SlugTaken } from "./slug-taken.rejection.ts";
import { UnknownStatus } from "./unknown-status.rejection.ts";

export class SlugClaim extends Domain.Aggregate("SlugClaim", {
  id: ProjectSlug,
  state: Schema.Struct({ project: Schema.NullOr(ProjectId) }),
  initial: { project: null },
  commands: [CreateProject, ChangeProjectSlug, ReleaseSlug],
  decide: {
    CreateProject: Effect.fn(function* (s, cmd) {
      const actor = yield* requirePermission(ProjectsPermissions.write);
      if (s.project === cmd.project) return [];
      if (s.project !== null) return yield* new SlugTaken({ project: s.project });
      const settings = yield* ProjectSettings;
      const status = cmd.status ?? settings.defaultStatus;
      if (!settings.statuses.includes(status))
        return yield* new UnknownStatus({ status, statuses: settings.statuses });
      return [
        new ProjectSlugReserved({
          project: cmd.project,
          name: cmd.name,
          status,
          description: cmd.description ?? "",
          by: authorOf(actor),
        }),
      ];
    }),
    ChangeProjectSlug: Effect.fn(function* (s, cmd) {
      const actor = yield* requirePermission(ProjectsPermissions.write);
      if (s.project === cmd.project) return [];
      if (s.project !== null) return yield* new SlugTaken({ project: s.project });
      return [new ProjectSlugClaimed({ project: cmd.project, by: authorOf(actor) })];
    }),
    ReleaseSlug: Effect.fn(function* (s, cmd) {
      yield* requirePermission(ProjectsPermissions.settle);
      return s.project === cmd.project ? [new ProjectSlugReleased({ project: cmd.project })] : [];
    }),
  },
  evolve: {
    ProjectSlugReserved: (_, e) => ({ project: e.project }),
    ProjectSlugClaimed: (_, e) => ({ project: e.project }),
    ProjectSlugReleased: () => ({ project: null }),
  },
}) {}

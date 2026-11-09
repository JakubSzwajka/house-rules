import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { attributionOf } from "../actor/actor.ts";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { requirePermission } from "../access/require-permission.ts";
import { Session } from "../auth/session.middleware.ts";
import { ChangeProjectStatus, ProjectStatusChanged } from "./change-project-status.command.ts";
import { EditProject, ProjectEdited } from "./edit-project.command.ts";
import { OpenProject, ProjectCreated, ProjectExists } from "./open-project.command.ts";
import { ProjectsPermissions } from "./permissions.ts";
import { ProjectId, ProjectSlug } from "./project.id.ts";
import { ProjectNotFound } from "./project-not-found.rejection.ts";
import { ProjectSettings } from "./project-settings.context.ts";
import { ProjectSlugChanged, SwitchProjectSlug } from "./switch-project-slug.command.ts";
import { UnknownStatus } from "./unknown-status.rejection.ts";

export const ProjectState = Schema.NullOr(
  Schema.Struct({
    slug: ProjectSlug,
    name: Schema.String,
    status: Schema.String,
    description: Schema.String,
  }),
);
export type ProjectState = typeof ProjectState.Type;

export class Project extends Domain.Aggregate("Project", {
  id: ProjectId,
  state: ProjectState,
  initial: null,
  commands: [OpenProject, SwitchProjectSlug, EditProject, ChangeProjectStatus],
  decide: {
    OpenProject: Effect.fn(function* (s, cmd) {
      yield* requirePermission(ProjectsPermissions.settle);
      if (s !== null) return s.slug === cmd.slug ? [] : yield* new ProjectExists();
      const { slug, name, status, description, by } = cmd;
      return [new ProjectCreated({ slug, name, status, description, by, for: cmd.for })];
    }),
    SwitchProjectSlug: Effect.fn(function* (s, cmd) {
      yield* requirePermission(ProjectsPermissions.settle);
      if (s === null) return yield* new ProjectNotFound();
      if (s.slug === cmd.slug) return [];
      return [new ProjectSlugChanged({ from: s.slug, to: cmd.slug, by: cmd.by, for: cmd.for })];
    }),
    EditProject: Effect.fn(function* (s, cmd) {
      const actor = yield* requirePermission(ProjectsPermissions.write);
      if (s === null) return yield* new ProjectNotFound();
      const name = cmd.name ?? s.name;
      const description = cmd.description ?? s.description;
      if (name === s.name && description === s.description) return [];
      return [new ProjectEdited({ name, description, ...attributionOf(actor) })];
    }),
    ChangeProjectStatus: Effect.fn(function* (s, cmd) {
      const actor = yield* requirePermission(ProjectsPermissions.write);
      if (s === null) return yield* new ProjectNotFound();
      const { statuses } = yield* ProjectSettings;
      if (!statuses.includes(cmd.status))
        return yield* new UnknownStatus({ status: cmd.status, statuses });
      if (s.status === cmd.status) return [];
      return [
        new ProjectStatusChanged({ from: s.status, to: cmd.status, ...attributionOf(actor) }),
      ];
    }),
  },
  evolve: {
    ProjectCreated: (_, e) => ({
      slug: e.slug,
      name: e.name,
      status: e.status,
      description: e.description,
    }),
    ProjectSlugChanged: (s, e) => (s === null ? s : { ...s, slug: e.to }),
    ProjectEdited: (s, e) => (s === null ? s : { ...s, name: e.name, description: e.description }),
    ProjectStatusChanged: (s, e) => (s === null ? s : { ...s, status: e.to }),
  },
  read: {
    middleware: [Session],
    rejects: [Forbidden],
    validate: Effect.fn(function* () {
      yield* requirePermission(ProjectsPermissions.read);
    }),
  },
}) {}

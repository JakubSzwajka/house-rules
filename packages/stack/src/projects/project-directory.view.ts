import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { requirePermission } from "../access/require-permission.ts";
import { Session } from "../auth/session.middleware.ts";
import { ProjectsPermissions } from "./permissions.ts";
import { Project } from "./project.aggregate.ts";

export const DirectoryKey = Schema.Literal("projects");

const Entry = Schema.Struct({ slug: Schema.String, name: Schema.String, status: Schema.String });
type Entry = typeof Entry.Type;
type Directory = { readonly projects: Readonly<Record<string, Entry>> };

const compare = (a: string, b: string) => (a < b ? -1 : a === b ? 0 : 1);

const patch = (v: Directory, id: string, change: Partial<Entry>): Directory => {
  const entry = v.projects[id];
  return entry === undefined ? v : { projects: { ...v.projects, [id]: { ...entry, ...change } } };
};

export class ProjectDirectory extends Domain.View("ProjectDirectory", {
  from: [Project],
  key: DirectoryKey,
  keyOf: { Project: () => "projects" as const },
  middleware: [Session],
  rejects: [Forbidden],
  state: Schema.Struct({ projects: Schema.Record(Schema.String, Entry) }),
  initial: { projects: {} },
  evolve: {
    ProjectCreated: (v, e, { source }) => ({
      projects: { ...v.projects, [source.id]: { slug: e.slug, name: e.name, status: e.status } },
    }),
    ProjectSlugChanged: (v, e, { source }) => patch(v, source.id, { slug: e.to }),
    ProjectEdited: (v, e, { source }) => patch(v, source.id, { name: e.name }),
    ProjectStatusChanged: (v, e, { source }) => patch(v, source.id, { status: e.to }),
  },
  computed: {
    ordered: (v: Directory) =>
      Object.entries(v.projects)
        .map(([id, entry]) => ({ id, ...entry }))
        .sort(
          (a, b) => compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.slug, b.slug),
        ),
  },
  validate: Effect.fn(function* () {
    yield* requirePermission(ProjectsPermissions.read);
  }),
}) {}

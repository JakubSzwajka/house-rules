import { type Actor, UnitOfWork } from "@house-rules/domain";
import { DateTime, Effect, Random, Schema } from "effect";
import type { ProjectStore } from "../storage.js";
import type { ProjectAccess } from "./access.js";
import type { CreateProjectResult, UpdateProjectResult } from "./events.js";
import type { ProjectsOptions } from "./options.js";
import {
  type NewProject,
  type Project,
  ProjectAccessDenied,
  ProjectInputInvalid,
  type ProjectFilter,
  ProjectNotFound,
  type ProjectPatch,
  type ProjectRef,
} from "./project.js";

export const makeProjects = (
  store: ProjectStore["Service"],
  access: ProjectAccess["Service"] | undefined,
  options: ProjectsOptions,
  pattern: RegExp,
) => {
  const decodeStatus = (status: string) =>
    Schema.decodeEffect(Schema.Literals(options.statuses))(status).pipe(
      Effect.mapError(
        () =>
          new ProjectInputInvalid({
            field: "status",
            message: "Status must be one of the configured project statuses.",
          }),
      ),
    );
  const decodeName = (name: string) =>
    Schema.decodeEffect(Schema.NonEmptyString.check(Schema.isMaxLength(200)))(name).pipe(
      Effect.mapError(
        () =>
          new ProjectInputInvalid({
            field: "name",
            message: "Name must contain 1 to 200 characters.",
          }),
      ),
    );
  const decodeSlug = (slug: string) =>
    Schema.decodeEffect(
      Schema.NonEmptyString.check(
        Schema.isMaxLength(options.slug.maxLength),
        Schema.isPattern(pattern),
      ),
    )(slug).pipe(
      Effect.mapError(
        () =>
          new ProjectInputInvalid({
            field: "slug",
            message: `Slug must contain 1 to ${options.slug.maxLength} characters and match the app's slug format.`,
          }),
      ),
    );
  const slugOf = (slug: string) => {
    const trimmed = options.slug.trim ? slug.trim() : slug;
    return options.slug.lowercase ? trimmed.toLowerCase() : trimmed;
  };
  const requireAccess = Effect.fn("Projects.requireAccess")(function* (
    actor: Actor,
    id: string | null,
    write: boolean,
  ) {
    if (access === undefined) return;
    const relation = yield* access.access(actor, id);
    if (relation === "write" || (!write && relation === "read")) return;
    return yield* id === null ? new ProjectAccessDenied() : new ProjectNotFound();
  });
  const find = Effect.fn("Projects.find")(function* (
    actor: Actor,
    ref: ProjectRef,
    write: boolean,
  ) {
    const normalized = "slug" in ref ? { slug: slugOf(ref.slug) } : ref;
    const project = yield* store.get(normalized);
    if (project === undefined) return yield* new ProjectNotFound();
    yield* requireAccess(actor, project.id, write);
    return project;
  });
  const change = Effect.fn("Projects.change")(function* (
    actor: Actor,
    ref: ProjectRef,
    patch: ProjectPatch,
  ) {
    yield* UnitOfWork.required;
    yield* store.lock;
    const before = yield* find(actor, ref, true);
    const slug = yield* decodeSlug(slugOf(patch.slug ?? before.slug));
    const name = yield* decodeName((patch.name ?? before.name).trim());
    const status = yield* decodeStatus(patch.status ?? before.status);
    const description = patch.description ?? before.description;
    if (
      slug === before.slug &&
      name === before.name &&
      status === before.status &&
      description === before.description
    ) {
      return { project: before, events: [] } satisfies UpdateProjectResult;
    }
    const after: Project = {
      ...before,
      slug,
      name,
      status,
      description,
      updatedAt: DateTime.toEpochMillis(yield* DateTime.now),
    };
    yield* store.replace(after);
    return {
      project: after,
      events: [{ kind: "ProjectUpdated", before: { ...before }, after: { ...after } }],
    } satisfies UpdateProjectResult;
  });
  return {
    create: Effect.fn("Projects.create")(function* (actor: Actor, input: NewProject) {
      yield* UnitOfWork.required;
      yield* requireAccess(actor, null, true);
      const slug = yield* decodeSlug(slugOf(input.slug));
      const name = yield* decodeName(input.name.trim());
      const status = yield* decodeStatus(input.status ?? options.defaultStatus);
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const id = yield* Effect.all(
        Array.from({ length: 4 }, () => Random.nextIntBetween(0, 0xffff_ffff)),
      ).pipe(
        Effect.map((words) => words.map((word) => word.toString(16).padStart(8, "0")).join("")),
      );
      const project: Project = {
        id,
        slug,
        name,
        status,
        description: input.description ?? "",
        createdAt: now,
        updatedAt: now,
      };
      yield* store.insert(project);
      return {
        project,
        events: [{ kind: "ProjectCreated", project: { ...project } }],
      } satisfies CreateProjectResult;
    }),
    update: change,
    archive: (actor: Actor, ref: ProjectRef) =>
      change(actor, ref, { status: options.archivedStatus }),
    show: (actor: Actor, ref: ProjectRef) => find(actor, ref, false),
    list: Effect.fn("Projects.list")(function* (actor: Actor, filter: ProjectFilter = {}) {
      const status = filter.status === undefined ? undefined : yield* decodeStatus(filter.status);
      const ids = access === undefined ? undefined : yield* access.visibleProjects(actor);
      return yield* store.list(status, ids);
    }),
  };
};

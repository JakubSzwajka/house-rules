import { expect, expectTypeOf, layer } from "@effect/vitest";
import {
  CurrentActor,
  defineFeature,
  May,
  Runtime,
  runFeature,
  StepTrace,
} from "@house-rules/application";
import { Actor, ActorId } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import {
  bindProjects,
  ProjectEvents,
  ProjectInputInvalid,
  Projects,
  ProjectsMount,
  ProjectsOperations,
} from "../../index.js";
import { stores } from "./stores.js";
const { create, update, show, list, archive } = ProjectsOperations;
const createFeature = defineFeature("test_createProject", {
  ...create,
  permission: null,
  edges: [create],
  handler: (input, { call }) => call(create, input),
});
const updateFeature = defineFeature("test_updateProject", {
  ...update,
  permission: null,
  edges: [update],
  handler: (input, { call }) => call(update, input),
});
const showFeature = defineFeature("test_showProject", {
  ...show,
  permission: null,
  edges: [show],
  handler: (input, { call }) => call(show, input),
});
const listFeature = defineFeature("test_listProjects", {
  ...list,
  permission: null,
  edges: [list],
  handler: (input, { call }) => call(list, input),
});
const archiveFeature = defineFeature("test_archiveProject", {
  ...archive,
  permission: null,
  edges: [archive],
  handler: (input, { call }) => call(archive, input),
});
const systemFeature = defineFeature("test_systemProject", {
  ...list,
  permission: null,
  edges: [list],
  start: { kind: "system", reason: "test", startedBy: "test" },
  handler: (input, { call }) => call(list, input),
});
expectTypeOf<Parameters<typeof bindProjects>[0]>().toEqualTypeOf<Projects["Service"]>();
const rollbackFeature = defineFeature("test_rollbackProject", {
  ...create,
  permission: null,
  edges: [create],
  handler: (input, { call }) =>
    call(create, input).pipe(
      Effect.andThen(() =>
        Effect.fail(new ProjectInputInvalid({ field: "name", message: "Roll back the feature." })),
      ),
    ),
});
const features = [
  rollbackFeature,
  createFeature,
  updateFeature,
  showFeature,
  listFeature,
  archiveFeature,
  systemFeature,
];
const permissions = ["projects:read", "projects:write"] as const;
const actor = Actor.make({ id: ActorId.make("owner") });
const caller = (grants: ReadonlyArray<"projects:read" | "projects:write"> = permissions) =>
  Layer.merge(
    Layer.succeed(CurrentActor, actor),
    Layer.succeedContext(
      May.context(May.fixed(grants), { features, system: permissions, via: "test" }),
    ),
  );
for (const { name, layer: storage } of stores) {
  const module = Projects.layer({
    ...Projects.presets.default,
    statuses: ["active", "paused", "done", "archived"],
  }).pipe(Layer.provideMerge(storage));
  const world = Runtime.layer({ mounts: [ProjectsMount], features, ways: [] }).pipe(
    Layer.provideMerge(module),
    Layer.provideMerge(StepTrace.layer()),
  );
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Projects runtime on ${name}`,
    (it) => {
      it.effect("rolls back a completed operation when the feature fails", () =>
        Effect.gen(function* () {
          expect(
            yield* Effect.flip(
              runFeature(rollbackFeature, { slug: "feature-rollback", name: "Rollback" }),
            ),
          ).toMatchObject({ _tag: "ProjectInputInvalid" });
          expect(
            yield* Effect.flip(runFeature(showFeature, { slug: "feature-rollback" })),
          ).toMatchObject({ _tag: "ProjectNotFound" });
        }).pipe(Effect.provide(caller())),
      );
      it.effect("creates, shows by id/slug, updates slug and returns isolated facts", () =>
        Effect.gen(function* () {
          expect(ProjectsMount.bind).toBe(bindProjects);
          const created = yield* runFeature(createFeature, {
            slug: " Flow ",
            name: " Flow ",
            description: "## plain",
          });
          const before = created.project;
          expect(before).toMatchObject({
            slug: "flow",
            name: "Flow",
            status: "active",
            description: "## plain",
          });
          expect(created.events).toEqual([{ kind: "ProjectCreated", project: before }]);
          expect(
            yield* Schema.decodeUnknownEffect(ProjectEvents.ProjectCreated)(created.events[0]),
          ).toEqual(created.events[0]);
          expect(yield* runFeature(showFeature, { id: before.id })).toEqual(before);
          expect(yield* runFeature(showFeature, { slug: "FLOW" })).toEqual(before);
          const changed = yield* runFeature(updateFeature, {
            ref: { id: before.id },
            patch: { slug: "renamed", status: "paused", name: " Changed " },
          });
          expect(changed.project).toMatchObject({
            id: before.id,
            slug: "renamed",
            status: "paused",
            name: "Changed",
            createdAt: before.createdAt,
          });
          expect(changed.events).toEqual([
            { kind: "ProjectUpdated", before, after: changed.project },
          ]);
          expect(
            yield* Schema.decodeUnknownEffect(ProjectEvents.ProjectUpdated)(changed.events[0]),
          ).toEqual(changed.events[0]);
          expect((yield* Effect.flip(runFeature(showFeature, { slug: "flow" })))._tag).toBe(
            "ProjectNotFound",
          );
          const same = yield* runFeature(updateFeature, {
            ref: { slug: "renamed" },
            patch: { status: "paused" },
          });
          expect(same).toEqual({ project: changed.project, events: [] });
          Object.assign(created.events[0]?.project ?? {}, { name: "corrupted" });
          Object.assign(changed.events[0]?.after ?? {}, { name: "corrupted" });
          expect((yield* runFeature(showFeature, { id: before.id })).name).toBe("Changed");
        }).pipe(Effect.provide(caller())),
      );
      it.effect(
        "lists by lowercased name then slug, filters status and archives without deletion",
        () =>
          Effect.gen(function* () {
            const records = [];
            for (const input of [
              { slug: "order-z", name: "zebra" },
              { slug: "order-b", name: "Alpha" },
              { slug: "order-a", name: "alpha", status: "done" },
            ])
              records.push((yield* runFeature(createFeature, input)).project);
            const selected = (yield* runFeature(listFeature, {})).filter((p) =>
              p.slug.startsWith("order-"),
            );
            expect(selected.map((p) => p.slug)).toEqual(["order-a", "order-b", "order-z"]);
            const archived = yield* runFeature(archiveFeature, { slug: "order-b" });
            expect(archived.project.status).toBe("archived");
            expect(archived.events[0]).toMatchObject({
              kind: "ProjectUpdated",
              before: { status: "active" },
              after: { status: "archived" },
            });
            expect(
              (yield* runFeature(listFeature, { status: "archived" })).map((p) => p.slug),
            ).toContain("order-b");
            expect(
              (yield* runFeature(listFeature, { status: "active" })).map((p) => p.slug),
            ).not.toContain("order-b");
            expect(yield* runFeature(showFeature, { slug: "order-b" })).toEqual(archived.project);
            expect((yield* runFeature(listFeature, {})).map((p) => p.slug)).toContain("order-b");
            expect(records).toHaveLength(3);
          }).pipe(Effect.provide(caller())),
      );
      it.effect(
        "rejects duplicate slugs, rename collisions and concurrent creates as conflicts",
        () =>
          Effect.gen(function* () {
            yield* runFeature(createFeature, { slug: "unique", name: "Unique" });
            expect(
              yield* Effect.flip(runFeature(createFeature, { slug: "UNIQUE", name: "Again" })),
            ).toMatchObject({ _tag: "ProjectSlugTaken", kind: "conflict" });
            const other = yield* runFeature(createFeature, { slug: "other", name: "Other" });
            expect(
              yield* Effect.flip(
                runFeature(updateFeature, {
                  ref: { id: other.project.id },
                  patch: { slug: "unique" },
                }),
              ),
            ).toMatchObject({ _tag: "ProjectSlugTaken" });
            expect((yield* runFeature(showFeature, { id: other.project.id })).slug).toBe("other");
            const outcomes = yield* Effect.forEach(
              [0, 1],
              () => runFeature(createFeature, { slug: "race", name: "Race" }).pipe(Effect.result),
              { concurrency: 2 },
            );
            expect(outcomes.filter((r) => r._tag === "Success")).toHaveLength(1);
            expect(outcomes.filter((r) => r._tag === "Failure")).toMatchObject([
              { failure: { _tag: "ProjectSlugTaken", kind: "conflict" } },
            ]);
          }).pipe(Effect.provide(caller())),
      );
      it.effect("validates slug, name and status on create, update and list", () =>
        Effect.gen(function* () {
          const messages = {
            slug: "Slug must contain 1 to 64 characters and match the app's slug format.",
            name: "Name must contain 1 to 200 characters.",
            status: "Status must be one of the configured project statuses.",
          };
          for (const slug of ["", "bad slug", "bad_slug", "-bad", "a".repeat(65)]) {
            expect(
              yield* Effect.flip(runFeature(createFeature, { slug, name: "Name" })),
            ).toMatchObject({
              _tag: "ProjectInputInvalid",
              kind: "invalid",
              field: "slug",
              message: messages.slug,
            });
          }
          yield* runFeature(createFeature, { slug: "validation", name: "Valid" });
          for (const [field, patch] of [
            ["slug", { slug: "private invalid slug" }],
            ["name", { name: " " }],
            ["name", { name: "a".repeat(201) }],
            ["status", { status: "private invalid status" }],
          ] as const) {
            const expected = {
              _tag: "ProjectInputInvalid",
              kind: "invalid",
              field,
              message: messages[field],
            };
            expect(
              yield* Effect.flip(
                runFeature(createFeature, { slug: "valid", name: "Valid", ...patch }),
              ),
            ).toMatchObject(expected);
            expect(
              yield* Effect.flip(runFeature(updateFeature, { ref: { slug: "validation" }, patch })),
            ).toMatchObject(expected);
          }
          expect(yield* Effect.flip(runFeature(listFeature, { status: "unknown" }))).toMatchObject({
            _tag: "ProjectInputInvalid",
            kind: "invalid",
            field: "status",
            message: messages.status,
          });
          expect((yield* runFeature(showFeature, { slug: "validation" })).status).toBe("active");
          expect(
            yield* Effect.flip(runFeature(updateFeature, { ref: { slug: "missing" }, patch: {} })),
          ).toMatchObject({ _tag: "ProjectNotFound" });
        }).pipe(Effect.provide(caller())),
      );
      it.effect("requires read/write permissions and rejects system callers even with grants", () =>
        Effect.gen(function* () {
          expect(
            yield* Effect.flip(runFeature(listFeature, {}).pipe(Effect.provide(caller([])))),
          ).toMatchObject({ _tag: "Forbidden" });
          expect(
            yield* Effect.flip(
              runFeature(createFeature, { slug: "denied", name: "Denied" }).pipe(
                Effect.provide(caller(["projects:read"])),
              ),
            ),
          ).toMatchObject({ _tag: "Forbidden" });
          expect(
            yield* Effect.flip(runFeature(systemFeature, {}).pipe(Effect.provide(caller()))),
          ).toMatchObject({ _tag: "ProjectAccessDenied", kind: "forbidden" });
        }),
      );
    },
  );
}

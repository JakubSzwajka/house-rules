import { expect, layer } from "@effect/vitest";
import {
  CurrentActor,
  defineFeature,
  May,
  Runtime,
  runFeature,
  StepTrace,
} from "@house-rules/application";
import { Actor, ActorId } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  ProjectAccess,
  ProjectAccessUnavailable,
  Projects,
  ProjectsMount,
  ProjectsOperations,
} from "../../index.js";
import { stores } from "./stores.js";
const { create, show, update, list, archive } = ProjectsOperations;
const add = defineFeature("access_create", {
  ...create,
  permission: null,
  edges: [create],
  handler: (i, { call }) => call(create, i),
});
const get = defineFeature("access_show", {
  ...show,
  permission: null,
  edges: [show],
  handler: (i, { call }) => call(show, i),
});
const change = defineFeature("access_update", {
  ...update,
  permission: null,
  edges: [update],
  handler: (i, { call }) => call(update, i),
});
const listing = defineFeature("access_list", {
  ...list,
  permission: null,
  edges: [list],
  handler: (i, { call }) => call(list, i),
});
const close = defineFeature("access_archive", {
  ...archive,
  permission: null,
  edges: [archive],
  handler: (i, { call }) => call(archive, i),
});
const features = [add, get, change, listing, close];
const permissions = ["projects:read", "projects:write"] as const;
const caller = (id: string) =>
  Layer.merge(
    Layer.succeed(CurrentActor, Actor.make({ id: ActorId.make(id) })),
    Layer.succeedContext(
      May.context(May.fixed(permissions), { features, system: [], via: "test" }),
    ),
  );
for (const { name, layer: storage } of stores) {
  const visible = new Set<string>();
  const port = Layer.succeed(ProjectAccess, {
    access: (actor, id) =>
      actor.id === "broken"
        ? Effect.fail(new ProjectAccessUnavailable({ cause: "private access failure" }))
        : Effect.succeed(
            actor.id === "owner"
              ? "write"
              : actor.id === "reader" && id !== null && visible.has(id)
                ? "read"
                : "none",
          ),
    visibleProjects: (actor) =>
      actor.id === "broken"
        ? Effect.fail(new ProjectAccessUnavailable({ cause: "private listing failure" }))
        : Effect.succeed(actor.id === "owner" || actor.id === "reader" ? [...visible] : []),
  });
  const module = Projects.layer(Projects.presets.default).pipe(
    Layer.provide(port),
    Layer.provideMerge(storage),
  );
  const world = Runtime.layer({ mounts: [ProjectsMount], features, ways: [] }).pipe(
    Layer.provideMerge(module),
    Layer.provideMerge(StepTrace.layer()),
  );
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `ProjectAccess on ${name}`,
    (it) => {
      it.effect(
        "honours optional access for creation, reads, SQL-filtered lists, changes and archive",
        () =>
          Effect.gen(function* () {
            const created = yield* runFeature(add, { slug: "private", name: "Private" }).pipe(
              Effect.provide(caller("owner")),
            );
            visible.add(created.project.id);
            const hidden = yield* runFeature(add, { slug: "hidden", name: "Hidden" }).pipe(
              Effect.provide(caller("owner")),
            );
            expect(
              yield* runFeature(get, { id: created.project.id }).pipe(
                Effect.provide(caller("reader")),
              ),
            ).toEqual(created.project);
            expect(
              (yield* runFeature(listing, {}).pipe(Effect.provide(caller("reader")))).map(
                (p) => p.id,
              ),
            ).toEqual([created.project.id]);
            expect(yield* runFeature(listing, {}).pipe(Effect.provide(caller("stranger")))).toEqual(
              [],
            );
            for (const id of [created.project.id, hidden.project.id]) {
              expect(
                yield* Effect.flip(
                  runFeature(get, { id }).pipe(Effect.provide(caller("stranger"))),
                ),
              ).toMatchObject({ _tag: "ProjectNotFound" });
            }
            expect(
              yield* Effect.flip(
                runFeature(get, { id: hidden.project.id }).pipe(Effect.provide(caller("reader"))),
              ),
            ).toMatchObject({ _tag: "ProjectNotFound" });
            expect(
              yield* Effect.flip(
                runFeature(add, { slug: "denied", name: "Denied" }).pipe(
                  Effect.provide(caller("reader")),
                ),
              ),
            ).toMatchObject({ _tag: "ProjectAccessDenied" });
            expect(
              yield* Effect.flip(
                runFeature(change, { ref: { id: created.project.id }, patch: { name: "No" } }).pipe(
                  Effect.provide(caller("reader")),
                ),
              ),
            ).toMatchObject({ _tag: "ProjectNotFound" });
            expect(
              yield* Effect.flip(
                runFeature(close, { id: created.project.id }).pipe(
                  Effect.provide(caller("reader")),
                ),
              ),
            ).toMatchObject({ _tag: "ProjectNotFound" });
            expect(
              yield* runFeature(close, { id: created.project.id }).pipe(
                Effect.provide(caller("owner")),
              ),
            ).toMatchObject({ project: { status: "archived" } });
            expect(
              yield* Effect.flip(
                runFeature(get, { id: created.project.id }).pipe(Effect.provide(caller("broken"))),
              ),
            ).toMatchObject({
              _tag: "ProjectAccessUnavailable",
              message: "Project access is unavailable. Try again shortly.",
            });
            expect(
              yield* Effect.flip(runFeature(listing, {}).pipe(Effect.provide(caller("broken")))),
            ).toMatchObject({ _tag: "ProjectAccessUnavailable" });
          }),
      );
    },
  );
}

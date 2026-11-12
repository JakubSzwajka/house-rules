import { platformForTests } from "@house-rules/domain-postgres";
import * as Domain from "@alchemy.run/domain";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { devTokens, Roles, sessionClient, SessionLive } from "@house-rules/stack";
import * as Projects from "../index.ts";
import { alpha, beta, Model, p1, p2 } from "./fixtures.ts";

const {
  CreateProject,
  defaultStatuses,
  Project,
  ProjectDirectory,
  ProjectsPermissions,
  SlugTaken,
} = Projects;

class ProjectsApi extends Domain.Api("ProjectsApi", {
  model: Model,
  commands: ["CreateProject"],
  views: ["ProjectDirectory"],
  aggregates: ["Project"],
}) {}

describe("ProjectsApi", () => {
  const World = Layer.mergeAll(SessionLive, Projects.projectsConfig(defaultStatuses)).pipe(
    Layer.provide(
      Layer.mergeAll(
        devTokens({
          "ann-token": { subject: "ann", orgId: null, roles: ["lead"] },
          "bob-token": { subject: "bob", orgId: null, roles: ["viewer"] },
        }),
        Roles.layer({
          lead: [ProjectsPermissions.read, ProjectsPermissions.write],
          viewer: [ProjectsPermissions.read],
        }),
      ),
    ),
    Layer.provideMerge(Model.layer(Projects.handlers).pipe(Layer.provide(platformForTests))),
  );
  const as = (token: string) =>
    ProjectsApi.clientInProcess.pipe(Effect.provide(sessionClient(token)));

  it.live("creates through the slug claim and reads it back", () =>
    Effect.gen(function* () {
      const ann = yield* as("ann-token");
      yield* ann.CreateProject(alpha, { project: p1, name: "Alpha" });
      const bob = yield* as("bob-token");
      const refused = yield* bob
        .CreateProject(beta, { project: p2, name: "Beta" })
        .pipe(Effect.flip);
      expect(refused._tag).toBe("Forbidden");
      const taken = yield* ann
        .CreateProject(alpha, { project: p2, name: "Copy" })
        .pipe(Effect.flip);
      expect(taken._tag).toBe("SlugTaken");
      const opened = { atLeast: { stream: `Project/${p1}`, version: 1 } };
      const directory = yield* bob.ProjectDirectory.get("projects", opened);
      expect(directory && ProjectDirectory.computed.ordered(directory)).toEqual([
        { id: p1, slug: alpha, name: "Alpha", status: "active" },
      ]);
      const record = yield* bob.Project.get(p1);
      expect(record).toMatchObject({ slug: alpha, status: "active" });
    }).pipe(Effect.scoped, Effect.provide(World)),
  );
});

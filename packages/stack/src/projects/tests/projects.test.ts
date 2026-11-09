import { Story } from "@alchemy.run/domain/Story";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { agent, system } from "../../actor/actor.ts";
import { CurrentActor } from "../../actor/current-actor.context.ts";
import { Forbidden } from "../../access/forbidden.rejection.ts";
import * as Projects from "../index.ts";
import {
  alpha,
  asWriter,
  beta,
  created,
  existingAlpha,
  p1,
  p2,
  project1,
  story,
  writer,
} from "./fixtures.ts";

const {
  ChangeProjectStatus,
  EditProject,
  OpenProject,
  Project,
  ProjectCreated,
  ProjectDirectory,
  ProjectEdited,
  ProjectNotFound,
  ProjectSettings,
  ProjectsPermissions,
  ProjectStatusChanged,
  UnknownStatus,
} = Projects;

describe("projects", () => {
  it.effect("edits a project, and records nothing for an unchanged edit", () =>
    story(
      ...existingAlpha,
      ...asWriter,
      Story.when(project1, new EditProject({ name: "Alpha One" })),
      Story.then(project1, new ProjectEdited({ name: "Alpha One", description: "", by: "ann" })),
      Story.when(project1, new EditProject({ description: "" })),
      Story.then(project1),
      Story.view(ProjectDirectory, "projects", {
        projects: { [p1]: { slug: alpha, name: "Alpha One", status: "active" } },
      }),
    ),
  );

  it.effect("lets an agent with the grant edit as itself, and refuses one without it", () =>
    story(
      ...existingAlpha,
      ...asWriter,
      Story.provide(CurrentActor, agent("reader", "ann")),
      Story.when(project1, new EditProject({ name: "Alpha One" })),
      Story.rejected(new Forbidden({ permission: ProjectsPermissions.write })),
      Story.provide(
        CurrentActor,
        agent("claude", "ann", { permissions: [ProjectsPermissions.write] }),
      ),
      Story.when(project1, new EditProject({ name: "Alpha One" })),
      Story.then(project1, new ProjectEdited({ name: "Alpha One", description: "", by: "claude" })),
    ),
  );

  it.effect("refuses to edit a missing project", () =>
    story(
      ...asWriter,
      Story.when(project1, new EditProject({ name: "Ghost" })),
      Story.rejected(new ProjectNotFound()),
    ),
  );

  it.effect("changes status within the configured set", () =>
    story(
      ...existingAlpha,
      Story.provide(CurrentActor, writer),
      Story.provide(ProjectSettings, {
        statuses: ["active", "paused", "archived"],
        defaultStatus: "active",
      }),
      Story.when(project1, new ChangeProjectStatus({ status: "paused" })),
      Story.then(project1, new ProjectStatusChanged({ from: "active", to: "paused", by: "ann" })),
      Story.when(project1, new ChangeProjectStatus({ status: "done" })),
      Story.rejected(
        new UnknownStatus({ status: "done", statuses: ["active", "paused", "archived"] }),
      ),
      Story.when(project1, new ChangeProjectStatus({ status: "paused" })),
      Story.then(project1),
    ),
  );

  it.effect("archives as a status change the directory shows", () =>
    story(
      ...existingAlpha,
      ...asWriter,
      Story.when(project1, new ChangeProjectStatus({ status: "archived" })),
      Story.then(project1, new ProjectStatusChanged({ from: "active", to: "archived", by: "ann" })),
      Story.view(ProjectDirectory, "projects", {
        projects: { [p1]: { slug: alpha, name: "Alpha", status: "archived" } },
      }),
    ),
  );

  it.effect("orders the directory by name, then slug", () =>
    story(
      Story.given(project1, new ProjectCreated({ ...created, slug: beta, name: "zeta" })),
      Story.given(Project.ref(p2), created),
      Story.view(ProjectDirectory, "projects", (v) =>
        expect(ProjectDirectory.computed.ordered(v).map(({ id }) => id)).toEqual([p2, p1]),
      ),
    ),
  );

  it.effect("lets only the system actor with the grant open a project", () =>
    story(
      Story.provide(CurrentActor, writer),
      Story.when(
        project1,
        new OpenProject({
          slug: alpha,
          name: "Alpha",
          status: "active",
          description: "",
          by: "ann",
        }),
      ),
      Story.rejected(new Forbidden({ permission: ProjectsPermissions.settle })),
      Story.provide(CurrentActor, system("seed", [ProjectsPermissions.settle])),
      Story.when(
        project1,
        new OpenProject({
          slug: alpha,
          name: "Alpha",
          status: "active",
          description: "",
          by: "ann",
        }),
      ),
      Story.then(project1, created),
    ),
  );

  it.effect("refuses statuses without their default, or with a repeat", () =>
    Effect.gen(function* () {
      for (const statuses of [
        { statuses: ["active"], defaultStatus: "archived" },
        { statuses: ["active", "active"], defaultStatus: "active" },
      ]) {
        const failed = yield* Layer.build(Projects.projectsConfig(statuses)).pipe(Effect.flip);
        expect(failed._tag).toBe("SchemaError");
      }
    }).pipe(Effect.scoped),
  );
});

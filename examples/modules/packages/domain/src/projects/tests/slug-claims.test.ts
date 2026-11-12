import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import { describe, expect, it } from "@effect/vitest";
import { agent, CurrentActor, Forbidden, person, PersonId } from "@house-rules/stack";
import * as Projects from "../index.ts";
import {
  alpha,
  alphaClaim,
  asWriter,
  beta,
  betaClaim,
  created,
  existingAlpha,
  Model,
  p1,
  p2,
  project1,
  story,
} from "./fixtures.ts";

const {
  ChangeProjectSlug,
  CreateProject,
  defaultStatuses,
  ProjectDirectory,
  ProjectSettings,
  ProjectSlugChanged,
  ProjectsPermissions,
  ProjectSlugClaimed,
  ProjectSlugReleased,
  ProjectCreated,
  ProjectSlugReserved,
  SlugTaken,
  UnknownStatus,
} = Projects;

describe("slug claims", () => {
  it("the model is well defined", () => expect(Domain.verify(Model)).toEqual([]));

  it.effect("creates a project by reserving its slug first", () =>
    story(
      ...asWriter,
      Story.when(alphaClaim, new CreateProject({ project: p1, name: "Alpha" })),
      Story.then(
        alphaClaim,
        new ProjectSlugReserved({
          project: p1,
          name: "Alpha",
          status: "active",
          description: "",
          by: "ann",
        }),
      ),
      Story.then(project1, created),
      Story.view(ProjectDirectory, "projects", {
        projects: { [p1]: { slug: alpha, name: "Alpha", status: "active" } },
      }),
    ),
  );

  it.effect("refuses a slug another project holds", () =>
    story(
      ...existingAlpha,
      ...asWriter,
      Story.when(alphaClaim, new CreateProject({ project: p2, name: "Other" })),
      Story.rejected(new SlugTaken({ project: p1 })),
    ),
  );

  it.effect("refuses a person without projects:write", () =>
    story(
      Story.provide(CurrentActor, person("bob", { permissions: [ProjectsPermissions.read] })),
      Story.provide(ProjectSettings, defaultStatuses),
      Story.when(alphaClaim, new CreateProject({ project: p1, name: "Alpha" })),
      Story.rejected(new Forbidden({ permission: ProjectsPermissions.write })),
    ),
  );

  it.effect("refuses a status the app does not configure", () =>
    story(
      ...asWriter,
      Story.when(alphaClaim, new CreateProject({ project: p1, name: "Alpha", status: "paused" })),
      Story.rejected(new UnknownStatus({ status: "paused", statuses: ["active", "archived"] })),
    ),
  );

  it.effect("releases the slug when the project id is already taken", () =>
    story(
      ...existingAlpha,
      ...asWriter,
      Story.when(betaClaim, new CreateProject({ project: p1, name: "Again" })),
      Story.then(
        betaClaim,
        new ProjectSlugReserved({
          project: p1,
          name: "Again",
          status: "active",
          description: "",
          by: "ann",
        }),
        new ProjectSlugReleased({ project: p1 }),
      ),
      Story.then(project1),
      Story.state(betaClaim, { project: null }),
    ),
  );

  it.effect("changes a slug: claims the new one, moves the project, frees the old one", () =>
    story(
      ...existingAlpha,
      ...asWriter,
      Story.when(betaClaim, new ChangeProjectSlug({ project: p1 })),
      Story.then(betaClaim, new ProjectSlugClaimed({ project: p1, by: "ann" })),
      Story.then(project1, new ProjectSlugChanged({ from: alpha, to: beta, by: "ann" })),
      Story.then(alphaClaim, new ProjectSlugReleased({ project: p1 })),
      Story.view(ProjectDirectory, "projects", {
        projects: { [p1]: { slug: beta, name: "Alpha", status: "active" } },
      }),
    ),
  );

  it.effect("refuses a new slug another project holds", () =>
    story(
      ...existingAlpha,
      Story.given(betaClaim, new ProjectSlugClaimed({ project: p2, by: "bob" })),
      ...asWriter,
      Story.when(betaClaim, new ChangeProjectSlug({ project: p1 })),
      Story.rejected(new SlugTaken({ project: p2 })),
    ),
  );

  it.effect("gives the claim back when the project does not exist", () =>
    story(
      ...asWriter,
      Story.when(betaClaim, new ChangeProjectSlug({ project: p2 })),
      Story.then(
        betaClaim,
        new ProjectSlugClaimed({ project: p2, by: "ann" }),
        new ProjectSlugReleased({ project: p2 }),
      ),
    ),
  );

  it.effect("carries the person an agent acts for through the slug policy", () => {
    const attribution = { by: "agent:claude", for: PersonId.make("ann") };
    return story(
      Story.provide(
        CurrentActor,
        agent("agent:claude", "ann", { permissions: [ProjectsPermissions.write] }),
      ),
      Story.provide(ProjectSettings, defaultStatuses),
      Story.when(alphaClaim, new CreateProject({ project: p1, name: "Alpha" })),
      Story.then(
        alphaClaim,
        new ProjectSlugReserved({
          project: p1,
          name: "Alpha",
          status: "active",
          description: "",
          ...attribution,
        }),
      ),
      Story.then(
        project1,
        new ProjectCreated({
          slug: alpha,
          name: "Alpha",
          status: "active",
          description: "",
          ...attribution,
        }),
      ),
      Story.when(betaClaim, new ChangeProjectSlug({ project: p1 })),
      Story.then(betaClaim, new ProjectSlugClaimed({ project: p1, ...attribution })),
      Story.then(project1, new ProjectSlugChanged({ from: alpha, to: beta, ...attribution })),
      Story.then(alphaClaim, new ProjectSlugReleased({ project: p1 })),
    );
  });
});

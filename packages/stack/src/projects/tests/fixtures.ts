import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import { person } from "../../actor/actor.ts";
import { CurrentActor } from "../../actor/current-actor.context.ts";
import * as Projects from "../index.ts";

const { defaultStatuses, Project, ProjectCreated, ProjectId, ProjectSettings, ProjectSlug } =
  Projects;
const { ProjectsPermissions, SlugClaim, SlugClaimed } = Projects;

export class Model extends Domain.Model("ProjectsTest", {
  aggregates: [...Projects.aggregates],
  views: [...Projects.views],
  policies: [...Projects.policies],
}) {}

export const story = Story.make(Model, { layer: Projects.handlers });
export const p1 = ProjectId.make("p-1");
export const p2 = ProjectId.make("p-2");
export const alpha = ProjectSlug.make("alpha");
export const beta = ProjectSlug.make("beta");
export const project1 = Project.ref(p1);
export const alphaClaim = SlugClaim.ref(alpha);
export const betaClaim = SlugClaim.ref(beta);
export const writer = person("ann", { permissions: [ProjectsPermissions.write] });
export const created = new ProjectCreated({
  slug: alpha,
  name: "Alpha",
  status: "active",
  description: "",
  by: "ann",
});
export const asWriter = [
  Story.provide(CurrentActor, writer),
  Story.provide(ProjectSettings, defaultStatuses),
] as const;
export const existingAlpha = [
  Story.given(alphaClaim, new SlugClaimed({ project: p1, by: "ann" })),
  Story.given(project1, created),
] as const;

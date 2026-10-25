import { Schema } from "effect";
import { Project } from "./project.js";
const ProjectCreated = Schema.Struct({ kind: Schema.Literal("ProjectCreated"), project: Project });
const ProjectUpdated = Schema.Struct({
  kind: Schema.Literal("ProjectUpdated"),
  before: Project,
  after: Project,
});
export const ProjectEvents = { ProjectCreated, ProjectUpdated } as const;
export const CreateProjectResult = Schema.Struct({
  project: Project,
  events: Schema.Array(ProjectCreated),
});
export type CreateProjectResult = typeof CreateProjectResult.Type;
export const UpdateProjectResult = Schema.Struct({
  project: Project,
  events: Schema.Array(ProjectUpdated),
});
export type UpdateProjectResult = typeof UpdateProjectResult.Type;

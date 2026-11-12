import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor, Forbidden, Session } from "@house-rules/stack";
import { ProjectId, ProjectName } from "./project.id.ts";
import { ProjectNotFound } from "./project-not-found.rejection.ts";

export class ProjectEdited extends Domain.Event("ProjectEdited", {
  name: Schema.String,
  description: Schema.String,
  by: Schema.String,
  for: ActedFor,
}) {}

export class EditProject extends Domain.Command("EditProject", {
  target: ProjectId,
  middleware: [Session],
  input: {
    name: Schema.optionalKey(ProjectName),
    description: Schema.optionalKey(Schema.String),
  },
  events: [ProjectEdited],
  rejects: [Forbidden, ProjectNotFound],
}) {}

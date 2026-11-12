import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor, Forbidden, Session } from "@house-rules/stack";
import { ProjectId, ProjectSlug } from "./project.id.ts";

export class ProjectCreated extends Domain.Event("ProjectCreated", {
  slug: ProjectSlug,
  name: Schema.String,
  status: Schema.String,
  description: Schema.String,
  by: Schema.String,
  for: ActedFor,
}) {}

export class ProjectExists extends Domain.Rejection("ProjectExists", {}, { httpApiStatus: 409 }) {}

export class OpenProject extends Domain.Command("OpenProject", {
  target: ProjectId,
  middleware: [Session],
  input: {
    slug: ProjectSlug,
    name: Schema.String,
    status: Schema.String,
    description: Schema.String,
    by: Schema.String,
    for: ActedFor,
  },
  events: [ProjectCreated],
  rejects: [Forbidden, ProjectExists],
}) {}

import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor, Forbidden, Session } from "@house-rules/stack";
import { ProjectId, ProjectSlug } from "./project.id.ts";
import { ProjectNotFound } from "./project-not-found.rejection.ts";

export class ProjectSlugChanged extends Domain.Event("ProjectSlugChanged", {
  from: ProjectSlug,
  to: ProjectSlug,
  by: Schema.String,
  for: ActedFor,
}) {}

export class SwitchProjectSlug extends Domain.Command("SwitchProjectSlug", {
  target: ProjectId,
  middleware: [Session],
  input: { slug: ProjectSlug, by: Schema.String, for: ActedFor },
  events: [ProjectSlugChanged],
  rejects: [Forbidden, ProjectNotFound],
}) {}

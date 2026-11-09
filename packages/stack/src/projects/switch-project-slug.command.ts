import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { ProjectId, ProjectSlug } from "./project.id.ts";
import { ProjectNotFound } from "./project-not-found.rejection.ts";
import { ActedFor } from "../actor/actor.ts";

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

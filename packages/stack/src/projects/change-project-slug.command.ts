import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { ProjectId, ProjectSlug } from "./project.id.ts";
import { SlugTaken } from "./slug-taken.rejection.ts";

export class ProjectSlugClaimed extends Domain.Event("ProjectSlugClaimed", {
  project: ProjectId,
  by: Schema.String,
}) {}

export class ChangeProjectSlug extends Domain.Command("ChangeProjectSlug", {
  target: ProjectSlug,
  middleware: [Session],
  input: { project: ProjectId },
  events: [ProjectSlugClaimed],
  rejects: [Forbidden, SlugTaken],
}) {}

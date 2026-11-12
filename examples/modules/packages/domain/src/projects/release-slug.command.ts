import * as Domain from "@alchemy.run/domain";
import { Forbidden, Session } from "@house-rules/stack";
import { ProjectId, ProjectSlug } from "./project.id.ts";

export class ProjectSlugReleased extends Domain.Event("ProjectSlugReleased", {
  project: ProjectId,
}) {}

export class ReleaseSlug extends Domain.Command("ReleaseSlug", {
  target: ProjectSlug,
  middleware: [Session],
  input: { project: ProjectId },
  events: [ProjectSlugReleased],
  rejects: [Forbidden],
}) {}

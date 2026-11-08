import * as Domain from "@alchemy.run/domain";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { ProjectId, ProjectSlug } from "./project.id.ts";

export class SlugReleased extends Domain.Event("SlugReleased", { project: ProjectId }) {}

export class ReleaseSlug extends Domain.Command("ReleaseSlug", {
  target: ProjectSlug,
  middleware: [Session],
  input: { project: ProjectId },
  events: [SlugReleased],
  rejects: [Forbidden],
}) {}

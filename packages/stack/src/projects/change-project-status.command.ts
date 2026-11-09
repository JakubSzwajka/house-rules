import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { ProjectId } from "./project.id.ts";
import { ProjectNotFound } from "./project-not-found.rejection.ts";
import { ProjectsConfig } from "./projects-config.middleware.ts";
import { UnknownStatus } from "./unknown-status.rejection.ts";
import { ActedFor } from "../actor/actor.ts";

export class ProjectStatusChanged extends Domain.Event("ProjectStatusChanged", {
  from: Schema.String,
  to: Schema.String,
  by: Schema.String,
  for: ActedFor,
}) {}

export class ChangeProjectStatus extends Domain.Command("ChangeProjectStatus", {
  target: ProjectId,
  middleware: [Session, ProjectsConfig],
  input: { status: Schema.String },
  events: [ProjectStatusChanged],
  rejects: [Forbidden, ProjectNotFound, UnknownStatus],
}) {}

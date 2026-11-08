import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { ProjectId, ProjectName, ProjectSlug } from "./project.id.ts";
import { ProjectsConfig } from "./projects-config.middleware.ts";
import { SlugTaken } from "./slug-taken.rejection.ts";
import { UnknownStatus } from "./unknown-status.rejection.ts";

export class SlugReserved extends Domain.Event("SlugReserved", {
  project: ProjectId,
  name: Schema.String,
  status: Schema.String,
  description: Schema.String,
  by: Schema.String,
}) {}

export class CreateProject extends Domain.Command("CreateProject", {
  target: ProjectSlug,
  middleware: [Session, ProjectsConfig],
  input: {
    project: ProjectId,
    name: ProjectName,
    status: Schema.optionalKey(Schema.String),
    description: Schema.optionalKey(Schema.String),
  },
  events: [SlugReserved],
  rejects: [Forbidden, SlugTaken, UnknownStatus],
}) {}

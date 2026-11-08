import * as Domain from "@alchemy.run/domain";
import { ProjectId } from "./project.id.ts";

export class SlugTaken extends Domain.Rejection(
  "SlugTaken",
  { project: ProjectId },
  { httpApiStatus: 409 },
) {}

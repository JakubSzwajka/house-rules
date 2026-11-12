import * as Domain from "@alchemy.run/domain";

export class ProjectNotFound extends Domain.Rejection(
  "ProjectNotFound",
  {},
  { httpApiStatus: 404 },
) {}

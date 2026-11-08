import * as Domain from "@alchemy.run/domain";

export class WorkItemNotFound extends Domain.Rejection(
  "WorkItemNotFound",
  {},
  { httpApiStatus: 404 },
) {}

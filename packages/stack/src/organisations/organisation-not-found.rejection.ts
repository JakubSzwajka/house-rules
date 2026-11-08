import * as Domain from "@alchemy.run/domain";

export class OrganisationNotFound extends Domain.Rejection(
  "OrganisationNotFound",
  {},
  { httpApiStatus: 404 },
) {}

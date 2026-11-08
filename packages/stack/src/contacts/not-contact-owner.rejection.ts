import * as Domain from "@alchemy.run/domain";

export class NotContactOwner extends Domain.Rejection(
  "NotContactOwner",
  {},
  { httpApiStatus: 403 },
) {}

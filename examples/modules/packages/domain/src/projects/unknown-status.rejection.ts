import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class UnknownStatus extends Domain.Rejection(
  "UnknownStatus",
  { status: Schema.String, statuses: Schema.Array(Schema.String) },
  { httpApiStatus: 400 },
) {}

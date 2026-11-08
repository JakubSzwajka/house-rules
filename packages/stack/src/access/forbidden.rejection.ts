import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class Forbidden extends Domain.Rejection(
  "Forbidden",
  { permission: Schema.String },
  { httpApiStatus: 403 },
) {}

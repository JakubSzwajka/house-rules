import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class NotAuthor extends Domain.Rejection(
  "NotAuthor",
  { author: Schema.String },
  { httpApiStatus: 403 },
) {}

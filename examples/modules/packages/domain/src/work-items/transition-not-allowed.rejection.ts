import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class TransitionNotAllowed extends Domain.Rejection(
  "TransitionNotAllowed",
  { from: Schema.String, to: Schema.String },
  { httpApiStatus: 409 },
) {}

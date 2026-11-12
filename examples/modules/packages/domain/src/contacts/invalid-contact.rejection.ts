import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class InvalidContact extends Domain.Rejection(
  "InvalidContact",
  {
    reason: Schema.Literals([
      "value-required",
      "value-not-allowed",
      "purpose-not-offered",
      "not-verifiable",
    ]),
  },
  { httpApiStatus: 400 },
) {}

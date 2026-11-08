import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class DuplicateContact extends Domain.Rejection(
  "DuplicateContact",
  { contactId: Schema.String },
  { httpApiStatus: 409 },
) {}

import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class ContactNotFound extends Domain.Rejection(
  "ContactNotFound",
  { contactId: Schema.String },
  { httpApiStatus: 404 },
) {}

import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class VerificationNotSent extends Schema.TaggedError<VerificationNotSent>()(
  "VerificationNotSent",
  { reason: Schema.String },
) {}

export class CodeInvalid extends Schema.TaggedError<CodeInvalid>()("CodeInvalid", {}) {}

export const CodeTarget = {
  book: Schema.String,
  contactId: Schema.String,
  address: Schema.String,
};

export class VerificationCodes extends Domain.ExternalSystem("VerificationCodes", {
  send: {
    args: { ...CodeTarget, type: Schema.Literals(["email", "phone"]) },
    error: VerificationNotSent,
  },
  check: { args: { code: Schema.String }, success: CodeTarget, error: CodeInvalid },
}) {}

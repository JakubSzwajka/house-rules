import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export class SessionControlUnavailable extends Schema.TaggedError<SessionControlUnavailable>()(
  "SessionControlUnavailable",
  { kind: errorKind("unavailable") },
) {
  override get message() {
    return "Sessions could not be ended. Try again shortly.";
  }
}
export class SessionsPartlyEnded extends Schema.TaggedError<SessionsPartlyEnded>()(
  "SessionsPartlyEnded",
  { kind: errorKind("unavailable"), ended: Schema.Int, remaining: Schema.Int },
) {
  override get message() {
    return "Some sessions could not be ended. Try again shortly.";
  }
}

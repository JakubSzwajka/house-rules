import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export class CompositionClosed extends Schema.TaggedError<CompositionClosed>()(
  "CompositionClosed",
  {
    kind: errorKind("unavailable"),
  },
) {
  override get message(): string {
    return "The app is shutting down.";
  }
}

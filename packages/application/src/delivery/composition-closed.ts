import { Schema } from "effect";

export class CompositionClosed extends Schema.TaggedError<CompositionClosed>()(
  "CompositionClosed",
  {},
) {}

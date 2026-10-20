import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export class Refused extends Schema.TaggedError<Refused>()("Refused", {
  kind: errorKind("forbidden"),
  status: Schema.Finite,
  code: Schema.String,
  message: Schema.String,
  challenge: Schema.optionalKey(Schema.String),
}) {}

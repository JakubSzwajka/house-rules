import type { Context, Effect } from "effect";
import { Schema } from "effect";

export type Incoming = Readonly<{ headers: Headers; url: string }>;

export class Refused extends Schema.TaggedError<Refused>()("Refused", {
  status: Schema.Int,
  code: Schema.String,
  message: Schema.String,
  challenge: Schema.optionalKey(Schema.String),
}) {}

export type Caller<C, R = never> = (
  incoming: Incoming,
) => Effect.Effect<Context.Context<C>, Refused, R>;

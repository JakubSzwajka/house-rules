import { ActorId } from "@house-rules/domain";
import { Schema } from "effect";

export const BindingKey = Schema.Struct({
  issuer: Schema.NonEmptyString,
  subject: Schema.NonEmptyString,
});
export type BindingKey = typeof BindingKey.Type;

export const Binding = Schema.Struct({
  ...BindingKey.fields,
  actorId: ActorId,
  createdAt: Schema.Int,
});
export type Binding = typeof Binding.Type;

export class BindingInvalid extends Schema.TaggedError<BindingInvalid>()("BindingInvalid", {
  message: Schema.String,
}) {}

export class BindingTaken extends Schema.TaggedError<BindingTaken>()("BindingTaken", {
  issuer: Schema.String,
  subject: Schema.String,
}) {
  override get message(): string {
    return "This login is already bound to another actor.";
  }
}

export class IdentityStoreUnavailable extends Schema.TaggedError<IdentityStoreUnavailable>()(
  "IdentityStoreUnavailable",
  { cause: Schema.Defect() },
) {}

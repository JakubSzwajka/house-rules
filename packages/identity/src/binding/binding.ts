import { ActorId, errorKind } from "@house-rules/domain/contract";
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

export class IdentityCallerDenied extends Schema.TaggedError<IdentityCallerDenied>()(
  "IdentityCallerDenied",
  { kind: errorKind("forbidden") },
) {}

export class BindingInvalid extends Schema.TaggedError<BindingInvalid>()("BindingInvalid", {
  kind: errorKind("invalid"),
  message: Schema.String,
}) {}

export class BindingTaken extends Schema.TaggedError<BindingTaken>()("BindingTaken", {
  kind: errorKind("conflict"),
  issuer: Schema.String,
  subject: Schema.String,
}) {
  override get message(): string {
    return "This login is already bound to another actor.";
  }
}

export class IdentityStoreUnavailable extends Schema.TaggedError<IdentityStoreUnavailable>()(
  "IdentityStoreUnavailable",
  { kind: errorKind("unavailable"), cause: Schema.Defect() },
) {
  override get message(): string {
    return "Login bindings are unavailable. Try again shortly.";
  }
}

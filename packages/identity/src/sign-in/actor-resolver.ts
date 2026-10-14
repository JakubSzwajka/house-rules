import type { Principal } from "@house-rules/application";
import { ActorId } from "@house-rules/domain";
import { Context, Effect, Layer, Option, Schema } from "effect";
import type { IdentityStoreUnavailable } from "../binding/binding.js";

export class ForeignIssuer extends Schema.TaggedError<ForeignIssuer>()("ForeignIssuer", {
  issuer: Schema.String,
}) {}

export type ActorResolverService = Readonly<{
  resolve: (
    principal: Principal,
  ) => Effect.Effect<Option.Option<ActorId>, IdentityStoreUnavailable | ForeignIssuer>;
}>;

const decodeActorId = Schema.decodeUnknownOption(ActorId);

export class ActorResolver extends Context.Service<ActorResolver, ActorResolverService>()(
  "@house-rules/identity/ActorResolver",
) {
  // No storage: the subject is the ActorId, for exactly one issuer. Any other issuer fails with `ForeignIssuer`, before FirstSignIn.
  static readonly subject = (options: Readonly<{ issuer: string }>): Layer.Layer<ActorResolver> =>
    Layer.succeed(ActorResolver, {
      resolve: (principal) =>
        principal.issuer === options.issuer
          ? Effect.succeed(decodeActorId(principal.subject))
          : Effect.fail(new ForeignIssuer({ issuer: principal.issuer })),
    });
}

import { type Principal, Refused } from "@house-rules/application";
import type { ActorId } from "@house-rules/domain";
import { Context, Effect, Layer } from "effect";

export type FirstSignInService = (principal: Principal) => Effect.Effect<ActorId, Refused>;

export class FirstSignIn extends Context.Service<FirstSignIn, FirstSignInService>()(
  "@house-rules/identity/FirstSignIn",
) {
  static readonly refuse: Layer.Layer<FirstSignIn> = Layer.succeed(FirstSignIn, () =>
    Effect.fail(
      new Refused({
        status: 403,
        code: "not_invited",
        message: "This login is not bound to an account here.",
      }),
    ),
  );
}

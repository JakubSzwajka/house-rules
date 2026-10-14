import { DevSignIn, devSignInContract } from "@example/dev-sign-in";
import { implement } from "@house-rules/application";
import { Effect } from "effect";

export const devSignIn = implement(devSignInContract, ({ name }) =>
  Effect.gen(function* devSignInHandler() {
    const devSignIn = yield* DevSignIn;
    return yield* devSignIn.signIn(name);
  }),
);

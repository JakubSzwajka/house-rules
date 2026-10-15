import { Accounts, signUpContract } from "@example/accounts";
import { implement } from "@house-rules/application";
import { Effect } from "effect";

export const signUp = implement(signUpContract, (input) =>
  Effect.gen(function* signUpHandler() {
    const accounts = yield* Accounts;
    return yield* accounts.signUp(input);
  }),
);

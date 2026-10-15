import { Accounts, signInContract } from "@example/accounts";
import { implement } from "@house-rules/application";
import { NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Schema } from "effect";

export const signIn = implement(signInContract, (input) =>
  Effect.gen(function* signInHandler() {
    const accounts = yield* Accounts;
    // The unit commits the failure count first; only then does a refusal become the typed error.
    const outcome = yield* UnitOfWork.atomic(accounts.signIn(input)).pipe(
      Effect.catchIf(Schema.is(NoOpenUnit), Effect.die),
    );
    return yield* Effect.fromResult(outcome);
  }),
);

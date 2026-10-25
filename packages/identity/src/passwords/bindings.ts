import { bindOperation } from "@house-rules/application";
import type { ActorId } from "@house-rules/domain";
import { Effect, Result } from "effect";
import type { PasswordMethods } from "./accounts.js";
import { AccountId } from "./account.js";
import { AccountStoreUnavailable } from "./store-unavailable.js";
import { PasswordOperations } from "./operations.js";

export const bindPasswords = (
  accounts: PasswordMethods,
  accountFor: (actorId: ActorId) => Effect.Effect<AccountId | undefined, AccountStoreUnavailable>,
) => [
  bindOperation(PasswordOperations.signUp, (input) => accounts.signUp(input)),
  bindOperation(PasswordOperations.signIn, (input) =>
    accounts.signIn(input).pipe(
      Effect.map(
        Result.match({
          onSuccess: (value) => value,
          onFailure: () => ({ _tag: "InvalidCredentials" as const }),
        }),
      ),
    ),
  ),
  bindOperation(PasswordOperations.changePassword, (input, { caller }) =>
    Effect.gen(function* () {
      const accountId = caller.kind === "person" ? yield* accountFor(caller.actor.id) : undefined;
      if (accountId === undefined) return { _tag: "InvalidCredentials" as const };
      const outcome = yield* accounts.changePassword({ accountId, ...input });
      return Result.match(outcome, {
        onSuccess: () => ({ _tag: "PasswordChanged" as const }),
        onFailure: () => ({ _tag: "InvalidCredentials" as const }),
      });
    }),
  ),
];

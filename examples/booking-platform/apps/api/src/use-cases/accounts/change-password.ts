import {
  AccountId,
  Accounts,
  AccountsIssuer,
  AccountStoreUnavailable,
  changePasswordContract,
  InvalidCredentials,
} from "@example/accounts";
import { CurrentActor, implement } from "@house-rules/application";
import { NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Identity } from "@house-rules/identity";
import { Effect, Schema } from "effect";

export const changePassword = implement(changePasswordContract, ({ current, next }) =>
  Effect.gen(function* changePasswordHandler() {
    const actor = yield* CurrentActor;
    const accounts = yield* Accounts;
    const issuer = yield* AccountsIssuer;
    const identity = yield* Identity;
    // The account id is the subject of this actor's login from the app's own issuer.
    const bindings = yield* identity
      .bindingsOf(actor.id)
      .pipe(Effect.mapError((cause) => new AccountStoreUnavailable({ cause })));
    const login = bindings.find((binding) => binding.issuer === issuer.issuer);
    if (login === undefined) return yield* new InvalidCredentials();
    const accountId = AccountId.make(login.subject);
    // A wrong current password counts toward the lock, so the unit commits before the refusal.
    const outcome = yield* UnitOfWork.atomic(
      accounts.changePassword({ accountId, current, next }),
    ).pipe(Effect.catchIf(Schema.is(NoOpenUnit), Effect.die));
    yield* Effect.fromResult(outcome);
    return {};
  }),
);

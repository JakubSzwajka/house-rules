import { expect, it } from "@effect/vitest";
import { CurrentActor, Forbidden, Grant, implement } from "@house-rules/application";
import { Actor, ActorId, memoryUnitOfWork, NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import {
  AccountId,
  AccountPermissions,
  Accounts,
  AccountsIssuer,
  changePasswordContract,
  Lockout,
  signInContract,
  signUpContract,
} from "../index.js";

const signUp = implement(signUpContract, (input) =>
  Effect.gen(function* () {
    return yield* (yield* Accounts).signUp(input);
  }),
);
const committed = <A, E, R>(outcome: Effect.Effect<A, E | NoOpenUnit, R>) =>
  // The unit commits the failure count before the refusal becomes the typed error.
  UnitOfWork.atomic(outcome).pipe(Effect.catchIf(Schema.is(NoOpenUnit), Effect.die));

const signIn = implement(signInContract, (input) =>
  Effect.gen(function* () {
    const accounts = yield* Accounts;
    return yield* Effect.fromResult(yield* committed(accounts.signIn(input)));
  }),
);
const changePassword = (accountId: AccountId) =>
  implement(changePasswordContract, ({ current, next }) =>
    Effect.gen(function* () {
      yield* CurrentActor;
      const accounts = yield* Accounts;
      yield* Effect.fromResult(
        yield* committed(accounts.changePassword({ accountId, current, next })),
      );
      return {};
    }),
  );

const world = Accounts.layerMemory.pipe(
  Layer.provideMerge(
    Layer.merge(
      AccountsIssuer.ephemeral({ issuer: "https://accounts.example.test" }),
      memoryUnitOfWork,
    ),
  ),
);
const member = Layer.merge(
  Grant.layerFromPermissions(Object.values(AccountPermissions)),
  Layer.succeed(CurrentActor, Actor.make({ id: ActorId.make("member") })),
);

it.layer(world)("Accounts contracts", (test) => {
  test.effect("names, permissions and flags are the shipped ones", () =>
    Effect.sync(() => {
      expect([
        signUpContract.name,
        signUpContract.permission,
        signUpContract.transactional,
      ]).toEqual(["sign_up", "public", true]);
      expect([
        signInContract.name,
        signInContract.permission,
        signInContract.transactional,
      ]).toEqual(["sign_in", "public", false]);
      expect([
        changePasswordContract.name,
        changePasswordContract.permission,
        changePasswordContract.transactional,
      ]).toEqual(["change_password", "accounts:update", false]);
    }),
  );
  test.effect("sign up and sign in run with no Grant and no actor", () =>
    Effect.gen(function* () {
      const password = "a long enough secret";
      const signedUp = yield* signUp.handler({
        email: "contract@example.test",
        password,
        displayName: "Contract",
      });
      const signedIn = yield* signIn.handler({ email: "contract@example.test", password });
      expect(Object.keys(signedIn).sort()).toEqual(["expiresAt", "token"]);
      expect(Object.keys(signedUp).sort()).toEqual(["accountId", "expiresAt", "token"]);
      expect(JSON.stringify({ signedUp, signedIn })).not.toContain(password);
    }),
  );
  test.effect("refused sign-ins through the capability still count toward the lock", () =>
    Effect.gen(function* () {
      const password = "a long enough secret";
      yield* signUp.handler({ email: "count@example.test", password, displayName: "Count" });
      for (let attempt = 0; attempt < Lockout.failures; attempt += 1) {
        const error = yield* Effect.flip(
          signIn.handler({ email: "count@example.test", password: "wrong password" }),
        );
        expect(error._tag).toBe("InvalidCredentials");
        expect(JSON.stringify(error)).not.toContain("wrong password");
      }
      const locked = yield* Effect.flip(signIn.handler({ email: "count@example.test", password }));
      // A locked account answers like a wrong password, so the answer never says the email exists.
      expect(locked._tag).toBe("InvalidCredentials");
    }),
  );
  test.effect("change_password needs the update permission and the current password", () =>
    Effect.gen(function* () {
      const password = "a long enough secret";
      const { accountId } = yield* signUp.handler({
        email: "change-contract@example.test",
        password,
        displayName: "Change",
      });
      const change = changePassword(accountId);
      const denied = yield* Effect.flip(
        change
          .handler({ current: password, next: "another long secret" })
          .pipe(
            Effect.provide(
              Layer.merge(
                Grant.denyAll,
                Layer.succeed(CurrentActor, Actor.make({ id: ActorId.make("member") })),
              ),
            ),
          ),
      );
      expect(denied).toBeInstanceOf(Forbidden);
      const wrong = yield* Effect.flip(
        change
          .handler({ current: "not the password", next: "another long secret" })
          .pipe(Effect.provide(member)),
      );
      expect(wrong._tag).toBe("InvalidCredentials");
      yield* change
        .handler({ current: password, next: "another long secret" })
        .pipe(Effect.provide(member));
      const signedIn = yield* signIn.handler({
        email: "change-contract@example.test",
        password: "another long secret",
      });
      expect(signedIn.token.length).toBeGreaterThan(0);
    }),
  );
  test.effect("six wrong current passwords through change_password lock the account", () =>
    Effect.gen(function* () {
      const password = "a long enough secret";
      const email = "change-lock@example.test";
      const { accountId } = yield* signUp.handler({ email, password, displayName: "Guess" });
      const change = changePassword(accountId);
      for (let attempt = 0; attempt < Lockout.failures + 1; attempt += 1) {
        const error = yield* Effect.flip(
          change
            .handler({ current: `guess number ${attempt}`, next: "another long secret" })
            .pipe(Effect.provide(member)),
        );
        expect(error._tag).toBe("InvalidCredentials");
      }
      const locked = yield* Effect.flip(
        change
          .handler({ current: password, next: "another long secret" })
          .pipe(Effect.provide(member)),
      );
      expect(locked._tag).toBe("InvalidCredentials");
      expect((yield* Effect.flip(signIn.handler({ email, password })))._tag).toBe(
        "InvalidCredentials",
      );
    }),
  );
});

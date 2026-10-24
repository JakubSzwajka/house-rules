import { expect, it } from "@effect/vitest";
import { CurrentActor, type Principal, Refused, TokenRejected } from "@house-rules/application";
import { ActorId, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Option } from "effect";
import {
  ActorResolver,
  Credentials,
  FirstSignIn,
  Identity,
  IdentityStoreUnavailable,
  type IdentityWhoOptions,
} from "../index.js";

const issuer = "https://issuer.test";
const audience = "https://api.test";

const principal = (
  subject: string,
  from = issuer,
  scopes: ReadonlyArray<string> = [],
): Principal => ({
  issuer: from,
  subject,
  audience: [audience],
  scopes,
  claims: { email: "same@example.test" },
});

const principals: Record<string, Principal> = {
  known: principal("user-known", issuer, ["read"]),
  stranger: principal("user-stranger"),
  newcomer: principal("user-new"),
  foreign: principal("user-known", "https://other.test"),
};

const fakeAuthenticator = Layer.succeed(Credentials, {
  verify: (token, options) => {
    if (token === "down") return Effect.fail(new TokenRejected({ reason: "unavailable" }));
    if (options?.audience !== undefined && options.audience !== audience)
      return Effect.fail(new TokenRejected({ reason: "wrong_audience" }));
    const found = principals[token];
    return found === undefined
      ? Effect.fail(new TokenRejected({ reason: "invalid" }))
      : Effect.succeed({ kind: "jwt" as const, principal: found, actorId: Option.none<never>() });
  },
});

const incoming = (headers: Record<string, string> = {}) => ({
  headers: new Headers(headers),
  url: "https://api.test/things",
});
const bearer = (token: string) => incoming({ authorization: `Bearer ${token}` });

const options: IdentityWhoOptions = {
  token: "bearer",
  audience,
  challenge: (error) => (error === undefined ? "Bearer realm" : `Bearer error="${error}"`),
};
const caller = Identity.who(options).resolve;

const knownActor = ActorId.make("actor-known");
const seedKnown = Effect.gen(function* () {
  const identity = yield* Identity;
  yield* UnitOfWork.atomic(identity.bind(principals.known ?? principal("x"), knownActor)).pipe(
    Effect.catchTag("BindingTaken", () => Effect.void),
  );
});

const inviteOnly = Layer.mergeAll(
  Identity.layerMemory(),
  Identity.refuse,
  fakeAuthenticator,
  Identity.everyoneActive,
).pipe(Layer.provideMerge(memoryUnitOfWork));

const createOnFirstSignIn = Layer.effect(
  FirstSignIn,
  Effect.gen(function* () {
    const identity = yield* Identity;
    const unitOfWork = yield* UnitOfWork;
    return (verified: Principal) =>
      unitOfWork
        .atomic(
          Effect.gen(function* () {
            const id = ActorId.make(`actor-${verified.subject}`);
            yield* identity.bind(verified, id);
            return id;
          }),
        )
        .pipe(
          Effect.mapError(
            () => new Refused({ status: 503, code: "sign_in_failed", message: "Try again." }),
          ),
        );
  }),
);
const openSignUp = createOnFirstSignIn.pipe(
  Layer.provideMerge(
    Layer.mergeAll(Identity.layerMemory(), fakeAuthenticator, Identity.everyoneActive),
  ),
  Layer.provideMerge(memoryUnitOfWork),
);

const subjectMode = Layer.mergeAll(
  Identity.subject({ issuer }),
  Identity.everyoneActive,
  Identity.refuse,
  fakeAuthenticator,
);

it.layer(inviteOnly)("Identity.who with bindings and Identity.refuse", (test) => {
  test.effect("a missing token is 401 token_missing with the bare challenge", () =>
    Effect.gen(function* () {
      const refused = yield* Effect.flip(caller(incoming()));
      expect(refused).toMatchObject({
        status: 401,
        code: "token_missing",
        challenge: "Bearer realm",
      });
    }),
  );

  test.effect("without a challenge option no challenge is sent", () =>
    Effect.gen(function* () {
      const plain = Identity.who({ token: "bearer" });
      const refused = yield* Effect.flip(plain.resolve(incoming()));
      expect(refused.status).toBe(401);
      expect(refused.challenge).toBeUndefined();
    }),
  );

  test.effect("an invalid token is 401 token_invalid with the invalid_token challenge", () =>
    Effect.gen(function* () {
      const refused = yield* Effect.flip(caller(bearer("forged")));
      expect(refused).toMatchObject({
        status: 401,
        code: "token_invalid",
        challenge: 'Bearer error="invalid_token"',
      });
    }),
  );

  test.effect("the audience option reaches the Authenticator", () =>
    Effect.gen(function* () {
      const elsewhere = Identity.who({ ...options, audience: "https://elsewhere.test" });
      const refused = yield* Effect.flip(elsewhere.resolve(bearer("known")));
      expect(refused).toMatchObject({ status: 401, code: "token_invalid" });
    }),
  );

  test.effect("an unavailable Authenticator is 503 with no challenge", () =>
    Effect.gen(function* () {
      const refused = yield* Effect.flip(caller(bearer("down")));
      expect(refused).toMatchObject({ status: 503, code: "auth_unavailable" });
      expect(refused.challenge).toBeUndefined();
    }),
  );

  test.effect("an unavailable identity lookup is 503 and never calls the new-login hook", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const broken = Layer.succeed(ActorResolver, {
        resolve: () =>
          Effect.fail(new IdentityStoreUnavailable({ cause: "private database detail" })),
      });
      const hook = Layer.succeed(FirstSignIn, (verified: Principal) =>
        Effect.sync(() => {
          calls.push(verified.subject);
          return knownActor;
        }),
      );
      const refused = yield* Effect.flip(
        caller(bearer("known")).pipe(Effect.provide(Layer.merge(broken, hook))),
      );
      expect(refused).toMatchObject({ status: 503, code: "identity_unavailable" });
      expect(refused.challenge).toBeUndefined();
      expect(refused.message).not.toContain("private database detail");
      expect(calls).toEqual([]);
    }),
  );

  test.effect("a bound login returns an Actor without installing request services", () =>
    Effect.gen(function* () {
      yield* seedKnown;
      expect(yield* caller(bearer("known"))).toEqual({ id: knownActor });
      expect(yield* Effect.serviceOption(CurrentActor)).toEqual(Option.none());
    }),
  );

  test.effect("the effectful new-login hook runs once and preserves its Refused", () =>
    Effect.gen(function* () {
      const seen: Array<string> = [];
      const hook = Layer.succeed(FirstSignIn, (verified: Principal) =>
        Effect.sync(() => {
          seen.push(verified.subject);
          return ActorId.make("hook-actor");
        }),
      );
      expect(yield* caller(bearer("stranger")).pipe(Effect.provide(hook))).toEqual({
        id: "hook-actor",
      });
      expect(seen).toEqual(["user-stranger"]);
      const refusing = Layer.succeed(FirstSignIn, () =>
        Effect.fail(new Refused({ status: 403, code: "scope", message: "No." })),
      );
      expect(
        yield* Effect.flip(caller(bearer("stranger")).pipe(Effect.provide(refusing))),
      ).toMatchObject({ code: "scope" });
    }),
  );

  test.effect("a cookie token source reads the named cookie", () =>
    Effect.gen(function* () {
      yield* seedKnown;
      const cookies = Identity.who({ ...options, token: { cookie: "session" } });
      const actor = yield* cookies.resolve(incoming({ cookie: "other=x; session=known" }));
      expect(actor.id).toBe(knownActor);
      expect(yield* Effect.flip(cookies.resolve(bearer("known")))).toMatchObject({
        code: "token_missing",
      });
    }),
  );

  test.effect("an unknown login is refused 403 not_invited, and the same email does not link", () =>
    Effect.gen(function* () {
      yield* seedKnown;
      const refused = yield* Effect.flip(caller(bearer("stranger")));
      expect(refused).toMatchObject({ status: 403, code: "not_invited" });
      expect(refused.challenge).toBeUndefined();
    }),
  );
});

it.layer(openSignUp)("Identity.who with an app FirstSignIn filler", (test) => {
  test.effect("an unknown login is bound inside the filler's unit, then resolves", () =>
    Effect.gen(function* () {
      const expected = ActorId.make("actor-user-new");
      const first = yield* caller(bearer("newcomer"));
      expect(first).toEqual({ id: expected });
      const identity = yield* Identity;
      expect(yield* identity.resolve(principals.newcomer ?? principal("x"))).toEqual(
        Option.some(expected),
      );
      const again = yield* caller(bearer("newcomer"));
      expect(again).toEqual({ id: expected });
      expect(yield* identity.bindingsOf(expected)).toHaveLength(1);
    }),
  );
});

it.layer(subjectMode)("Identity.who with Identity.subject", (test) => {
  test.effect("the subject is the ActorId for the configured issuer", () =>
    Effect.gen(function* () {
      expect(yield* caller(bearer("known"))).toEqual({ id: "user-known" });
    }),
  );

  test.effect("another issuer is refused 401 token_invalid and FirstSignIn is never called", () =>
    Effect.gen(function* () {
      const calls: Array<Principal> = [];
      const accepting = Layer.succeed(FirstSignIn, (verified: Principal) =>
        Effect.sync(() => {
          calls.push(verified);
          return ActorId.make("admitted");
        }),
      );
      const refused = yield* Effect.flip(caller(bearer("foreign"))).pipe(Effect.provide(accepting));
      expect(refused).toMatchObject({
        status: 401,
        code: "token_invalid",
        challenge: 'Bearer error="invalid_token"',
      });
      expect(calls).toEqual([]);
    }),
  );

  test.effect("another issuer without a challenge option is 401 with no challenge", () =>
    Effect.gen(function* () {
      const plain = Identity.who({ token: "bearer" });
      const refused = yield* Effect.flip(plain.resolve(bearer("foreign")));
      expect(refused).toMatchObject({ status: 401, code: "token_invalid" });
      expect(refused.challenge).toBeUndefined();
    }),
  );
});

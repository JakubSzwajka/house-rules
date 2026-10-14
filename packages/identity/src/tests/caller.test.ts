import { expect, it } from "@effect/vitest";
import {
  Authenticator,
  CurrentActor,
  Grant,
  type Principal,
  Refused,
  TokenRejected,
} from "@house-rules/application";
import { ActorId, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Context, Effect, Layer, Option } from "effect";
import { FirstSignIn, Identity, type IdentityCallerOptions } from "../index.js";

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

const fakeAuthenticator = Layer.succeed(Authenticator, {
  verify: (token, options) => {
    if (token === "down") return Effect.fail(new TokenRejected({ reason: "unavailable" }));
    if (options?.audience !== undefined && options.audience !== audience)
      return Effect.fail(new TokenRejected({ reason: "wrong_audience" }));
    const found = principals[token];
    return found === undefined
      ? Effect.fail(new TokenRejected({ reason: "invalid" }))
      : Effect.succeed(found);
  },
});

const incoming = (headers: Record<string, string> = {}) => ({
  headers: new Headers(headers),
  url: "https://api.test/things",
});
const bearer = (token: string) => incoming({ authorization: `Bearer ${token}` });

const options: IdentityCallerOptions = {
  token: "bearer",
  audience,
  grant: (_actor, verified) =>
    Grant.fromPermissions(verified.scopes.includes("read") ? ["things:read"] : []),
  challenge: (error) => (error === undefined ? "Bearer realm" : `Bearer error="${error}"`),
};
const caller = Identity.caller(options);

const knownActor = ActorId.make("actor-known");
const seedKnown = Effect.gen(function* () {
  const identity = yield* Identity;
  yield* UnitOfWork.atomic(identity.bind(principals.known ?? principal("x"), knownActor)).pipe(
    Effect.catchTag("BindingTaken", () => Effect.void),
  );
});

const inviteOnly = Layer.mergeAll(Identity.layerMemory, Identity.refuse, fakeAuthenticator).pipe(
  Layer.provideMerge(memoryUnitOfWork),
);

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
  Layer.provideMerge(Layer.merge(Identity.layerMemory, fakeAuthenticator)),
  Layer.provideMerge(memoryUnitOfWork),
);

const subjectMode = Layer.mergeAll(
  Identity.subject({ issuer }),
  Identity.refuse,
  fakeAuthenticator,
);

it.layer(inviteOnly)("Identity.caller with bindings and Identity.refuse", (test) => {
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
      const plain = Identity.caller({ token: "bearer", grant: () => Grant.fromPermissions([]) });
      const refused = yield* Effect.flip(plain(incoming()));
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
      const elsewhere = Identity.caller({ ...options, audience: "https://elsewhere.test" });
      const refused = yield* Effect.flip(elsewhere(bearer("known")));
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

  test.effect("a bound login becomes the CurrentActor with the Grant the app chose", () =>
    Effect.gen(function* () {
      yield* seedKnown;
      const context = yield* caller(bearer("known"));
      expect(Context.get(context, CurrentActor)).toEqual({ id: knownActor });
      expect(yield* Context.get(context, Grant).holds("things:read")).toBe(true);
      expect(yield* Context.get(context, Grant).holds("things:write")).toBe(false);
    }),
  );

  test.effect("an Effect grant is run, and its Refused is the caller's", () =>
    Effect.gen(function* () {
      yield* seedKnown;
      const seen: Array<string> = [];
      const effectful = Identity.caller({
        ...options,
        grant: (actor) =>
          Effect.sync(() => {
            seen.push(actor.id);
            return Grant.fromPermissions(["things:write"]);
          }),
      });
      const context = yield* effectful(bearer("known"));
      expect(seen).toEqual([knownActor]);
      expect(yield* Context.get(context, Grant).holds("things:write")).toBe(true);
      const refusing = Identity.caller({
        ...options,
        grant: () => Effect.fail(new Refused({ status: 403, code: "scope", message: "No." })),
      });
      expect(yield* Effect.flip(refusing(bearer("known")))).toMatchObject({ code: "scope" });
    }),
  );

  test.effect("a cookie token source reads the named cookie", () =>
    Effect.gen(function* () {
      yield* seedKnown;
      const cookies = Identity.caller({ ...options, token: { cookie: "session" } });
      const context = yield* cookies(incoming({ cookie: "other=x; session=known" }));
      expect(Context.get(context, CurrentActor).id).toBe(knownActor);
      expect(yield* Effect.flip(cookies(bearer("known")))).toMatchObject({ code: "token_missing" });
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

it.layer(openSignUp)("Identity.caller with an app FirstSignIn filler", (test) => {
  test.effect("an unknown login is bound inside the filler's unit, then resolves", () =>
    Effect.gen(function* () {
      const expected = ActorId.make("actor-user-new");
      const first = yield* caller(bearer("newcomer"));
      expect(Context.get(first, CurrentActor)).toEqual({ id: expected });
      const identity = yield* Identity;
      expect(yield* identity.resolve(principals.newcomer ?? principal("x"))).toEqual(
        Option.some(expected),
      );
      const again = yield* caller(bearer("newcomer"));
      expect(Context.get(again, CurrentActor)).toEqual({ id: expected });
      expect(yield* identity.bindingsOf(expected)).toHaveLength(1);
    }),
  );
});

it.layer(subjectMode)("Identity.caller with Identity.subject", (test) => {
  test.effect("the subject is the ActorId for the configured issuer", () =>
    Effect.gen(function* () {
      const context = yield* caller(bearer("known"));
      expect(Context.get(context, CurrentActor)).toEqual({ id: "user-known" });
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
      const plain = Identity.caller({ token: "bearer", grant: () => Grant.fromPermissions([]) });
      const refused = yield* Effect.flip(plain(bearer("foreign")));
      expect(refused).toMatchObject({ status: 401, code: "token_invalid" });
      expect(refused.challenge).toBeUndefined();
    }),
  );
});

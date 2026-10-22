import { expect, expectTypeOf, it } from "@effect/vitest";
import {
  Authenticator,
  type WhoSocket,
  CurrentActor,
  defineFeature,
  May,
  Runtime,
  runFeature,
  StepTrace,
  type Principal,
  Refused,
} from "@house-rules/application";
import { Actor, ActorId, asSystem, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Option, Schema } from "effect";
import {
  ActorResolver,
  bindIdentity,
  IdentityOperations,
  BindingInvalid,
  BindingTaken,
  FirstSignIn,
  Identity,
  IdentityCallerDenied,
} from "../index.js";
import * as contract from "../contract.js";

const { bindLogin } = IdentityOperations;

expectTypeOf<Parameters<typeof bindIdentity>[0]>().toExtend<
  Omit<Identity["Service"], "accountByEmail">
>();
expectTypeOf<Parameters<typeof bindIdentity>[0]>().not.toHaveProperty("accountByEmail");
expectTypeOf<Identity["Service"]>().toExtend<Parameters<typeof bindIdentity>[0]>();
expectTypeOf<ReturnType<typeof Identity.who>>().toEqualTypeOf<
  WhoSocket<Authenticator | ActorResolver | FirstSignIn>
>();

const actor = Actor.make({ id: ActorId.make("person") });
const system = { kind: "system", reason: "new login", startedBy: "hook:sign-in" } as const;
const bind = defineFeature("test_bind", {
  ...bindLogin,
  permission: null,
  flags: { readOnly: bindLogin.readOnly },
  edges: [bindLogin],

  handler: (input, { call }) => call(bindLogin, input),
});
const systemBind = defineFeature("test_systemBind", {
  ...bindLogin,
  permission: null,
  flags: { readOnly: bindLogin.readOnly },
  edges: [bindLogin],
  start: system,
  handler: (input, { call }) => call(bindLogin, input),
});
const first = defineFeature("first_sign_in", {
  description: "Set up an account and bind its verified login.",
  input: bindLogin.input,
  output: bindLogin.output,
  failure: bindLogin.failure,
  permission: null,
  edges: [asSystem(bindLogin, "bind new login")],
  start: system,
  handler: (input, { call }) =>
    Effect.gen(function* () {
      yield* UnitOfWork.onRollback(
        Effect.sync(() => {
          createdAccounts.delete(input.personId);
        }),
      );
      createdAccounts.add(input.personId);
      const id = yield* call(bindLogin, input);
      if (input.subject === "rollback")
        return yield* new BindingInvalid({ message: "Account setup failed after binding." });
      return id;
    }),
});
const features = [bind, systemBind, first];
const permissions = ["identity:bind"] as const;
const caller = Layer.merge(
  Layer.succeed(CurrentActor, actor),
  Layer.succeedContext(
    May.context(May.fixed(permissions), { features, system: permissions, via: "test" }),
  ),
);
const createdAccounts = new Set<ActorId>();
const world = Layer.unwrap(
  Effect.gen(function* () {
    const identity = yield* Identity;
    return Runtime.layer({
      bindings: bindIdentity(identity),
      features,
      ways: [],
    });
  }),
).pipe(
  Layer.provideMerge(Identity.layerMemory()),
  Layer.provideMerge(memoryUnitOfWork),
  Layer.provideMerge(StepTrace.layer()),
);

it.layer(world)("Identity nodes and Who hook", (test) => {
  test.effect("browser descriptors and system-only binding preserve the service contract", () =>
    Effect.gen(function* () {
      expect(Object.keys(contract)).not.toContain("bindIdentity");
      expect(bindLogin).toMatchObject({
        name: "Identity.bindLogin",
        permission: "identity:bind",
        edges: [],
        transactional: true,
        needsApproval: false,
      });
      expect(Schema.is(bindLogin.output)(actor.id)).toBe(true);
      const input = { issuer: "https://issuer.test", subject: "new", personId: actor.id };
      expect(
        yield* Effect.flip(runFeature(bind, input).pipe(Effect.provide(caller))),
      ).toBeInstanceOf(IdentityCallerDenied);
      expect(yield* runFeature(systemBind, input).pipe(Effect.provide(caller))).toBe(actor.id);
      expect(yield* runFeature(systemBind, input).pipe(Effect.provide(caller))).toBe(actor.id);
      expect(
        yield* Effect.flip(
          runFeature(systemBind, { ...input, personId: ActorId.make("other") }).pipe(
            Effect.provide(caller),
          ),
        ),
      ).toBeInstanceOf(BindingTaken);
    }),
  );
  test.effect(
    "Who authenticates once, invokes the captured system entry and rolls binding back on hook failure",
    () =>
      Effect.gen(function* () {
        const runtime = yield* Runtime;
        const trace = yield* StepTrace;
        const unit = yield* UnitOfWork;
        const identity = yield* Identity;
        let authentications = 0;
        const principal: Principal = {
          issuer: "https://issuer.test",
          subject: "rollback",
          audience: [],
          scopes: [],
          claims: {},
        };
        const auth = Layer.succeed(Authenticator, {
          verify: (token) =>
            Effect.sync(() => {
              authentications++;
              return token === "accepted" ? { ...principal, subject: "accepted" } : principal;
            }),
        });
        let hooks = 0;
        const hook = Layer.succeed(FirstSignIn, (verified: Principal) =>
          Effect.sync(() => {
            hooks++;
          }).pipe(
            Effect.andThen(
              runFeature(first, {
                issuer: verified.issuer,
                subject: verified.subject,
                personId: ActorId.make(`account-${verified.subject}`),
              }),
            ),
            Effect.provideService(Runtime, runtime),
            Effect.provideService(StepTrace, trace),
            Effect.provideService(UnitOfWork, unit),
            Effect.provide(May.system([first], { system: permissions, via: "hook" })),
            Effect.mapError(
              () => new Refused({ status: 503, code: "sign_in_failed", message: "Try again." }),
            ),
          ),
        );
        const who = Identity.who({ token: "bearer" });
        expect(
          yield* Effect.flip(
            who
              .resolve({
                headers: new Headers({ authorization: "Bearer verified" }),
                url: "https://api.test",
              })
              .pipe(Effect.provide(Layer.merge(auth, hook))),
          ),
        ).toMatchObject({ code: "sign_in_failed" });
        expect(authentications).toBe(1);
        expect(yield* identity.resolve(principal)).toEqual(Option.none());
        expect(createdAccounts.has(ActorId.make("account-rollback"))).toBe(false);
        const accepted = {
          headers: new Headers({ authorization: "Bearer accepted" }),
          url: "https://api.test",
        };
        expect(yield* who.resolve(accepted).pipe(Effect.provide(Layer.merge(auth, hook)))).toEqual({
          id: "account-accepted",
        });
        expect(createdAccounts.has(ActorId.make("account-accepted"))).toBe(true);
        expect(yield* who.resolve(accepted).pipe(Effect.provide(Layer.merge(auth, hook)))).toEqual({
          id: "account-accepted",
        });
        expect(hooks).toBe(2);
        expect(authentications).toBe(3);
      }),
  );
});

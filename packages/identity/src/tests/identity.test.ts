import { expect, it } from "@effect/vitest";
import { ActorId, memoryUnitOfWork, NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Option } from "effect";
import { BindingInvalid, BindingTaken, Identity } from "../index.js";

const issuer = "https://issuer.test";
const world = Identity.layerMemory().pipe(Layer.provideMerge(memoryUnitOfWork));

it.layer(world)("Identity", (test) => {
  test.effect("binds a login and resolves it, keeping only issuer and subject", () =>
    Effect.gen(function* () {
      const identity = yield* Identity;
      const actor = ActorId.make("bind-actor");
      const principal = {
        issuer,
        subject: "bind",
        audience: [],
        scopes: [],
        claims: { email: "a@example.test" },
      };
      expect(yield* identity.resolve(principal)).toEqual(Option.none());
      yield* UnitOfWork.atomic(identity.bind(principal, actor));
      expect(yield* identity.resolve(principal)).toEqual(Option.some(actor));
      expect(yield* identity.resolve({ issuer: "https://other.test", subject: "bind" })).toEqual(
        Option.none(),
      );
      const [binding] = yield* identity.bindingsOf(actor);
      expect(Object.keys(binding ?? {}).sort()).toEqual([
        "actorId",
        "createdAt",
        "issuer",
        "subject",
      ]);
    }),
  );

  test.effect("binding again to the same actor is a no-op; another actor fails BindingTaken", () =>
    Effect.gen(function* () {
      const identity = yield* Identity;
      const login = { issuer, subject: "taken" };
      const first = ActorId.make("taken-first");
      yield* UnitOfWork.atomic(identity.bind(login, first));
      yield* UnitOfWork.atomic(identity.bind(login, first));
      const error = yield* Effect.flip(
        UnitOfWork.atomic(identity.bind(login, ActorId.make("taken-second"))),
      );
      expect(error).toBeInstanceOf(BindingTaken);
      expect(yield* identity.resolve(login)).toEqual(Option.some(first));
    }),
  );

  test.effect("an empty issuer or subject never binds and never resolves", () =>
    Effect.gen(function* () {
      const identity = yield* Identity;
      const error = yield* Effect.flip(
        UnitOfWork.atomic(identity.bind({ issuer, subject: "" }, ActorId.make("empty"))),
      );
      expect(error).toBeInstanceOf(BindingInvalid);
      expect(yield* identity.resolve({ issuer: "", subject: "x" })).toEqual(Option.none());
    }),
  );

  test.effect("unbinds one login for its own actor, then every login on account deletion", () =>
    Effect.gen(function* () {
      const identity = yield* Identity;
      const actor = ActorId.make("unbind-actor");
      const one = { issuer, subject: "unbind-one" };
      const two = { issuer: "https://second.test", subject: "unbind-two" };
      yield* UnitOfWork.atomic(
        Effect.gen(function* () {
          yield* identity.bind(one, actor);
          yield* identity.bind(two, actor);
        }),
      );
      yield* UnitOfWork.atomic(identity.unbind(ActorId.make("stranger"), one));
      expect(yield* identity.resolve(one)).toEqual(Option.some(actor));
      yield* UnitOfWork.atomic(identity.unbind(actor, one));
      expect(yield* identity.resolve(one)).toEqual(Option.none());
      expect((yield* identity.bindingsOf(actor)).map((binding) => binding.subject)).toEqual([
        "unbind-two",
      ]);
      yield* UnitOfWork.atomic(identity.unbindAll(actor));
      expect(yield* identity.bindingsOf(actor)).toEqual([]);
    }),
  );

  test.effect("every write needs an open unit", () =>
    Effect.gen(function* () {
      const identity = yield* Identity;
      const actor = ActorId.make("no-unit");
      const login = { issuer, subject: "no-unit" };
      for (const call of [
        identity.bind(login, actor),
        identity.unbind(actor, login),
        identity.unbind(actor, { issuer, subject: "" }),
        identity.unbindAll(actor),
      ])
        expect(yield* Effect.flip(call)).toBeInstanceOf(NoOpenUnit);
    }),
  );
});

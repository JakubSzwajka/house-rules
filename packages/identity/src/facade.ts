import { type ActorId, defineModule, type NoOpenUnit } from "@house-rules/domain";
import { Effect, Layer, type Option } from "effect";
import { memoryBindingStore } from "./adapters/memory/binding.js";
import { postgresBindingStore } from "./adapters/postgres/binding.js";
import type {
  Binding,
  BindingInvalid,
  BindingTaken,
  IdentityStoreUnavailable,
} from "./binding/binding.js";
import { makeIdentity } from "./binding/bindings.js";
import { ActorResolver } from "./sign-in/actor-resolver.js";
import { identityCaller } from "./sign-in/caller.js";
import { FirstSignIn } from "./sign-in/first-sign-in.js";
import { BindingStore } from "./storage.js";

export type Login = Readonly<{ issuer: string; subject: string }>;

export class Identity extends defineModule<
  Identity,
  {
    readonly resolve: (
      login: Login,
    ) => Effect.Effect<Option.Option<ActorId>, IdentityStoreUnavailable>;
    readonly bind: (
      login: Login,
      actorId: ActorId,
    ) => Effect.Effect<void, BindingInvalid | BindingTaken | IdentityStoreUnavailable | NoOpenUnit>;
    readonly unbind: (
      actorId: ActorId,
      login: Login,
    ) => Effect.Effect<void, IdentityStoreUnavailable | NoOpenUnit>;
    readonly bindingsOf: (
      actorId: ActorId,
    ) => Effect.Effect<ReadonlyArray<Binding>, IdentityStoreUnavailable>;
    readonly unbindAll: (
      actorId: ActorId,
    ) => Effect.Effect<void, IdentityStoreUnavailable | NoOpenUnit>;
  }
>()("identity", {
  make: Effect.gen(function* identityLayer() {
    const store = yield* BindingStore;
    return makeIdentity(store);
  }),
}) {
  // Fills ActorResolver from the bindings this module owns.
  static readonly resolver: Layer.Layer<ActorResolver, never, Identity> = Layer.effect(
    ActorResolver,
    Effect.gen(function* identityResolver() {
      const identity = yield* Identity;
      return ActorResolver.of({ resolve: identity.resolve });
    }),
  );

  static readonly layerMemory: Layer.Layer<Identity | ActorResolver> = Layer.provideMerge(
    this.resolver,
    this.layer,
  ).pipe(Layer.provide(memoryBindingStore()));

  static readonly layerPostgres = Layer.provideMerge(this.resolver, this.layer).pipe(
    Layer.provide(postgresBindingStore),
  );

  static readonly subject = ActorResolver.subject;

  static readonly refuse = FirstSignIn.refuse;

  // `override` because every function already has a legacy `caller` property.
  static override readonly caller = identityCaller;
}

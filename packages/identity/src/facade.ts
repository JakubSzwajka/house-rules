import { type ActorId, defineModule, type NoOpenUnit } from "@house-rules/domain";
import { Effect, Layer, Option } from "effect";
import { AccountStore } from "./passwords/account-store.js";
import { makeAccountLookup, type PasswordAccountNotFound } from "./passwords/account-lookup.js";
import type { AccountStoreUnavailable } from "./passwords/store-unavailable.js";
import { makeAccounts, type PasswordMethods } from "./passwords/accounts.js";
import { PasswordIssuer } from "./passwords/accounts-issuer.js";
import { PasswordsUnavailable } from "./passwords/provider-unavailable.js";
import { memoryAccountStore } from "./adapters/memory/passwords.js";
import { postgresAccountStore } from "./adapters/postgres/passwords.js";
import { type IdentityOptions, oidc, passwords, providersLayer } from "./sign-in/providers.js";
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
import { identityWho } from "./sign-in/caller.js";
import { FirstSignIn } from "./sign-in/first-sign-in.js";
import { BindingStore } from "./storage.js";

export type Login = Readonly<{ issuer: string; subject: string }>;

export class Identity extends defineModule<
  Identity,
  PasswordMethods & {
    readonly accountByEmail: (
      email: string,
    ) => Effect.Effect<
      { accountId: string; actorId: ActorId; displayName: string },
      PasswordAccountNotFound | AccountStoreUnavailable
    >;
    readonly passwordIssuer: () => Effect.Effect<PasswordIssuer["Service"] | undefined>;
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
    const issuer = yield* Effect.serviceOption(PasswordIssuer);
    const accounts = yield* Effect.serviceOption(AccountStore);
    const passwordMethods =
      Option.isSome(issuer) && Option.isSome(accounts)
        ? makeAccounts(accounts.value, issuer.value)
        : {
            signUp: () => Effect.fail(new PasswordsUnavailable()),
            signIn: () => Effect.fail(new PasswordsUnavailable()),
            changePassword: () => Effect.fail(new PasswordsUnavailable()),
          };
    return {
      ...makeIdentity(store),
      ...passwordMethods,
      accountByEmail: makeAccountLookup(
        Option.getOrUndefined(accounts),
        Option.getOrUndefined(issuer),
        store,
      ),
      passwordIssuer: () => Effect.succeed(Option.getOrUndefined(issuer)),
    };
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

  static readonly layerMemory = (options: IdentityOptions = { providers: [] }) =>
    Layer.provideMerge(this.resolver, this.layer).pipe(
      Layer.provide(Layer.merge(memoryBindingStore(), memoryAccountStore())),
      Layer.provideMerge(providersLayer(options)),
    );

  static readonly layerPostgres = (options: IdentityOptions = { providers: [] }) =>
    Layer.provideMerge(this.resolver, this.layer).pipe(
      Layer.provide(Layer.merge(postgresBindingStore, postgresAccountStore)),
      Layer.provideMerge(providersLayer(options)),
    );

  static readonly passwords = passwords;
  static readonly oidc = oidc;

  static readonly subject = ActorResolver.subject;

  static readonly refuse = FirstSignIn.refuse;

  static readonly who = identityWho;
}

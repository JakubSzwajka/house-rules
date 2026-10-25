import type { ActorId, NoOpenUnit } from "@house-rules/domain/contract";
import { Context, type Effect } from "effect";
import type { IdentityStoreUnavailable } from "./availability/store-unavailable.js";
import type { Binding, BindingKey } from "./binding/binding.js";

export { IdentityStoreUnavailable } from "./availability/store-unavailable.js";

export class BindingStore extends Context.Service<
  BindingStore,
  {
    readonly find: (
      key: BindingKey,
    ) => Effect.Effect<ActorId | undefined, IdentityStoreUnavailable>;
    readonly claim: (
      key: BindingKey,
      actorId: ActorId,
    ) => Effect.Effect<ActorId, IdentityStoreUnavailable | NoOpenUnit>;
    readonly remove: (
      actorId: ActorId,
      key: BindingKey,
    ) => Effect.Effect<void, IdentityStoreUnavailable | NoOpenUnit>;
    readonly list: (
      actorId: ActorId,
    ) => Effect.Effect<ReadonlyArray<Binding>, IdentityStoreUnavailable>;
    readonly removeAll: (
      actorId: ActorId,
    ) => Effect.Effect<void, IdentityStoreUnavailable | NoOpenUnit>;
  }
>()("@house-rules/identity/BindingStore") {}

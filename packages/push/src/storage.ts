import type { NoOpenUnit } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { PushOwner, PushStoreUnavailable, PushSubscription } from "./push/push.js";
export class PushStore extends Context.Service<
  PushStore,
  {
    readonly get: (
      endpoint: string,
    ) => Effect.Effect<PushSubscription | undefined, PushStoreUnavailable>;
    readonly getIncludingExpired: (
      endpoint: string,
    ) => Effect.Effect<PushSubscription | undefined, PushStoreUnavailable>;
    readonly listMine: (
      owner: PushOwner,
    ) => Effect.Effect<ReadonlyArray<PushSubscription>, PushStoreUnavailable>;
    readonly listOwner: (
      owner: PushOwner,
    ) => Effect.Effect<ReadonlyArray<PushSubscription>, PushStoreUnavailable>;
    readonly put: (
      subscription: PushSubscription,
    ) => Effect.Effect<void, PushStoreUnavailable | NoOpenUnit>;
    readonly remove: (
      endpoint: string,
    ) => Effect.Effect<boolean, PushStoreUnavailable | NoOpenUnit>;
    readonly expired: (
      endpoint: string,
      at: number,
    ) => Effect.Effect<boolean, PushStoreUnavailable | NoOpenUnit>;
    readonly erase: (owner: PushOwner) => Effect.Effect<void, PushStoreUnavailable | NoOpenUnit>;
  }
>()("@house-rules/push/PushStore") {}

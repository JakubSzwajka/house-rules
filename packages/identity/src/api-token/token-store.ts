import type { ActorId, NoOpenUnit } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { IdentityStoreUnavailable } from "../storage.js";
import type { TokenRow } from "./api-token.js";

export class ApiTokenStore extends Context.Service<
  ApiTokenStore,
  {
    find: (lookup: string) => Effect.Effect<TokenRow | undefined, IdentityStoreUnavailable>;
    insert: (row: TokenRow) => Effect.Effect<void, IdentityStoreUnavailable | NoOpenUnit>;
    list: (actorId?: ActorId) => Effect.Effect<ReadonlyArray<TokenRow>, IdentityStoreUnavailable>;
    revoke: (
      id: string,
      at: number,
    ) => Effect.Effect<
      { before: TokenRow; after: TokenRow } | null | undefined,
      IdentityStoreUnavailable | NoOpenUnit
    >;
    recordUse: (
      id: string,
      at: number,
    ) => Effect.Effect<void, IdentityStoreUnavailable | NoOpenUnit>;
  }
>()("@house-rules/identity/ApiTokenStore") {}

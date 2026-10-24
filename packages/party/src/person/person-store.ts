import type { ActorId, NoOpenUnit } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { Person, PersonStoreUnavailable } from "./person.js";
import type { Principal } from "./principal.js";

export class PersonStore extends Context.Service<
  PersonStore,
  {
    readonly principal: (
      id: ActorId,
    ) => Effect.Effect<Principal | undefined, PersonStoreUnavailable>;
    readonly principalsByIds: (
      ids: readonly ActorId[],
    ) => Effect.Effect<readonly Principal[], PersonStoreUnavailable>;
    readonly insertPrincipal: (
      principal: Principal,
    ) => Effect.Effect<boolean, PersonStoreUnavailable | NoOpenUnit>;
    readonly lockPrincipal: (
      handle: string,
    ) => Effect.Effect<Principal | undefined, PersonStoreUnavailable | NoOpenUnit>;
    readonly principalForUpdate: (
      id: ActorId,
    ) => Effect.Effect<Principal | undefined, PersonStoreUnavailable | NoOpenUnit>;
    readonly disable: (
      id: ActorId,
      disabledAt: number,
    ) => Effect.Effect<Principal | undefined, PersonStoreUnavailable | NoOpenUnit>;
    readonly find: (id: ActorId) => Effect.Effect<Person | undefined, PersonStoreUnavailable>;
    readonly list: (
      ids: readonly ActorId[] | null,
    ) => Effect.Effect<readonly Person[], PersonStoreUnavailable>;
    readonly insertIfFree: (
      person: Person,
    ) => Effect.Effect<boolean, PersonStoreUnavailable | NoOpenUnit>;
    readonly rename: (
      id: ActorId,
      displayName: string,
    ) => Effect.Effect<Person | undefined, PersonStoreUnavailable | NoOpenUnit>;
    readonly erase: (id: ActorId) => Effect.Effect<void, PersonStoreUnavailable | NoOpenUnit>;
  }
>()("@house-rules/party/PersonStore") {}

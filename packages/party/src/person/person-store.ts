import type { ActorId, NoOpenUnit } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { Person, PersonStoreUnavailable } from "./person.js";

export class PersonStore extends Context.Service<
  PersonStore,
  {
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

import { type Actor, type ActorId, defineModule, type NoOpenUnit } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { memoryPersonStore } from "./adapters/memory/person.js";
import { postgresPersonStore } from "./adapters/postgres/person.js";
import { makeParty } from "./person/party.js";
import type {
  Person,
  PersonAlreadyExists,
  PersonInputInvalid,
  PersonNotFound,
  PersonStoreUnavailable,
  PersonUpdateRefused,
} from "./person/person.js";
import { PersonStore } from "./storage.js";

export type PartyFailure =
  | PersonAlreadyExists
  | PersonInputInvalid
  | PersonNotFound
  | PersonStoreUnavailable
  | PersonUpdateRefused;

export class Party extends defineModule<
  Party,
  {
    readonly createPerson: (input: {
      readonly displayName: string;
      readonly id?: ActorId;
    }) => Effect.Effect<
      Person,
      PersonAlreadyExists | PersonInputInvalid | PersonStoreUnavailable | NoOpenUnit
    >;
    readonly get: (
      actor: Actor,
      id: ActorId,
    ) => Effect.Effect<Person, PersonNotFound | PersonStoreUnavailable>;
    readonly rename: (
      actor: Actor,
      id: ActorId,
      displayName: string,
    ) => Effect.Effect<
      Person,
      | PersonInputInvalid
      | PersonNotFound
      | PersonStoreUnavailable
      | PersonUpdateRefused
      | NoOpenUnit
    >;
    readonly erase: (id: ActorId) => Effect.Effect<void, PersonStoreUnavailable | NoOpenUnit>;
  }
>()("party", {
  make: Effect.gen(function* partyLayer() {
    return makeParty(yield* PersonStore);
  }),
}) {
  static readonly layerMemory = this.layer.pipe(Layer.provide(memoryPersonStore()));

  static readonly layerPostgres = this.layer.pipe(Layer.provide(postgresPersonStore));
}

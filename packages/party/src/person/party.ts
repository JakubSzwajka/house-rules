import { type Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { DateTime, Effect, Random, Schema } from "effect";
import type { PersonStore } from "../storage.js";
import { PartyPermissions } from "./permissions.js";
import {
  DisplayName,
  type Person,
  PersonAlreadyExists,
  PersonInputInvalid,
  PersonNotFound,
  PersonUpdateRefused,
} from "./person.js";
import { personPolicy } from "./policy.js";

export const makeParty = (store: PersonStore["Service"]) => {
  const decodeName = Schema.decodeUnknownEffect(DisplayName);
  const decodeId = Schema.decodeUnknownEffect(ActorId);
  const invalid = () => new PersonInputInvalid({ message: "Invalid person input." });
  const newId = Effect.all(
    Array.from({ length: 4 }, () => Random.nextIntBetween(0, 0xffff_ffff)),
  ).pipe(
    Effect.map((words) => words.map((word) => word.toString(16).padStart(8, "0")).join("")),
    Effect.map((hex) => ActorId.make(hex)),
  );
  const relationOf = (actor: Actor, id: ActorId) => (actor.id === id ? "self" : "other");
  const get = Effect.fn("Party.get")(function* (actor: Actor, id: ActorId) {
    if (!personPolicy.allows(relationOf(actor, id), PartyPermissions.read))
      return yield* new PersonNotFound();
    const person = yield* store.find(id);
    if (person === undefined) return yield* new PersonNotFound();
    return person;
  });
  return {
    createPerson: Effect.fn("Party.createPerson")(function* (input: {
      readonly displayName: string;
      readonly id?: ActorId;
    }) {
      yield* UnitOfWork.required;
      const displayName = yield* decodeName(input.displayName).pipe(Effect.mapError(invalid));
      const id =
        input.id === undefined
          ? yield* newId
          : yield* decodeId(input.id).pipe(Effect.mapError(invalid));
      const person: Person = {
        id,
        displayName,
        createdAt: DateTime.toEpochMillis(yield* DateTime.now),
      };
      if (!(yield* store.insertIfFree(person))) return yield* new PersonAlreadyExists();
      return person;
    }),
    get,
    me: Effect.fn("Party.me")(function* (actor: Actor) {
      return yield* get(actor, actor.id);
    }),
    rename: Effect.fn("Party.rename")(function* (actor: Actor, id: ActorId, displayName: string) {
      yield* UnitOfWork.required;
      if (!personPolicy.allows(relationOf(actor, id), PartyPermissions.update))
        return yield* new PersonUpdateRefused();
      const decoded = yield* decodeName(displayName).pipe(Effect.mapError(invalid));
      const person = yield* store.rename(id, decoded);
      if (person === undefined) return yield* new PersonNotFound();
      return person;
    }),
    erase: Effect.fn("Party.erase")(function* (id: ActorId) {
      yield* UnitOfWork.required;
      yield* store.erase(id);
    }),
  };
};

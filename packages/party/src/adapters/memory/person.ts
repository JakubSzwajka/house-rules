import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import type { Person } from "../../person/person.js";
import { PersonStore } from "../../storage.js";

export const memoryPersonStore = (): Layer.Layer<PersonStore> =>
  Layer.sync(PersonStore, () => {
    const rows = new Map<string, Person>();
    const change = Effect.fn("PersonStore.memory.change")(function* <A>(run: () => A) {
      yield* UnitOfWork.required;
      const before = new Map(rows);
      yield* UnitOfWork.onRollback(
        Effect.sync(() => {
          rows.clear();
          for (const [id, person] of before) rows.set(id, person);
        }),
      );
      return run();
    });
    return PersonStore.of({
      find: (id) => Effect.sync(() => rows.get(id)).pipe(Effect.map((row) => row && { ...row })),
      list: (ids) =>
        Effect.sync(() =>
          [...rows.values()]
            .filter((p) => ids === null || ids.includes(p.id))
            .map((p) => ({ ...p })),
        ),
      insertIfFree: (person) =>
        Effect.gen(function* () {
          yield* UnitOfWork.required;
          if (rows.has(person.id)) return false;
          yield* change(() => void rows.set(person.id, { ...person }));
          return true;
        }),
      rename: (id, displayName) =>
        Effect.gen(function* () {
          yield* UnitOfWork.required;
          const person = rows.get(id);
          if (person === undefined) return undefined;
          const renamed = { ...person, displayName };
          yield* change(() => void rows.set(id, renamed));
          return { ...renamed };
        }),
      erase: (id) => change(() => void rows.delete(id)),
    });
  });

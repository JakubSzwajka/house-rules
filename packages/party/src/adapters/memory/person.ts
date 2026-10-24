import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { legacyPrincipal, personOf, type Principal } from "../../person/principal.js";
import { PersonStore } from "../../storage.js";

export const memoryPersonStore = (): Layer.Layer<PersonStore> =>
  Layer.sync(PersonStore, () => {
    const rows = new Map<string, Principal>();
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
    const insertPrincipal = Effect.fn("PersonStore.memory.insertPrincipal")(function* (
      principal: Principal,
    ) {
      yield* UnitOfWork.required;
      if (rows.has(principal.id) || [...rows.values()].some((p) => p.handle === principal.handle))
        return false;
      yield* change(() => void rows.set(principal.id, { ...principal }));
      return true;
    });
    return PersonStore.of({
      principal: (id) =>
        Effect.sync(() => {
          const row = rows.get(id);
          return row && { ...row };
        }),
      principalsByIds: (ids) =>
        Effect.sync(() =>
          [...rows.values()].filter((p) => ids.includes(p.id)).map((p) => ({ ...p })),
        ),
      insertPrincipal,
      // memoryUnitOfWork serializes whole units, so the lock lasts until commit or rollback.
      lockPrincipal: (handle) =>
        Effect.gen(function* () {
          yield* UnitOfWork.required;
          const row = [...rows.values()].find((p) => p.handle === handle);
          return row && { ...row };
        }),
      principalForUpdate: (id) =>
        Effect.gen(function* () {
          yield* UnitOfWork.required;
          const row = rows.get(id);
          return row && { ...row };
        }),
      disable: (id, disabledAt) =>
        Effect.gen(function* () {
          yield* UnitOfWork.required;
          const row = rows.get(id);
          if (!row) return undefined;
          const disabled = { ...row, disabledAt: row.disabledAt ?? disabledAt };
          yield* change(() => void rows.set(id, disabled));
          return { ...disabled };
        }),
      find: (id) =>
        Effect.sync(() => {
          const row = rows.get(id);
          return row && personOf(row);
        }),
      list: (ids) =>
        Effect.sync(() =>
          [...rows.values()].filter((p) => ids === null || ids.includes(p.id)).map(personOf),
        ),
      insertIfFree: (person) => insertPrincipal(legacyPrincipal(person)),
      rename: (id, displayName) =>
        Effect.gen(function* () {
          yield* UnitOfWork.required;
          const person = rows.get(id);
          if (person === undefined) return undefined;
          const renamed = { ...person, displayName };
          yield* change(() => void rows.set(id, renamed));
          return personOf(renamed);
        }),
      erase: (id) => change(() => void rows.delete(id)),
    });
  });

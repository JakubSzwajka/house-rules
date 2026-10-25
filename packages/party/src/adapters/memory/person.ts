import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { legacyPrincipal, personOf, type Principal } from "../../person/principal.js";
import { PersonStore } from "../../storage.js";

export const memoryPersonStore = (): Layer.Layer<PersonStore> =>
  Layer.sync(PersonStore, () => {
    const rows = new Map<string, Principal>();
    const handles = new Map<string, string>();
    const set = (id: string, principal: Principal | undefined) => {
      const before = rows.get(id);
      if (before) handles.delete(before.handle);
      if (principal) {
        rows.set(id, principal);
        handles.set(principal.handle, id);
      } else {
        rows.delete(id);
      }
    };
    const change = Effect.fnUntraced(function* <A>(id: string, run: () => A) {
      yield* UnitOfWork.required;
      let undo: (() => void) | undefined;
      yield* UnitOfWork.onRollback(Effect.sync(() => undo?.()));
      return yield* Effect.sync(() => {
        // Capture and mutate together, after registering undo, even with parallel writes in a unit.
        const before = rows.get(id);
        undo = () => set(id, before);
        return run();
      });
    });
    const insertPrincipal = (principal: Principal) =>
      change(principal.id, () => {
        if (rows.has(principal.id) || handles.has(principal.handle)) return false;
        set(principal.id, { ...principal });
        return true;
      });
    return PersonStore.of({
      principal: (id) =>
        Effect.sync(() => {
          const row = rows.get(id);
          return row && { ...row };
        }),
      principalByHandle: (handle) =>
        Effect.sync(() => {
          const id = handles.get(handle);
          const row = id === undefined ? undefined : rows.get(id);
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
          const id = handles.get(handle);
          const row = id === undefined ? undefined : rows.get(id);
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
          yield* change(id, () => set(id, disabled));
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
          yield* change(id, () => set(id, renamed));
          return personOf(renamed);
        }),
      erase: (id) => change(id, () => set(id, undefined)),
    });
  });

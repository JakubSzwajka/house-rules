import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { PushStore } from "../../storage.js";
import { type PushOwner, type PushSubscription } from "../../push/push.js";
export const memoryPushStore = (): Layer.Layer<PushStore> =>
  Layer.sync(PushStore, () => {
    const rows = new Map<string, PushSubscription>();
    const clone = (row: PushSubscription): PushSubscription => ({
      ...row,
      owner: { ...row.owner },
      keys: { ...row.keys },
    });
    const change = Effect.fn("PushStore.memory.change")(function* (run: () => void) {
      yield* UnitOfWork.required;
      const before = new Map([...rows].map(([key, row]) => [key, clone(row)]));
      yield* UnitOfWork.onRollback(
        Effect.sync(() => {
          rows.clear();
          for (const [key, row] of before) rows.set(key, row);
        }),
      );
      run();
    });
    const byOwner = (owner: PushOwner) =>
      [...rows.values()]
        .filter(
          (row) =>
            row.expiredAt === undefined &&
            row.owner.kind === owner.kind &&
            row.owner.id === owner.id,
        )
        .map(clone);
    const listOwner = (owner: PushOwner) => Effect.sync(() => byOwner(owner));
    return PushStore.of({
      get: (endpoint) =>
        Effect.sync(() => {
          const row = rows.get(endpoint);
          return row && row.expiredAt === undefined ? clone(row) : undefined;
        }),
      getIncludingExpired: (endpoint) =>
        Effect.sync(() => rows.get(endpoint)).pipe(Effect.map((row) => row && clone(row))),
      listMine: listOwner,
      listOwner,
      put: (row) =>
        change(() => {
          rows.set(row.endpoint, clone(row));
        }),
      remove: (endpoint) =>
        Effect.gen(function* () {
          yield* UnitOfWork.required;
          const found = rows.has(endpoint);
          yield* change(() => {
            rows.delete(endpoint);
          });
          return found;
        }),
      expired: (endpoint, at) =>
        Effect.gen(function* () {
          yield* UnitOfWork.required;
          const row = rows.get(endpoint);
          if (!row || row.expiredAt !== undefined) return false;
          yield* change(() => rows.set(endpoint, { ...row, expiredAt: at }));
          return true;
        }),
      erase: (owner) =>
        change(() => {
          for (const [endpoint, row] of rows)
            if (row.owner.kind === owner.kind && row.owner.id === owner.id) rows.delete(endpoint);
        }),
    });
  });

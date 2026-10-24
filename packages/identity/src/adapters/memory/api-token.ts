import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import type { TokenRow } from "../../api-token/api-token.js";
import { ApiTokenStore } from "../../api-token/token-store.js";
import { IdentityStoreUnavailable } from "../../availability/store-unavailable.js";

export const memoryApiTokenStore = () =>
  Layer.sync(ApiTokenStore, () => {
    const rows = new Map<string, TokenRow>();
    const change = Effect.fnUntraced(function* (run: () => void) {
      yield* UnitOfWork.required;
      const before = new Map(rows);
      yield* UnitOfWork.onRollback(
        Effect.sync(() => {
          rows.clear();
          for (const [id, row] of before) rows.set(id, row);
        }),
      );
      run();
    });
    return ApiTokenStore.of({
      find: (lookup) => Effect.sync(() => [...rows.values()].find((row) => row.lookup === lookup)),
      insert: Effect.fnUntraced(function* (row) {
        yield* UnitOfWork.required;
        if (rows.has(row.id) || [...rows.values()].some((held) => held.lookup === row.lookup))
          return yield* new IdentityStoreUnavailable({
            cause: "Duplicate API-token id or lookup.",
          });
        yield* change(() => {
          rows.set(row.id, { ...row, scopes: [...row.scopes] });
        });
      }),
      list: (actorId) =>
        Effect.sync(() =>
          [...rows.values()].filter((row) => actorId === undefined || row.actorId === actorId),
        ),
      revoke: Effect.fnUntraced(function* (id, at) {
        yield* UnitOfWork.required;
        const before = rows.get(id);
        if (before === undefined) return undefined;
        if (before.revokedAt !== null) return null;
        const after = { ...before, revokedAt: at };
        yield* change(() => {
          rows.set(id, after);
        });
        return { before, after };
      }),
      recordUse: (id, at) =>
        change(() => {
          const row = rows.get(id);
          if (row !== undefined)
            rows.set(id, { ...row, lastUsedAt: Math.max(row.lastUsedAt ?? 0, at) });
        }),
    });
  });

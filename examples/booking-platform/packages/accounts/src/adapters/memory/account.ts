import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import type { Account, AccountId } from "../../account/account.js";
import type { PasswordHash } from "../../password/password-hash.js";
import { AccountStore } from "../../storage.js";

const unlockedAt = (row: Account, now: number) =>
  row.lockedUntil === null || row.lockedUntil <= now;

export const memoryAccountStore = (records: readonly Account[] = []): Layer.Layer<AccountStore> =>
  Layer.sync(AccountStore, () => {
    const rows = new Map<AccountId, Account>(records.map((account) => [account.id, account]));
    const byEmail = (email: string) => [...rows.values()].find((row) => row.email === email);
    // The memory unit runs no transaction, so each write registers its own undo.
    const update = (
      id: AccountId,
      when: (row: Account) => boolean,
      change: (row: Account) => Account,
    ) =>
      Effect.gen(function* update() {
        yield* UnitOfWork.required;
        const row = rows.get(id);
        if (row === undefined || !when(row)) return undefined;
        yield* UnitOfWork.onRollback(Effect.sync(() => void rows.set(id, row)));
        const next = change(row);
        rows.set(id, next);
        return next;
      });
    return AccountStore.of({
      find: (id) => Effect.sync(() => rows.get(id)),
      findByEmail: (email) => Effect.sync(() => byEmail(email)),
      insertIfFree: Effect.fn("AccountStore.memory.insert")(function* (account: Account) {
        yield* UnitOfWork.required;
        if (rows.has(account.id) || byEmail(account.email) !== undefined) return false;
        yield* UnitOfWork.onRollback(Effect.sync(() => void rows.delete(account.id)));
        rows.set(account.id, account);
        return true;
      }),
      recordFailureIfUnlocked: (id, { now, failures, lockUntil }) =>
        update(
          id,
          (row) => unlockedAt(row, now),
          (row) =>
            row.failedAttempts + 1 >= failures
              ? { ...row, failedAttempts: 0, lockedUntil: lockUntil }
              : { ...row, failedAttempts: row.failedAttempts + 1, lockedUntil: null },
        ).pipe(
          Effect.map((row) =>
            row === undefined
              ? undefined
              : { failedAttempts: row.failedAttempts, lockedUntil: row.lockedUntil },
          ),
        ),
      admitIfUnlocked: (id, { now, password }) =>
        update(
          id,
          (row) => unlockedAt(row, now) && row.password.hash === password.hash,
          (row) => ({ ...row, failedAttempts: 0, lockedUntil: null }),
        ).pipe(Effect.map((row) => row !== undefined)),
      setPassword: (id, password: PasswordHash) =>
        update(
          id,
          () => true,
          (row) => ({ ...row, password, failedAttempts: 0, lockedUntil: null }),
        ).pipe(Effect.map((row) => row !== undefined)),
    });
  });

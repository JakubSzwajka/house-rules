import type { Delivery } from "@alchemy.run/domain/Platform";
import type { PgClient } from "@effect/sql-pg/PgClient";
import * as Effect from "effect/Effect";
import type { SqlError } from "effect/sql/SqlError";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

export type Fire = (id: string, commandId: string, token: string) => Effect.Effect<void>;

export interface Notifier {
  readonly bump: (key: string) => Effect.Effect<void>;
  readonly changes: <A>(key: string, read: Effect.Effect<A>) => Stream.Stream<A>;
}

export interface Host {
  readonly sql: PgClient;
  readonly t: (table: string) => ReturnType<PgClient>;
  readonly model: string;
  readonly notify: Notifier;
  readonly kick: Effect.Effect<void>;
  readonly stage: (deliveries: ReadonlyArray<Delivery>) => Effect.Effect<void, SqlError>;
  readonly firing: Map<string, Fire>;
  readonly arm: (
    aggregate: string,
    id: string,
    commandId: string,
    token: string,
    at: number,
  ) => Effect.Effect<void>;
}

export const notifier = (): Notifier => {
  const refs = new Map<string, SubscriptionRef.SubscriptionRef<number>>();
  const ref = (key: string) =>
    Effect.suspend(() => {
      const found = refs.get(key);
      if (found) return Effect.succeed(found);
      return Effect.tap(SubscriptionRef.make(0), (made) => Effect.sync(() => refs.set(key, made)));
    });
  return {
    bump: (key) =>
      Effect.suspend(() => {
        const found = refs.get(key);
        return found ? SubscriptionRef.update(found, (n) => n + 1) : Effect.void;
      }),
    changes: (key, read) =>
      Stream.unwrap(
        Effect.map(ref(key), (found) =>
          SubscriptionRef.changes(found).pipe(Stream.mapEffect(() => read)),
        ),
      ),
  };
};

import type * as Effect from "effect/Effect";

export interface Snapshot {
  readonly alive: boolean;
  readonly available: boolean;
  readonly lastSuccessfulPass: number | null;
  readonly observedAt: number | null;
  readonly pendingCount: number | null;
  readonly parkedCount: number | null;
  readonly oldestPendingAgeMillis: number | null;
}

export interface Monitor {
  readonly snapshot: Effect.Effect<Snapshot>;
}

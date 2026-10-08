import { Clock, DateTime, Duration, Effect, Schedule } from "effect";
import { AuditStore } from "../storage.ts";
import type { AuditPolicy, RetentionCutoffs, RetentionOptions } from "../types.ts";

export const defaultRetentionInterval = Duration.hours(1);
export const defaultBatchSize = 1000;

const cutoffOf = (now: number, window: Duration.Input): Date | null => {
  const millis = Duration.toMillis(window);
  return Number.isFinite(millis) ? DateTime.toDateUtc(DateTime.makeUnsafe(now - millis)) : null;
};

export const cutoffsOf = (policy: AuditPolicy, now: number): RetentionCutoffs => ({
  read: cutoffOf(now, policy.retention.read),
  write: cutoffOf(now, policy.retention.write),
  failure: cutoffOf(now, policy.retention.failure),
});

export const runRetention = (policy: AuditPolicy, options: RetentionOptions = {}) =>
  Effect.gen(function* retentionRun() {
    const store = yield* AuditStore;
    const now = yield* Clock.currentTimeMillis;
    return yield* store.deleteExpired(
      cutoffsOf(policy, now),
      options.batchSize ?? defaultBatchSize,
    );
  });

export const retentionLoop = (policy: AuditPolicy, options: RetentionOptions = {}) =>
  runRetention(policy, options).pipe(
    // A failed run waits for the next tick, so one bad run never stops retention.
    Effect.catchCause(() => Effect.logWarning("call audit retention run failed")),
    Effect.repeat(Schedule.spaced(options.interval ?? defaultRetentionInterval)),
    Effect.asVoid,
  );

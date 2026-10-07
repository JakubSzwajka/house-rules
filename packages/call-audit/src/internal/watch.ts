import type { CallWatchService } from "@house-rules/capability";
import { Cause, Clock, Effect, Exit, Option } from "effect";
import type { AuditEntry } from "../types.ts";

const outcomeOf = (exit: Exit.Exit<unknown, unknown>): string => {
  if (Exit.isSuccess(exit)) return "success";
  if (Cause.hasDies(exit.cause)) return "defect";
  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isSome(failure)) {
    const error = failure.value;
    if (typeof error === "object" && error !== null && "_tag" in error) {
      return String(error._tag);
    }
    return "failure";
  }
  return "interrupted";
};

export const makeWatch = (
  who: Effect.Effect<string | null>,
  record: (entry: AuditEntry) => Effect.Effect<void>,
): CallWatchService => ({
  around: (contract, _input, run) =>
    Effect.gen(function* auditedCall() {
      // Snapshot before run: a handler may swap the Viewer, and a broken `who` becomes null.
      const viewerId = yield* who.pipe(Effect.catchCause(() => Effect.succeed(null)));
      const start = yield* Clock.currentTimeMillis;
      return yield* run.pipe(
        // onExit propagates finalizer defects, so recording is sandboxed and run's exit stays untouched.
        Effect.onExit((exit) =>
          Effect.gen(function* recordCall() {
            const end = yield* Clock.currentTimeMillis;
            yield* record({
              capability: contract.name,
              permission: contract.permission,
              viewerId,
              outcome: outcomeOf(exit),
              ms: end - start,
            });
          }).pipe(Effect.ignoreCause),
        ),
      );
    }),
});

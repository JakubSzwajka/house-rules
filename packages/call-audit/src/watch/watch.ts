import { type CallWatchService, unknownCallFacts } from "@house-rules/capability";
import { Cause, Clock, DateTime, Effect, Exit, Option } from "effect";
import type { AuditStore } from "../storage.ts";
import type { AuditEntry, AuditPolicy } from "../audit/audit.ts";

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
  around: (contract, _input, run, given) =>
    Effect.gen(function* auditedCall() {
      const facts = given ?? unknownCallFacts(contract);
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
              kind: facts.kind,
              targetId: facts.targetId,
              channel: facts.channel,
              requestId: facts.requestId,
            });
          }).pipe(Effect.ignoreCause),
        ),
      );
    }),
});

export const logLine = (entry: AuditEntry) =>
  Effect.logInfo(`capability call ${JSON.stringify(entry)}`);

const tagOf = (error: unknown): string =>
  typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : "unknown";

export const storeRecorder =
  (store: AuditStore["Service"], onWriteFailure: AuditPolicy["onWriteFailure"]) =>
  (entry: AuditEntry): Effect.Effect<void> =>
    DateTime.now.pipe(
      Effect.flatMap((now) => store.record({ ...entry, recordedAt: DateTime.toDateUtc(now) })),
      Effect.catchCause((cause) =>
        onWriteFailure === "log"
          ? // The warning names the capability and the error tag only, never a value or a message.
            Effect.logWarning("call audit write failed").pipe(
              Effect.annotateLogs({
                capability: entry.capability,
                error: Option.match(Cause.findErrorOption(cause), {
                  onNone: () => "defect",
                  onSome: tagOf,
                }),
              }),
            )
          : Effect.void,
      ),
    );

const keeps = (policy: AuditPolicy, entry: AuditEntry): Effect.Effect<boolean> =>
  Effect.try({ try: () => policy.keep(entry), catch: () => "keep threw" }).pipe(
    // A keep that throws keeps the entry: a broken filter fails toward recording.
    Effect.orElseSucceed(() => true),
  );

export const policyRecorder =
  (
    policy: AuditPolicy,
    record: (entry: AuditEntry) => Effect.Effect<void>,
    log: boolean,
  ): ((entry: AuditEntry) => Effect.Effect<void>) =>
  (entry) =>
    Effect.gen(function* recordByPolicy() {
      if (!(yield* keeps(policy, entry))) return;
      yield* Effect.all(
        [log ? Effect.ignoreCause(logLine(entry)) : Effect.void, Effect.ignoreCause(record(entry))],
        { discard: true },
      );
    });

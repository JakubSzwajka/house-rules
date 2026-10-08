import { Cause, Context, Effect, Exit, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { holdsClosedUnit, UnitOfWork, UnitOfWorkFailed } from "../unit-of-work.ts";

const describe = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure);

const failed = (failure: unknown) => new UnitOfWorkFailed({ reason: describe(failure) });

class WorkExited {}

const settle = <A, E>(
  cause: Cause.Cause<unknown>,
  work: Exit.Exit<A, E> | undefined,
): Cause.Cause<E | UnitOfWorkFailed> => {
  // The work never ran: acquiring the connection or BEGIN failed. Interrupts stay as they are.
  if (work === undefined) return Cause.map(cause, failed);
  // The work's reasons were swapped for WorkExited, so a Die here is a failed COMMIT or ROLLBACK.
  const control = cause.reasons.find(Cause.isDieReason);
  const workCause = Exit.isFailure(work) ? work.cause : Cause.empty;
  if (control === undefined) return workCause;
  // A failed ROLLBACK replaces the work's exit inside withTransaction; put the work's cause back.
  return Cause.combine(Cause.fail(failed(control.defect)), workCause);
};

export const sqlUnitOfWork: Layer.Layer<UnitOfWork, never, SqlClient> = Layer.effect(
  UnitOfWork,
  Effect.gen(function* sqlUnitOfWork() {
    const sql = yield* SqlClient;
    return UnitOfWork.make(<A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.suspend(() => {
        // Record the work's own exit, whole, so no reason of its cause is lost or relabelled.
        let work: Exit.Exit<A, E> | undefined;
        // Uninterruptible outside the work, so an interrupted fiber still swaps WorkExited back.
        return Effect.uninterruptibleMask((restore) => {
          const tracked: Effect.Effect<A, WorkExited, R> = restore(effect).pipe(
            Effect.exit,
            Effect.flatMap((exit) => {
              work = exit;
              // A stand-in failure, so any Die withTransaction returns is transaction control.
              return Exit.isSuccess(exit)
                ? Effect.succeed(exit.value)
                : Effect.fail(new WorkExited());
            }),
          );
          // A fiber that outlived its unit holds its pooled connection; drop it, or this is a savepoint.
          const transaction = Effect.flatMap(holdsClosedUnit, (stale) =>
            stale
              ? Effect.updateContext(
                  sql.withTransaction(tracked),
                  (context: Context.Context<R>) =>
                    Context.omit(sql.transactionService)(context) as Context.Context<R>,
                )
              : sql.withTransaction(tracked),
          );
          return transaction.pipe(
            Effect.exit,
            Effect.flatMap((exit) =>
              Exit.isSuccess(exit)
                ? Effect.succeed(exit.value)
                : Effect.failCause(settle(exit.cause, work)),
            ),
          );
        });
      }),
    );
  }),
);

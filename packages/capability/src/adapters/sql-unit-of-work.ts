import { Cause, Context, Effect, Exit, Layer } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { holdsClosedUnit, UnitOfWork, UnitOfWorkFailed } from "../unit-of-work/unit-of-work.ts";

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
  // Stable Effect returns COMMIT errors as Fail; ROLLBACK errors still arrive as Die.
  const control = Cause.fromReasons<UnitOfWorkFailed>(
    cause.reasons.flatMap<Cause.Reason<UnitOfWorkFailed>>((reason) => {
      if (Cause.isDieReason(reason)) return [Cause.makeFailReason(failed(reason.defect))];
      if (Cause.isFailReason(reason)) {
        return reason.error instanceof WorkExited
          ? []
          : [Cause.makeFailReason(failed(reason.error))];
      }
      return [reason];
    }),
  );
  const workCause = Exit.isFailure(work) ? work.cause : Cause.empty;
  return Cause.combine(control, workCause);
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
              // A stand-in failure separates the work from transaction control failures.
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

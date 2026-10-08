import { Cause, Context, Effect, Exit, Schema } from "effect";

export class NoOpenUnit extends Schema.TaggedError<NoOpenUnit>()("NoOpenUnit", {}) {
  override get message(): string {
    return "This write must run inside an open unit of work. Open one with UnitOfWork.atomic or a transactional contract.";
  }
}

export class UnitOfWorkFailed extends Schema.TaggedError<UnitOfWorkFailed>()("UnitOfWorkFailed", {
  reason: Schema.String,
}) {
  override get message(): string {
    return `The unit of work could not open, commit or roll back: ${this.reason}`;
  }
}

export type OpenUnit = Readonly<{
  onRollback: (undo: Effect.Effect<void>) => Effect.Effect<void, NoOpenUnit>;
}>;

export const CurrentUnit = Context.Reference<OpenUnit | undefined>(
  "@house-rules/capability/CurrentUnit",
  { defaultValue: () => undefined },
);

export type Atomic = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
) => Effect.Effect<A, E | UnitOfWorkFailed, R>;

export type UnitOfWorkService = Readonly<{ atomic: Atomic }>;

const runAll = (hooks: ReadonlyArray<Effect.Effect<void>>) =>
  // Every hook runs even when an earlier one fails or dies, and the unit keeps all their causes.
  Effect.forEach(hooks, (hook) => Effect.exit(hook)).pipe(
    Effect.flatMap((exits) => {
      const causes = exits.flatMap((exit) => (Exit.isFailure(exit) ? [exit.cause] : []));
      const [first, ...rest] = causes;
      return first === undefined
        ? Effect.void
        : Effect.failCause(rest.reduce((all, next) => Cause.combine(all, next), first));
    }),
  );

const liveUnits = new WeakSet<OpenUnit>();

export const liveUnit: Effect.Effect<OpenUnit | undefined> = Effect.map(CurrentUnit, (unit) =>
  // A forked fiber keeps CurrentUnit after its unit's work ends, so only a unit still open counts.
  unit !== undefined && liveUnits.has(unit) ? unit : undefined,
);

export const holdsClosedUnit: Effect.Effect<boolean> = Effect.map(
  CurrentUnit,
  (unit) => unit !== undefined && !liveUnits.has(unit),
);

export const makeUnitOfWork = (
  transaction: Atomic,
  topLevel: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
): UnitOfWorkService => ({
  atomic: (effect) =>
    Effect.gen(function* atomic() {
      // A nested call joins the open unit: no second transaction, no savepoint.
      if ((yield* liveUnit) !== undefined) return yield* effect;
      // topLevel wraps the whole unit, its rollback hooks and its close, so a nested call skips it.
      return yield* topLevel(
        Effect.suspend(() => {
          const hooks: Array<Effect.Effect<void>> = [];
          const unit: OpenUnit = {
            onRollback: (undo) =>
              Effect.suspend(() =>
                liveUnits.has(unit)
                  ? Effect.sync(() => void hooks.unshift(undo))
                  : Effect.fail(new NoOpenUnit()),
              ),
          };
          const close = Effect.sync(() => void liveUnits.delete(unit));
          liveUnits.add(unit);
          // Closed when the work ends, before COMMIT, ROLLBACK and undo, so a racing fiber cannot join.
          const work = Effect.provideService(effect, CurrentUnit, unit).pipe(
            Effect.ensuring(close),
          );
          return transaction(work).pipe(
            Effect.onError(() => Effect.suspend(() => runAll([...hooks]))),
            Effect.ensuring(close),
          );
        }),
      );
    }),
});

export class UnitOfWork extends Context.Service<UnitOfWork, UnitOfWorkService>()(
  "@house-rules/capability/UnitOfWork",
) {
  static readonly make = (transaction: Atomic): UnitOfWorkService =>
    makeUnitOfWork(transaction, (effect) => effect);

  static readonly atomic = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | UnitOfWorkFailed, R | UnitOfWork> =>
    Effect.gen(function* atomicThroughService() {
      const unitOfWork = yield* UnitOfWork;
      return yield* unitOfWork.atomic(effect);
    });

  static readonly required: Effect.Effect<void, NoOpenUnit> = Effect.gen(function* required() {
    if ((yield* liveUnit) === undefined) return yield* new NoOpenUnit();
  });

  static readonly onRollback = (undo: Effect.Effect<void>): Effect.Effect<void, NoOpenUnit> =>
    Effect.gen(function* onRollback() {
      const unit = yield* liveUnit;
      if (unit === undefined) return yield* new NoOpenUnit();
      yield* unit.onRollback(undo);
    });
}

import { CallWatch, CurrentActor } from "@house-rules/application";
import { Cause, Effect, Exit, Layer, Option } from "effect";

export type CallNote = Readonly<{ capability: string; actor: string | null; outcome: string }>;

export class CallNotes {
  // What a capability call saw, kept by request id until its HTTP access line is written.
  readonly #notes = new Map<string, CallNote>();
  readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  record(requestId: string, note: CallNote): void {
    this.#notes.set(requestId, note);
    // A request that never reaches the HTTP log, such as an in-process call, must not grow the map forever.
    for (const oldest of this.#notes.keys()) {
      if (this.#notes.size <= this.limit) break;
      this.#notes.delete(oldest);
    }
  }

  take(requestId: string): CallNote | undefined {
    const note = this.#notes.get(requestId);
    this.#notes.delete(requestId);
    return note;
  }
}

export const callNotes = new CallNotes(500);

const outcomeOf = (exit: Exit.Exit<unknown, unknown>): string => {
  if (Exit.isSuccess(exit)) return "ok";
  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isNone(failure)) return "defect";
  const error: unknown = failure.value;
  return typeof error === "object" && error !== null && "_tag" in error
    ? String(error._tag)
    : "failure";
};

const actorId = Effect.serviceOption(CurrentActor).pipe(
  Effect.map(Option.match({ onNone: () => null, onSome: (actor) => String(actor.id) })),
);

export const requestLogWatch = (notes: CallNotes): Layer.Layer<never> =>
  Layer.effect(
    CallWatch,
    Effect.gen(function* requestLog() {
      // Wraps the CallWatch below it, call-audit here, so the audit still sees every call.
      const inner = yield* CallWatch;
      return {
        around: (contract, input, run, facts) =>
          Effect.gen(function* notedCall() {
            const actor = yield* actorId;
            const requestId = facts?.requestId ?? null;
            return yield* inner.around(contract, input, run, facts).pipe(
              Effect.onExit((exit) =>
                Effect.sync(() => {
                  if (requestId !== null) {
                    notes.record(requestId, {
                      capability: contract.name,
                      actor,
                      outcome: outcomeOf(exit),
                    });
                  }
                }),
              ),
            );
          }),
      };
    }),
  );

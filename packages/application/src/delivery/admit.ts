import { Cause, type Context, Effect, Exit, Option } from "effect";
import { CallChannel } from "../call/call-facts.ts";
import { requestIdHeader } from "../call/request-id.ts";
import type { Caller, Incoming, Refused } from "./caller.ts";
import { type Composition, serveIn } from "./composition.ts";
import { closedFailure, inRequest, internalError, layerFailure, type Outcome } from "./invoke.ts";
import { defaultViews, safeViewOf, type ViewTable } from "./views.ts";

declare const admittedBrand: unique symbol;

export type Admitted = Readonly<{ [admittedBrand]: true }>;

export type AdmitOptions<A> = Readonly<{
  caller?: Caller<never, A>;
  channel?: string;
}>;

type Admission = Readonly<{
  app: object;
  context: Context.Context<never>;
  requestId: string;
  channel: string;
}>;

const admissions = new WeakMap<Admitted, Admission>();

export const admittedRequestId = (admitted: Admitted): string | undefined =>
  admissions.get(admitted)?.requestId;

export const resolvedFor = (app: object, admitted: Admitted): Effect.Effect<Admission> =>
  Effect.suspend(() => {
    const held = admissions.get(admitted);
    return held?.app === app
      ? Effect.succeed(held)
      : Effect.die("Admitted belongs to another composition");
  });

export const admit = <A, C, Views extends ViewTable<C>, E = never>(
  app: Composition<A, C, Views, E>,
  incoming: Incoming,
  options: AdmitOptions<A> = {},
): Promise<Outcome<Admitted, Refused | E>> => {
  const views = { ...defaultViews, ...app.views };
  const kept = incoming.headers.get(requestIdHeader);
  const channel = options.channel ?? "web";
  const answered = serveIn<A, Outcome<Admitted, unknown>>(app, {
    ready: (context) =>
      Effect.gen(function* admitCaller() {
        const exit = yield* Effect.exit(
          Effect.suspend(() => (options.caller ?? app.caller)(incoming)),
        );
        if (Exit.isSuccess(exit)) return { ok: true as const, value: exit.value };
        const failure = Cause.findErrorOption(exit.cause);
        if (Option.isNone(failure)) {
          yield* Effect.logError("Caller died", exit.cause);
          return internalError;
        }
        return {
          ok: false as const,
          error: failure.value,
          view: yield* safeViewOf(views, failure.value, undefined),
        };
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("Admission failed", cause).pipe(Effect.as(internalError)),
        ),
        Effect.provideService(CallChannel, channel),
        Effect.provideContext(context),
        inRequest(kept),
        Effect.map(([outcome, requestId]) => {
          if (!outcome.ok) return outcome;
          const admitted = Object.freeze({}) as Admitted;
          admissions.set(admitted, { app, context: outcome.value, requestId, channel });
          return { ok: true as const, value: admitted };
        }),
      ),
    failed: (cause) =>
      layerFailure(views, cause).pipe(
        inRequest(kept),
        Effect.map(([value]) => value),
      ),
    closed: closedFailure(views).pipe(
      inRequest(kept),
      Effect.map(([value]) => value),
    ),
  });
  return Effect.runPromise(answered) as Promise<Outcome<Admitted, Refused | E>>;
};

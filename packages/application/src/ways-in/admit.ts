import type { Actor } from "@house-rules/domain";
import { Cause, Effect, Exit, Option } from "effect";
import { CallChannel } from "../call/call-facts.ts";
import { requestIdHeader } from "../call/request-id.ts";
import { type Incoming, Refused } from "./caller.ts";
import { type Composition, serveIn } from "./composition.ts";
import { closedFailure, inRequest, internalError, layerFailure, type Outcome } from "./invoke.ts";
import { isNetworkWay } from "./way-validation.ts";
import { safeViewOf } from "./views.ts";

declare const admittedBrand: unique symbol;
export type Admitted = Readonly<{ [admittedBrand]: true }>;
export type AdmitOptions = Readonly<{ way: string; channel?: string }>;
type Admission = Readonly<{
  app: object;
  way: string;
  actor: Actor;
  requestId: string;
  channel: string;
}>;
const admissions = new WeakMap<Admitted, Admission>();
export const admittedRequestId = (admitted: Admitted): string | undefined =>
  admissions.get(admitted)?.requestId;
export const resolvedFor = (
  app: object,
  admitted: Admitted,
  way: string,
): Effect.Effect<Admission> =>
  Effect.suspend(() => {
    const held = admissions.get(admitted);
    return held?.app === app && held.way === way
      ? Effect.succeed(held)
      : Effect.die("Admitted belongs to another composition or way");
  });
export const admit = <A, AppBuildError>(
  app: Composition<A, AppBuildError>,
  incoming: Incoming,
  options: AdmitOptions,
): Promise<Outcome<Admitted, Refused | AppBuildError>> => {
  const way = app.ways.filter(isNetworkWay).find((candidate) => candidate.name === options.way);
  const kept = incoming.headers.get(requestIdHeader);
  const channel = options.channel ?? "web";
  const answered = serveIn<A, Outcome<Admitted, unknown>>(app, {
    ready: (context) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            if (way === undefined)
              return yield* new Refused({ status: 403, code: "forbidden", message: "Unknown way" });
            return yield* way.who.resolve(incoming);
          }).pipe(Effect.provideService(CallChannel, channel), Effect.provideContext(context)),
        );
        if (Exit.isSuccess(exit)) return { ok: true as const, value: exit.value };
        const failure = Cause.findErrorOption(exit.cause);
        if (Option.isNone(failure)) {
          yield* Effect.logError("Who died", exit.cause);
          return internalError;
        }
        return {
          ok: false as const,
          error: failure.value,
          view: yield* safeViewOf(way?.overrides, failure.value, true),
        };
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("Admission failed", cause).pipe(Effect.as(internalError)),
        ),
        inRequest(kept),
        Effect.map(([outcome, requestId]) => {
          if (!outcome.ok) return outcome;
          const admitted = Object.freeze({}) as Admitted;
          admissions.set(admitted, {
            app,
            way: options.way,
            actor: outcome.value,
            requestId,
            channel,
          });
          return { ok: true as const, value: admitted };
        }),
      ),
    failed: (cause) =>
      layerFailure(way?.overrides, cause).pipe(
        inRequest(kept),
        Effect.map(([value]) => value),
      ),
    closed: closedFailure(way?.overrides).pipe(
      inRequest(kept),
      Effect.map(([value]) => value),
    ),
  });
  return Effect.runPromise(answered) as Promise<Outcome<Admitted, Refused | AppBuildError>>;
};

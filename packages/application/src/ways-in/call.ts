import { Effect } from "effect";
import type { AnyFeature } from "../feature/feature.ts";
import type { FeatureFailure } from "../execution/run-feature.ts";
import { requestIdHeader } from "../call/request-id.ts";
import { Mean } from "../socket/mean.ts";
import { type Admitted, admittedRequestId, resolvedFor } from "./admit.ts";
import type { Incoming, Refused } from "./caller.ts";
import { type Composition, serveIn } from "./composition.ts";
import {
  closedFailure,
  inRequest,
  internalError,
  invoke,
  layerFailure,
  type Outcome,
} from "./invoke.ts";
import { isNetworkWay } from "./way-validation.ts";
import { Refused as RefusedError } from "./caller.ts";

export type CallOptions = Readonly<{ way: string; admitted?: Admitted }>;
export const call = <A, AppBuildError, E extends AnyFeature>(
  app: Composition<A, AppBuildError>,
  feature: E,
  input: E["input"]["Type"],
  incoming: Incoming,
  options: CallOptions,
): Promise<Outcome<E["output"]["Type"], FeatureFailure<E> | Refused | AppBuildError>> => {
  const way = app.ways.filter(isNetworkWay).find((candidate) => candidate.name === options.way);
  const kept =
    (options.admitted === undefined ? undefined : admittedRequestId(options.admitted)) ??
    incoming.headers.get(requestIdHeader);
  const answered = serveIn(app, {
    ready: (context) =>
      Effect.gen(function* () {
        if (Object.hasOwn(options, "caller"))
          return yield* Effect.die("call does not accept a caller override");
        if (way === undefined) {
          const error = new RefusedError({
            status: 403,
            code: "forbidden",
            message: "Unknown way",
          });
          return {
            ok: false as const,
            error,
            view: { status: 403, body: { error: { code: "forbidden", message: error.message } } },
          };
        }
        const resolved =
          options.admitted === undefined
            ? undefined
            : yield* resolvedFor(app, options.admitted, options.way);
        return yield* invoke(app, context, feature, {
          way,
          incoming,
          input: Effect.succeed({ value: input, source: "json" }),
          typed: true,
          channel: resolved?.channel ?? "web",
          ...(resolved === undefined ? {} : { resolved: resolved.actor }),
          approval: Mean.allow.approval,
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("Call failed", cause).pipe(Effect.as(internalError)),
        ),
        inRequest(kept),
      ),
    failed: (cause) => layerFailure(way?.overrides, cause).pipe(inRequest(kept)),
    closed: closedFailure(way?.overrides).pipe(inRequest(kept)),
  });
  return Effect.runPromise(answered.pipe(Effect.map(([outcome]) => outcome))) as Promise<
    Outcome<E["output"]["Type"], FeatureFailure<E> | Refused | AppBuildError>
  >;
};

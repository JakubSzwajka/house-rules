import type { Actor, KindedError } from "@house-rules/domain";
import type { CallPermissions } from "../socket/permission-lists.ts";
import { Cause, Context, Effect, Exit, type Layer, Option, Schema } from "effect";
import { CurrentActor } from "../actor/current-actor.ts";
import { CallChannel } from "../call/call-facts.ts";
import { newRequestId, requestIdOf, withRequestId } from "../call/request-id.ts";
import type { AnyFeature } from "../feature/feature.ts";
import { runFeature } from "../execution/run-feature.ts";
import type { Approval } from "../gates/approval.ts";
import { May } from "../socket/may.ts";
import type { Incoming, Refused } from "./caller.ts";
import { type AnyComposition, builtContext, type Composition } from "./composition.ts";
import { CompositionClosed } from "./composition-closed.ts";
import {
  decodeInput,
  decodeValue,
  type InputFault,
  type InputInvalid,
  type InputSource,
  invalidFor,
} from "./input.ts";
import { internalErrorView, safeViewOf, type View } from "./views.ts";
import type { AnyWay } from "./way-validation.ts";

export type Outcome<Value, Failure> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{
      ok: false;
      error: Failure | Refused | InputInvalid | CompositionClosed | undefined;
      view: View;
    }>;
export type RawInput = Readonly<{ value: unknown; source: InputSource }>;
export const internalError = { ok: false as const, error: undefined, view: internalErrorView };
export const logDefect = (
  app: AnyComposition,
  message: string,
  cause: Cause.Cause<unknown>,
): Effect.Effect<void> =>
  Effect.suspend(() => {
    const built = builtContext(app);
    return built === undefined
      ? Effect.logError(message, cause)
      : Effect.logError(message, cause).pipe(Effect.provideContext(built));
  });
export const layerFailure = (
  overrides: Readonly<Record<string, unknown>> | undefined,
  cause: Cause.Cause<unknown>,
): Effect.Effect<Outcome<never, unknown>> =>
  Effect.gen(function* () {
    yield* Effect.logError("The app layer did not build", cause);
    const failure = Cause.findErrorOption(cause);
    if (Option.isNone(failure)) return internalError;
    return {
      ok: false as const,
      error: failure.value,
      view: yield* safeViewOf(overrides, failure.value),
    };
  });
export const closedFailure = (
  overrides?: Readonly<Record<string, unknown>>,
): Effect.Effect<Outcome<never, CompositionClosed>> =>
  Effect.gen(function* () {
    const error = new CompositionClosed();
    return { ok: false as const, error, view: yield* safeViewOf(overrides, error) };
  });

export const invoke = <A>(
  app: Pick<Composition<A, unknown>, "may" | "system" | "gatePolicy">,
  context: Context.Context<A>,
  feature: AnyFeature,
  options: Readonly<{
    way: AnyWay<A>;
    incoming: Incoming;
    input: Effect.Effect<RawInput, InputFault | Refused>;
    channel: string;
    resolved?: Actor;
    approval: Layer.Layer<Approval>;
    encodeOutput?: boolean;
    decoded?: boolean;
    typed?: boolean;
  }>,
): Effect.Effect<Outcome<unknown, unknown>> =>
  Effect.gen(function* () {
    // composition checks the feature requirements and Who inputs before storing these erased features.
    const execute = runFeature as unknown as (
      feature: AnyFeature,
      input: unknown,
    ) => Effect.Effect<unknown, KindedError, A | CallPermissions | Approval>;
    let invokingFeature = false;
    const program = Effect.gen(function* () {
      const publicFeature =
        options.way.protocol === "http" && options.way.public?.includes(feature) === true;
      const actor = publicFeature
        ? undefined
        : (options.resolved ?? (yield* options.way.who.resolve(options.incoming)));
      const raw = yield* options.input.pipe(
        Effect.mapError((error) =>
          error._tag === "InputFault" ? invalidFor(feature.name)(error) : error,
        ),
      );
      const input =
        options.decoded === true
          ? raw.value
          : options.typed === true
            ? yield* decodeValue(feature, raw.value)
            : yield* decodeInput(feature, raw.value, raw.source);
      invokingFeature = true;
      const execution = execute(feature, input);
      return yield* (
        actor === undefined
          ? execution.pipe(
              Effect.updateContext<A | CallPermissions | Approval, A | CallPermissions | Approval>(
                (context) =>
                  Context.omit(CurrentActor)(context) as Context.Context<
                    A | CallPermissions | Approval
                  >,
              ),
            )
          : execution.pipe(Effect.provideService(CurrentActor, actor))
      ).pipe(
        Effect.provideContext(
          May.context(yield* app.may, {
            features: options.way.features,
            system: app.system,
            via: options.way.name,
            gatePolicy: app.gatePolicy,
          }),
        ),
        Effect.provide(options.approval),
        Effect.provideService(CallChannel, options.channel),
      );
    });
    const exit = yield* Effect.exit(
      program.pipe(
        Effect.provideContext(context),
        Effect.provideService(CallChannel, options.channel),
      ),
    );
    if (Exit.isSuccess(exit)) {
      if (options.encodeOutput !== true) return { ok: true as const, value: exit.value };
      const encoded = yield* Effect.exit(
        Schema.encodeUnknownEffect(Schema.toCodecJson(feature.output))(exit.value),
      );
      if (Exit.isSuccess(encoded)) return { ok: true as const, value: encoded.value };
      yield* Effect.logError("Feature output did not encode", encoded.cause);
      return internalError;
    }
    const failure = Cause.findErrorOption(exit.cause);
    if (Option.isNone(failure)) {
      yield* Effect.logError("Feature died", exit.cause);
      return internalError;
    }
    return {
      ok: false as const,
      error: failure.value,
      view: yield* safeViewOf(options.way.overrides, failure.value, !invokingFeature),
    };
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Way invocation failed", cause).pipe(Effect.as(internalError)),
    ),
    Effect.annotateLogs("feature", feature.name),
  );

export const requestIdFor = (incoming: string | null): Effect.Effect<string> => {
  const kept = requestIdOf(incoming);
  return kept === null ? newRequestId : Effect.succeed(kept);
};
export const inRequest =
  (incoming: string | null) =>
  <Value, E, R>(
    effect: Effect.Effect<Value, E, R>,
  ): Effect.Effect<readonly [Value, string], E, R> =>
    requestIdFor(incoming).pipe(
      Effect.flatMap((id) =>
        withRequestId(effect, id).pipe(Effect.map((value) => [value, id] as const)),
      ),
    );

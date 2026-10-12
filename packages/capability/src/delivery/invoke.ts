import { Cause, type Context, Effect, Exit, type Layer, Option, Schema } from "effect";
import { CallChannel } from "../call/call-facts.ts";
import { newRequestId, requestIdOf, withRequestId } from "../call/request-id.ts";
import type { AnyContract } from "../contract/contract.ts";
import type { Approval } from "../gates/approval.ts";
import type { Caller, Incoming, Refused } from "./caller.ts";
import type { Composition } from "./composition.ts";
import { decodeInput, type InputInvalid, type InputSource } from "./input.ts";
import { internalErrorView, safeViewOf, tagOf, type View } from "./views.ts";

export type AnyFailure = NonNullable<unknown> | null | undefined;

export type AnyServices = NonNullable<unknown> | null | undefined;

export type Mountable = Readonly<{
  contract: AnyContract;
  handler: (input: never) => Effect.Effect<unknown, AnyFailure, AnyServices>;
}>;

type Runnable = (input: unknown) => Effect.Effect<unknown, AnyFailure>;

export type SuccessOf<Cap extends Mountable> = Cap["contract"]["output"]["Type"];

export type FailureOfCapability<Cap extends Mountable> = Effect.Error<ReturnType<Cap["handler"]>>;

export type ServicesOf<Cap extends Mountable> = Effect.Services<ReturnType<Cap["handler"]>>;

export type Outcome<Value, Failure> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; error: Failure | Refused | InputInvalid | undefined; view: View }>;

export type RawInput = Readonly<{ value: unknown; source: InputSource }>;

export type ApprovalOption = Layer.Layer<Approval> | "fromCaller";

export type InvokeOptions<A> = Readonly<{
  incoming: Incoming;
  input: Effect.Effect<RawInput, InputInvalid | Refused>;
  channel: string;
  caller: Caller<never, A>;
  resolved?: Context.Context<never>;
  approval: ApprovalOption | undefined;
  defaultApproval: Layer.Layer<Approval>;
  views: Readonly<Record<string, unknown>>;
  encodeOutput?: boolean;
}>;

const internalError = { ok: false as const, error: undefined, view: internalErrorView };

export const logDefect = <A, C>(
  app: Composition<A, C>,
  message: string,
  cause: Cause.Cause<unknown>,
): Effect.Effect<void> =>
  Effect.exit(app.runtime.contextEffect).pipe(
    Effect.flatMap((built) =>
      Exit.isSuccess(built)
        ? Effect.logError(message, cause).pipe(Effect.provideContext(built.value))
        : Effect.logError(message, cause),
    ),
  );

const withApproval = (
  run: Effect.Effect<unknown, AnyFailure>,
  resolved: Context.Context<never>,
  options: Readonly<{
    approval: ApprovalOption | undefined;
    defaultApproval: Layer.Layer<Approval>;
  }>,
): Effect.Effect<unknown, AnyFailure> => {
  if (options.approval === "fromCaller") {
    return run.pipe(Effect.provideContext(resolved), Effect.provide(options.defaultApproval));
  }
  const approval = options.approval ?? options.defaultApproval;
  // The adapter's Approval sits inside the caller's context, so a caller cannot replace it.
  return run.pipe(Effect.provide(approval), Effect.provideContext(resolved));
};

export const invoke = <A, C>(
  app: Composition<A, C>,
  capability: Mountable,
  options: InvokeOptions<A>,
): Effect.Effect<Outcome<unknown, unknown>> =>
  Effect.gen(function* invokeCapability() {
    const built = yield* Effect.exit(app.runtime.contextEffect);
    if (Exit.isFailure(built)) {
      yield* Effect.logError("The app layer did not build", built.cause);
      return internalError;
    }
    const appContext = built.value;
    let callerContext: Context.Context<never> | undefined;
    const program = Effect.gen(function* gatedCall() {
      const resolved = options.resolved ?? (yield* options.caller(options.incoming));
      callerContext = resolved;
      const raw = yield* options.input;
      const input = yield* decodeInput(capability.contract, raw.value, raw.source);
      // The mount check proved at compile time that the app, the caller and the adapter provide every service.
      const run = capability.handler as unknown as Runnable;
      return yield* withApproval(run(input), resolved, options).pipe(
        Effect.provideService(CallChannel, options.channel),
      );
    });
    const encode = (value: unknown) =>
      options.encodeOutput === true
        ? Schema.encodeUnknownEffect(Schema.toCodecJson(capability.contract.output))(value)
        : Effect.succeed(value);
    // The app context also carries the app's loggers, so the lines below go where the app sends its logs.
    return yield* Effect.gen(function* settle() {
      const exit = yield* Effect.exit(program);
      if (Exit.isSuccess(exit)) {
        const encoded = yield* Effect.exit(encode(exit.value));
        if (Exit.isSuccess(encoded)) return { ok: true as const, value: encoded.value };
        yield* Effect.logError("Capability output did not encode", encoded.cause);
        return internalError;
      }
      const failure = Cause.findErrorOption(exit.cause);
      if (Option.isNone(failure)) {
        yield* Effect.logError("Capability died", exit.cause);
        return internalError;
      }
      const tag = tagOf(failure.value);
      if (tag === undefined || !Object.hasOwn(options.views, tag)) {
        yield* Effect.logError("Capability failed with an error that has no view", exit.cause);
      }
      return {
        ok: false as const,
        error: failure.value,
        view: yield* safeViewOf(options.views, failure.value, callerContext),
      };
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Delivery failed", cause).pipe(Effect.as(internalError)),
      ),
      Effect.provideContext(appContext),
    );
  }).pipe(Effect.annotateLogs("capability", capability.contract.name));

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

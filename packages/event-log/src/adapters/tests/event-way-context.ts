import { Context, Effect, Option, References, Tracer } from "effect";
import { HttpServerRequest } from "effect/http";
import { CallChannel, CallerContext, CallRequestId, CurrentActor } from "@house-rules/application";

export class PoisonTesting extends Context.Service<PoisonTesting, string>()(
  "test/event-way/Poison",
) {}
export const observeEventTesting = Effect.gen(function* () {
  const context = yield* Effect.context();
  let span = Context.getOrUndefined(context, Tracer.ParentSpan);
  while (span?._tag === "Span" && Option.isSome(span.parent)) span = span.parent.value;
  return {
    caller: (yield* CallerContext).kind,
    actor: Option.isSome(yield* Effect.serviceOption(CurrentActor)),
    channel: yield* CallChannel,
    id: yield* CallRequestId,
    poisoned: Context.getOrUndefined(context, PoisonTesting) !== undefined,
    network: Context.getOrUndefined(context, HttpServerRequest.HttpServerRequest) !== undefined,
    annotations: yield* References.CurrentLogAnnotations,
    parent: span?._tag === "Span" ? span.parent : undefined,
    spanName: span?._tag === "Span" ? span.name : undefined,
  };
});

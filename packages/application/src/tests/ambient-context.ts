import { expect } from "@effect/vitest";
import { Context, Effect, References, Tracer } from "effect";

class RequestDataTesting extends Context.Service<RequestDataTesting, unknown>()(
  "test/isolation/RequestData",
) {}

export const withAmbientTesting = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provideService(RequestDataTesting, { person: "synthetic-person", token: "synthetic" }),
    Effect.annotateLogs({ authorization: "Bearer synthetic", person: "synthetic-person" }),
    Effect.withSpan("ambient-who", { attributes: { person: "synthetic-person" } }),
    Effect.annotateSpans({ credential: "synthetic" }),
  );

export const inspectAmbientTesting = Effect.gen(function* () {
  const context = yield* Effect.context();
  const annotations = yield* References.CurrentLogAnnotations;
  const span = Context.getOrUndefined(context, Tracer.ParentSpan);
  return {
    extra: Context.getOrUndefined(context, RequestDataTesting),
    annotations,
    span,
  };
});

export const assertAmbientTesting = (ambient: Effect.Success<typeof inspectAmbientTesting>) => {
  expect(ambient.extra).toBeUndefined();
  expect(ambient.annotations).not.toHaveProperty("authorization");
  expect(ambient.annotations).not.toHaveProperty("person");
  expect(ambient.span?._tag).toBe("Span");
  if (ambient.span?._tag === "Span") {
    expect(ambient.span.parent._tag).toBe("None");
    expect(ambient.span.name).not.toBe("ambient-who");
    expect(ambient.span.attributes.has("person")).toBe(false);
    expect(ambient.span.attributes.has("credential")).toBe(false);
    expect(ambient.span.links).toEqual([]);
  }
};

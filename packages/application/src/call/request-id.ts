import { Effect, Random } from "effect";
import { dual } from "effect/Function";
import { CallRequestId } from "./call-facts.ts";

export { requestIdHeader, requestIdOf } from "./request-id-header.ts";

const randomWord = Random.nextIntBetween(0, 0xffff_ffff).pipe(
  Effect.map((word) => word.toString(16).padStart(8, "0")),
);

export const newRequestId: Effect.Effect<string> = Effect.all([
  randomWord,
  randomWord,
  randomWord,
  randomWord,
]).pipe(Effect.map((words) => words.join("")));

export const withRequestId: {
  (id: string): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  <A, E, R>(effect: Effect.Effect<A, E, R>, id: string): Effect.Effect<A, E, R>;
} = dual(
  2,
  <A, E, R>(effect: Effect.Effect<A, E, R>, id: string): Effect.Effect<A, E, R> =>
    effect.pipe(Effect.provideService(CallRequestId, id), Effect.annotateLogs("requestId", id)),
);

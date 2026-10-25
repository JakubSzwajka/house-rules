import { Effect, Random } from "effect";

export const randomWorkItemId = Effect.all(
  Array.from({ length: 4 }, () => Random.nextIntBetween(0, 0xffff_ffff)),
).pipe(Effect.map((words) => words.map((word) => word.toString(16).padStart(8, "0")).join("")));

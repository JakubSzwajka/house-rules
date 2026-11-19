import * as Domain from "@alchemy.run/domain";
import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { layer } from "../postgres-platform.ts";
import { drained, Mark, Marks, OtherMark, OtherMarks } from "./backfill-fixture.ts";

export const historyOnly = (schema: string, count = 4, earlier = false) => {
  class Backfilled extends Domain.Model("Backfilled", { aggregates: [Marks, OtherMarks] }) {}
  expect(Domain.verify(Backfilled)).toEqual([]);
  return Effect.gen(function* () {
    const marks = yield* Marks;
    for (let n = 0; n < count; n++) {
      yield* marks.send(earlier ? "0" : n % 2 === 0 ? "a" : "z", new Mark({ value: String(n) }));
    }
    if (!earlier) {
      const other = yield* OtherMarks;
      yield* other.send("other", new OtherMark({ value: "other" }));
    }
    yield* drained(schema);
  }).pipe(
    Effect.scoped,
    Effect.provide(Backfilled.layer(Layer.empty).pipe(Layer.provide(layer({ schema })))),
  );
};

export const declarations = [
  {
    version: 0,
    lazyTarget: "view:Individual",
    eagerTarget: "view:Individual",
    secondSource: false,
  },
  {
    version: 1,
    lazyTarget: "view:Individual@1",
    eagerTarget: "view:Individual#1",
    secondSource: true,
  },
] as const;

import { featureFixture, RuntimeFixture } from "./feature-fixtures.ts";
import { afterAll, expect, it } from "@effect/vitest";
import { asSystem, defineOperation, NoInput } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import {
  bindOperation,
  call,
  composition,
  defineWay,
  endpoint,
  Forbidden,
  May,
  Mean,
  StepTrace,
} from "../index.ts";
import { testActor } from "./execution-fixtures.ts";

const disposers: Array<() => Promise<void>> = [];
afterAll(() => Promise.all(disposers.map((dispose) => dispose())));
const options = {
  description: "Test",
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
  permission: null,
} as const;

it.effect("composition checks closure permissions and inner permissions in every way", () =>
  Effect.gen(function* () {
    const leaf = defineOperation("policy_leaf", {
      ...options,
      permission: "items:inner",
      readOnly: true,
    });
    for (const caller of ["person", "system"] as const) {
      const parent = defineOperation("policy_parent", {
        ...options,
        readOnly: true,
        edges: [caller === "person" ? leaf : asSystem(leaf, "background")],
      });
      const current = featureFixture(parent);
      const held: Array<"items:inner"> = [];
      const ways = (["web", "partner"] as const).map((name) =>
        defineWay({
          name,
          path: `/${name}`,
          protocol: "http",
          features: [current],
          endpoints: [endpoint(current)],
          who: { resolve: () => Effect.succeed(testActor) },
          mean: Mean.no,
        }),
      );
      let parents = 0;
      let ran = 0;
      const app = composition({
        modules: {
          mounts: RuntimeFixture.mounts({
            bindings: [
              bindOperation(parent, (_input, scope) =>
                Effect.sync(() => {
                  parents += 1;
                  held.length = 0;
                }).pipe(Effect.andThen(scope.call(leaf, {}))),
              ),
              bindOperation(leaf, () =>
                Effect.sync(() => {
                  ran += 1;
                }),
              ),
            ],
            features: [current],
            ways,
          }),
          layer: StepTrace.layer(),
        },
        features: [current],
        ways,
        may: Effect.succeed(May.fixed(held)),
        system: held,
      });
      disposers.push(app.dispose);
      for (const way of ways) {
        for (const passesClosure of [false, true]) {
          held.length = 0;
          if (passesClosure) held.push("items:inner");
          const before = parents;
          const outcome = yield* Effect.promise(() =>
            call(
              app,
              current,
              {},
              {
                headers: new Headers(),
                url: `https://app.example/${way.name}`,
              },
              { way: way.name },
            ),
          );
          expect(outcome.ok).toBe(false);
          if (!outcome.ok) {
            expect(outcome.view.status).toBe(403);
            expect(outcome.error).toEqual(
              new Forbidden({
                feature: parent.name,
                permission: "items:inner",
                caller,
              }),
            );
          }
          expect(parents - before).toBe(passesClosure ? 1 : 0);
          expect(ran).toBe(0);
        }
      }
    }
  }),
);

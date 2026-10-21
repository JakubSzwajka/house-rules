import { featureFixture, RuntimeFixture } from "./feature-fixtures.ts";
import { afterAll, expect, it } from "@effect/vitest";
import { asSystem, defineOperation, NoInput } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import {
  bindOperation,
  call,
  composition,
  defineWay,
  endpoint,
  featureAndRecheck,
  featureOnly,
  Forbidden,
  May,
  Mean,
  Runtime,
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

it.effect("composition passes its default and explicit gate policy into every way's calls", () =>
  Effect.gen(function* () {
    const leaf = defineOperation("policy_leaf", {
      ...options,
      permission: "items:inner",
      readOnly: true,
    });
    for (const gatePolicy of [undefined, featureAndRecheck, featureOnly] as const) {
      for (const caller of ["person", "system"] as const) {
        const parent = defineOperation("policy_parent", {
          ...options,
          readOnly: true,
          edges: [caller === "person" ? leaf : asSystem(leaf, "background")],
        });
        const current = featureFixture(parent);
        const held: Array<"items:inner"> = ["items:inner"];
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
        let ran = 0;
        const app = composition({
          layer: Layer.mergeAll(
            RuntimeFixture.layer({
              bindings: [
                bindOperation(parent, (_input, scope) =>
                  Effect.sync(() => {
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
            StepTrace.layer(),
          ),
          features: [current],
          ways,
          may: May.fixed(held),
          system: held,
          ...(gatePolicy === undefined ? {} : { gatePolicy }),
        });
        disposers.push(app.dispose);
        expect(app.gatePolicy).toBe(gatePolicy ?? featureAndRecheck);
        for (const way of ways) {
          held.push("items:inner");
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
          expect(outcome.ok).toBe(gatePolicy === featureOnly);
          if (!outcome.ok)
            expect(outcome.error).toEqual(
              new Forbidden({
                feature: parent.name,
                permission: "items:inner",
                caller,
              }),
            );
        }
        expect(ran).toBe(gatePolicy === featureOnly ? 2 : 0);
      }
    }
  }),
);

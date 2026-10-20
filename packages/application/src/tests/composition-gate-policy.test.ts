import { afterAll, expect, it } from "@effect/vitest";
import { asSystem, defineNode, NoInput } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import {
  bindNode,
  call,
  composition,
  defineEntry,
  defineWay,
  endpoint,
  entryAndRecheck,
  entryOnly,
  Forbidden,
  May,
  Mean,
  NodeRuntime,
  StepTrace,
} from "../index.ts";
import { testActor } from "./entry-fixtures.ts";

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
    const leaf = defineNode("policy_leaf", {
      ...options,
      permission: "items:inner",
      readOnly: true,
    });
    for (const gatePolicy of [undefined, entryAndRecheck, entryOnly] as const) {
      for (const caller of ["person", "system"] as const) {
        const parent = defineNode("policy_parent", {
          ...options,
          readOnly: true,
          edges: [caller === "person" ? leaf : asSystem(leaf, "background")],
        });
        const forged = { ...defineEntry(parent), closures: { person: [], system: [] } };
        const ways = (["web", "partner"] as const).map((name) =>
          defineWay({
            name,
            path: `/${name}`,
            protocol: "http",
            entries: [forged],
            endpoints: [endpoint(forged)],
            who: { resolve: () => Effect.succeed(testActor) },
            may: May.fixed([forged], []),
            mean: Mean.no,
          }),
        );
        let ran = 0;
        const app = composition({
          layer: Layer.mergeAll(
            NodeRuntime.layer({
              bindings: [
                bindNode(parent, (_input, scope) => scope.call(leaf, {})),
                bindNode(leaf, () =>
                  Effect.sync(() => {
                    ran += 1;
                  }),
                ),
              ],
              entries: [forged],
              ways,
            }),
            StepTrace.layer(),
          ),
          entries: [forged],
          ways,
          system: [],
          ...(gatePolicy === undefined ? {} : { gatePolicy }),
        });
        disposers.push(app.dispose);
        expect(app.gatePolicy).toBe(gatePolicy ?? entryAndRecheck);
        for (const way of ways) {
          const outcome = yield* Effect.promise(() =>
            call(
              app,
              forged,
              {},
              {
                headers: new Headers(),
                url: `https://app.example/${way.name}`,
              },
              { way: way.name },
            ),
          );
          expect(outcome.ok).toBe(gatePolicy === entryOnly);
          if (!outcome.ok)
            expect(outcome.error).toEqual(
              new Forbidden({
                entry: parent.name,
                permission: "items:inner",
                caller,
              }),
            );
        }
        expect(ran).toBe(gatePolicy === entryOnly ? 2 : 0);
      }
    }
  }),
);

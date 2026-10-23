import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { planCommand, renderMap, validatePlan } from "../../index.ts";
import { plan } from "../../registry/tests/plan-fixtures.ts";

const broken = {
  ...plan,
  features: [...plan.features, { name: "orphan", permission: null, edges: ["Store.nothing"] }],
};

const files = (snapshotJson: string): Record<string, string> => ({
  "plan.json": JSON.stringify(plan),
  "broken.json": JSON.stringify(broken),
  "map.json": snapshotJson,
  "bad.json": "{ not json",
  "shape.json": JSON.stringify({ modules: [{ name: "" }], features: [], ways: [] }),
});

const run = (args: readonly string[]) =>
  Effect.gen(function* () {
    const store = files(renderMap(yield* validatePlan(plan), "json"));
    return yield* planCommand(args, (path) => {
      const text = store[path];
      return text === undefined ? Promise.reject(new Error("missing")) : Promise.resolve(text);
    });
  });

it.effect("view renders a valid plan as html and exits 0", () =>
  Effect.gen(function* () {
    const result = yield* run(["view", "plan.json"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(renderMap(yield* validatePlan(plan), "html"));
    const written = yield* run(["view", "plan.json", "-o", "out.html"]);
    expect(written).toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "Wrote out.html\n",
      output: { path: "out.html", content: result.stdout },
    });
  }),
);

it.effect("view reports plan issues with paths and exits 1", () =>
  Effect.gen(function* () {
    const result = yield* run(["view", "broken.json"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "broken.json: plan has 1 issue\n" +
        "  features[8].edges[0]: Unresolved edge target Store.nothing at orphan\n",
    );
    const shape = yield* run(["view", "shape.json"]);
    expect(shape.exitCode).toBe(1);
    expect(shape.stderr).toContain('["modules"][0]');
    expect((yield* run(["view", "bad.json"])).exitCode).toBe(1);
    expect((yield* run(["view", "missing.json"])).stderr).toBe(
      "missing.json: cannot read the file\n",
    );
  }),
);

it.effect("diff accepts plans and map json and prints text or html", () =>
  Effect.gen(function* () {
    const same = yield* run(["diff", "plan.json", "map.json", "--text"]);
    expect(same).toEqual({
      exitCode: 0,
      stdout: "MAP DIFF\n No changes: both maps describe the same app.\n",
      stderr: "",
    });
    const html = yield* run(["diff", "map.json", "plan.json"]);
    expect(html.exitCode).toBe(0);
    expect(html.stdout).toContain('<h2 id="changes">What changed</h2>');
    expect((yield* run(["diff", "plan.json", "broken.json"])).exitCode).toBe(1);
  }),
);

it.effect("wrong arguments print usage and exit 2", () =>
  Effect.gen(function* () {
    for (const args of [[], ["view"], ["diff", "plan.json"], ["view", "plan.json", "-o"], ["x"]])
      expect((yield* run(args)).exitCode).toBe(2);
    expect((yield* run(["view", "plan.json", "--bogus"])).stderr).toContain(
      "Unknown option --bogus",
    );
    expect((yield* run(["--help"])).exitCode).toBe(0);
  }),
);

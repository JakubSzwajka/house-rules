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
  "legacy-map.json": snapshotJson.replaceAll(
    /\s*"(?:transactional|needsApproval)": (?:true|false),/g,
    "",
  ),
  "flags.json": JSON.stringify({
    ...plan,
    features: [{ name: "x", permission: null, flags: { readOnly: true } }],
  }),
  "layers-only.json": JSON.stringify({ ...plan, layers: "copied snapshot" }),
  "permissions-only.json": JSON.stringify({ ...plan, permissions: [] }),
  "bad-map.json": JSON.stringify({ ...plan, layers: "snapshot", permissions: [] }),
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

it.effect("view --text prints the text map of a valid plan, to stdout or a file", () =>
  Effect.gen(function* () {
    const text = renderMap(yield* validatePlan(plan), "text");
    expect(yield* run(["view", "plan.json", "--text"])).toEqual({
      exitCode: 0,
      stdout: text,
      stderr: "",
    });
    for (const section of ["WAYS", "Mean:", "needs", "PLUGS", "PERMISSIONS"])
      expect(text).toContain(section);
    expect(yield* run(["view", "plan.json", "--text", "-o", "out.txt"])).toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "Wrote out.txt\n",
      output: { path: "out.txt", content: text },
    });
    const broken = yield* run(["view", "broken.json", "--text"]);
    expect(broken.exitCode).toBe(1);
    expect(broken.stdout).toBe("");
    expect(broken.stderr).toContain("features[8].edges[0]");
    expect((yield* run(["view", "map.json", "--text"])).exitCode).toBe(1);
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

it.effect("validate checks decoding and graph issues without rendering or writing", () =>
  Effect.gen(function* () {
    expect(yield* run(["validate", "plan.json"])).toEqual({
      exitCode: 0,
      stdout: "valid\n",
      stderr: "",
    });
    for (const file of ["broken.json", "shape.json", "bad.json", "missing.json", "flags.json"]) {
      const result = yield* run(["validate", file]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.output).toBeUndefined();
    }
    expect((yield* run(["validate", "broken.json"])).stderr).toContain("features[8].edges[0]");
    expect((yield* run(["validate", "flags.json"])).stderr).toContain('["features"][0]["flags"]');
    expect((yield* run(["--help"])).stdout).toContain("plan validate <plan.json>");
  }),
);

it.effect("only diff explicitly detects snapshots by both layers and permissions", () =>
  Effect.gen(function* () {
    for (const command of ["view", "validate"]) {
      const result = yield* run([command, "map.json"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not a valid plan");
      expect(result.stderr).toContain('["layers"]');
    }
    for (const file of ["flags.json", "layers-only.json", "permissions-only.json"]) {
      const result = yield* run(["diff", "plan.json", file]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not a valid plan");
    }
    const malformed = yield* run(["diff", "bad-map.json", "plan.json"]);
    expect(malformed.exitCode).toBe(1);
    expect(malformed.stderr).toContain("not a valid app map");
    // A plan author who pasted both snapshot keys must learn why it was not read as a plan.
    expect(malformed.stderr).toContain(
      'read as an app map because it has both "layers" and "permissions"',
    );
    expect(malformed.stderr).toContain("a plan must not have those keys");
    const legacy = yield* run(["diff", "plan.json", "legacy-map.json"]);
    expect(legacy.exitCode).toBe(1);
    expect(legacy.stderr).toContain('["modules"][0]["operations"][0]["transactional"]');
    expect(legacy.stderr).toContain('["modules"][0]["operations"][0]["needsApproval"]');
    expect(legacy.stderr).toContain("Regenerate a snapshot with the app's map script");
  }),
);

it.effect("wrong arguments print usage and exit 2", () =>
  Effect.gen(function* () {
    for (const args of [
      [],
      ["view"],
      ["diff", "plan.json"],
      ["view", "plan.json", "-o"],
      ["view", "plan.json", "plan.json", "--text"],
      ["x"],
      ["validate"],
      ["validate", "plan.json", "broken.json"],
      ["validate", "plan.json", "--text"],
      ["validate", "plan.json", "-o", "out.html"],
    ])
      expect((yield* run(args)).exitCode).toBe(2);
    expect((yield* run(["view", "plan.json", "--bogus"])).stderr).toContain(
      "Unknown option --bogus",
    );
    expect((yield* run(["--help"])).exitCode).toBe(0);
  }),
);

import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  diffMaps,
  type Plan,
  Plan as PlanSchema,
  planCommand,
  renderMap,
  renderMapDiff,
  validatePlan,
} from "../../index.ts";

const chain: Plan = {
  modules: [
    {
      name: "delivery",
      service: "test/Delivery",
      kind: "package",
      role: "process",
      package: "@app/delivery",
      operations: [{ name: "Delivery.send", permission: null, edges: ["Email.send"] }],
    },
    {
      name: "email",
      service: "test/Email",
      kind: "package",
      package: "@house-rules/email",
      operations: [{ name: "Email.send", permission: null }],
    },
  ],
  features: [],
  ways: [],
};

it.effect("plans decode explicit roles and default absent roles to capability in the map", () =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(PlanSchema)(chain);
    expect(decoded.modules.map((module) => module.role)).toEqual(["process", undefined]);
    const snapshot = yield* validatePlan(decoded);
    expect(snapshot.modules.map((module) => [module.name, module.role])).toEqual([
      ["delivery", "process"],
      ["email", "capability"],
    ]);
    const explicit = {
      ...chain,
      modules: chain.modules.map((module) =>
        module.name === "email" ? { ...module, role: "capability" as const } : module,
      ),
    };
    expect(yield* Schema.decodeUnknownEffect(PlanSchema)(explicit)).toEqual(explicit);
    const error = yield* Schema.decodeUnknownEffect(PlanSchema)({
      ...chain,
      modules: chain.modules.map((module) => ({ ...module, role: "worker" })),
    }).pipe(Effect.flip);
    expect(error.message).toContain('["modules"][0]["role"]');
  }),
);

it.effect.each([undefined, "capability"] as const)(
  "capability role %s rejects plain and system edges to a process with the edge path",
  (role) =>
    Effect.gen(function* () {
      for (const edge of ["Email.send", { target: "Email.send", reason: "send email" }]) {
        const invalid: Plan = {
          ...chain,
          modules: chain.modules.map(({ role: _role, ...module }) => ({
            ...module,
            ...(module.name === "email"
              ? { role: "process" as const }
              : role === undefined
                ? {}
                : { role }),
            operations:
              module.name === "email"
                ? [{ name: "Email.send", permission: null }]
                : [{ name: "Delivery.send", permission: null, edges: [edge] }],
          })),
        };
        const error = yield* validatePlan(invalid).pipe(Effect.flip);
        expect(error.issues).toEqual([
          {
            path: "modules[0].operations[0].edges[0]",
            reason:
              "Capability module delivery cannot call process module email: Delivery.send → Email.send",
          },
        ]);
      }
    }),
);

it.effect("processes can call capabilities and other processes, but cycles still fail", () =>
  Effect.gen(function* () {
    const value: Plan = {
      ...chain,
      modules: [
        {
          name: "notify",
          service: "test/Notify",
          kind: "package",
          role: "process",
          operations: [{ name: "Notify.send", permission: null, edges: ["Delivery.send"] }],
        },
        ...chain.modules,
      ],
    };
    const snapshot = yield* validatePlan(value);
    expect(
      snapshot.modules.find((module) => module.name === "notify")?.operations[0]?.edges,
    ).toEqual([{ target: "Delivery.send", kind: "operation" }]);
    const cyclic: Plan = {
      ...value,
      modules: value.modules.map((module) =>
        module.name === "delivery"
          ? {
              ...module,
              operations: [{ name: "Delivery.send", permission: null, edges: ["Notify.send"] }],
            }
          : module,
      ),
    };
    const error = yield* validatePlan(cyclic).pipe(Effect.flip);
    expect(error.issues).toEqual([
      { path: "modules[0].operations[0]", reason: "Cycle at Notify.send" },
    ]);
  }),
);

it.effect("text, HTML and Mermaid group process modules with their real edges and owners", () =>
  Effect.gen(function* () {
    const snapshot = yield* validatePlan(chain);
    const text = renderMap(snapshot, "text");
    expect(text).toContain("\nMODULES\n email  package [framework]");
    expect(text).toContain("\nPROCESS MODULES\n delivery  package [app-owned]");
    expect(text).toContain("  Delivery.send → Email.send\n");
    expect(text).toContain("  called by: Delivery.send\n");
    const html = renderMap(snapshot, "html");
    const process = html.slice(html.indexOf('<h3 class="group">Process modules</h3>'));
    expect(process).toContain('id="m0-name">delivery');
    expect(process).toContain('href="#o1">Email.send</a>');
    expect(process).not.toContain('id="m1-name">email');
    expect(html).toContain(">app-owned</span>");
    expect(html).toContain(">framework</span>");
    const mermaid = renderMap(snapshot, "mermaid");
    expect(mermaid).toContain(
      'subgraph g1["Process modules"]\n    subgraph m0["delivery (package, app-owned)"]',
    );
    expect(mermaid).toContain(
      'subgraph g0["Modules"]\n    subgraph m1["email (package, framework)"]',
    );
    expect(mermaid).toContain("n0 --> n1");
  }),
);

it.effect("role changes survive snapshot JSON decoding and appear in text and HTML diffs", () =>
  Effect.gen(function* () {
    const after = yield* validatePlan(chain);
    const before = {
      ...after,
      modules: after.modules.map((module) => ({ ...module, role: "capability" as const })),
    };
    const diff = diffMaps(before, after);
    expect(diff.modules.changed).toEqual([
      {
        name: "delivery",
        fields: [{ field: "role", before: "capability", after: "process" }],
      },
    ]);
    expect(renderMapDiff(diff, "text")).toContain("role: capability → process");
    const html = renderMapDiff(diff, "html");
    expect(html).toContain("Process modules");
    expect(html).toContain('<section class="module is-changed" id="m0"');
    expect(html).toContain(
      '<td>role</td><td class="old">capability</td><td class="new">process</td>',
    );
    const result = yield* planCommand(["diff", "before", "after", "--text"], (file) =>
      Promise.resolve(renderMap(file === "before" ? before : after, "json")),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("role: capability → process");
    const legacy = {
      ...before,
      modules: before.modules.map(({ role: _role, ...module }) => module),
    };
    expect(diffMaps(legacy, before).empty).toBe(true);
  }),
);

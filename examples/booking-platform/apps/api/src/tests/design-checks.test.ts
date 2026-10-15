import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { Effect, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const repoRoot = `${import.meta.dirname}/../../../../../..`;
const probeFile = "examples/booking-platform/apps/api/src/delivery/web/design-probe.tsx";

const Finding = Schema.Struct({ ruleId: Schema.NullOr(Schema.String), message: Schema.String });
const LintResults = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ messages: Schema.Array(Finding) })),
);

const eslintOutput = (source: string) =>
  Effect.gen(function* runEslint() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const command = ChildProcess.make(
      "node",
      [
        `${repoRoot}/node_modules/eslint/bin/eslint.js`,
        "--stdin",
        "--stdin-filename",
        probeFile,
        "--format",
        "json",
      ],
      { cwd: repoRoot, stdin: Stream.make(new TextEncoder().encode(source)) },
    );
    return yield* spawner.string(command);
  });

const lint = (source: string) =>
  eslintOutput(source).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(LintResults)),
    Effect.map((results) => results.flatMap((result) => result.messages)),
  );

it.effect(
  "ESLint checks the page with shadcn and reads the Button's sizes",
  () =>
    Effect.gen(function* designChecks() {
      const findings = yield* lint(
        [
          'import { Button } from "./components/ui/button.js";',
          "export const Probe = () => (",
          "  <div>",
          '    <button type="button">raw</button>',
          '    <Button className="px-8">padded</Button>',
          '    <p className="text-red-500">red</p>',
          "  </div>",
          ");",
          "",
        ].join("\n"),
      );
      const rules = findings.map((finding) => finding.ruleId);
      expect(rules).toContain("house-rules/design-no-raw-element");
      expect(rules).toContain("shadcn/no-raw-colors");
      // The plugin drops this hint only when neither oxc-parser nor @typescript-eslint/parser loads.
      const restyle = findings.find((finding) => finding.ruleId === "shadcn/no-restyle");
      expect(restyle?.message).toContain("Use a size (default");
    }).pipe(Effect.provide(NodeServices.layer)),
  60_000,
);

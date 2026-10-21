import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

it.live(
  "built Node Host fails MCP closed, shuts down, and refuses production demo JWT",
  () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const child = yield* spawner.spawn(
        ChildProcess.make(process.execPath, ["scripts/host-smoke.mjs"], {
          stdout: "inherit",
          stderr: "inherit",
        }),
      );
      assert.strictEqual(Number(yield* child.exitCode), 0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  30_000,
);

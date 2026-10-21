import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Config, Effect, Layer, Redacted } from "effect";
import { databaseTesting } from "../composition/tests/database.ts";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

for (const storage of ["memory", "postgres"] as const)
  it.live(
    storage === "memory"
      ? "built Node Host fails MCP closed, shuts down, and refuses production demo JWT"
      : "postgres: built Node Host fails MCP closed, shuts down, and refuses production demo JWT",
    () =>
      Effect.gen(function* () {
        const url =
          storage === "postgres"
            ? yield* Config.Redacted("DATABASE_URL").pipe(
                Effect.provideContext(yield* Layer.build(databaseTesting)),
                Effect.map(Redacted.value),
              )
            : "";
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const child = yield* spawner.spawn(
          ChildProcess.make(process.execPath, ["scripts/host-smoke.mjs"], {
            env: { STORAGE: storage, DATABASE_URL: url },
            extendEnv: true,
            stdout: "inherit",
            stderr: "inherit",
          }),
        );
        assert.strictEqual(Number(yield* child.exitCode), 0);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    30_000,
  );

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { registryMarkdown } from "../registry.ts";
it.effect("REGISTRY.md matches pure output without rewriting", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    assert.strictEqual(
      yield* fs.readFileString(new URL("../../../REGISTRY.md", import.meta.url).pathname),
      registryMarkdown(),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { registry } from "@house-rules/application";
import { createApp } from "../composition/index.ts";
import { webWay } from "../ways-in/web/way.ts";
import { partnerWay } from "../ways-in/partner/way.ts";
import { mcpWay } from "../ways-in/mcp/way.ts";
import { firstSignInWay } from "../ways-in/hooks/first-sign-in.ts";
import { nightlyCleanupWay } from "../ways-in/schedules/nightly-cleanup.ts";
import { registryMarkdown } from "../../scripts/registry.ts";

it.effect("snapshots every actual way exposure by descriptor identity", () =>
  Effect.gen(function* () {
    const ways = [webWay, partnerWay, mcpWay, firstSignInWay, nightlyCleanupWay];
    const app = createApp(ways);
    try {
      const snapshot = yield* registry(app);
      assert.strictEqual(snapshot.ways.length, ways.length);
      for (const way of ways) {
        const actual = snapshot.ways.find((entry) => entry.name === way.name);
        assert.isDefined(actual);
        assert.strictEqual(actual.protocol, way.protocol);
        assert.strictEqual(actual.features.length, way.features.length);
        way.features.forEach((feature, index) =>
          assert.strictEqual(actual.features[index], feature),
        );
      }
    } finally {
      yield* Effect.promise(() => app.dispose());
    }
  }),
);
it.effect("REGISTRY.md matches pure output without rewriting", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    assert.strictEqual(
      yield* fs.readFileString(new URL("../../REGISTRY.md", import.meta.url).pathname),
      yield* registryMarkdown,
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderMap } from "@house-rules/application";
import { mapSnapshot } from "../../scripts/map.ts";
import { mapSources } from "../../scripts/map-sources.ts";

it.effect("app map renders twice byte-identically and ignores input order", () =>
  Effect.gen(function* () {
    const snapshot = yield* mapSnapshot;
    const again = yield* mapSnapshot;
    const reverse = {
      ...snapshot,
      modules: [...snapshot.modules].reverse().map((module) => ({
        ...module,
        operations: [...module.operations]
          .reverse()
          .map((operation) => ({ ...operation, edges: [...operation.edges].reverse() })),
      })),
      features: [...snapshot.features].reverse().map((feature) => ({
        ...feature,
        edges: [...feature.edges].reverse(),
        ways: [...feature.ways].reverse(),
        closures: {
          person: [...feature.closures.person].reverse(),
          system: [...feature.closures.system].reverse(),
        },
      })),
      ways: [...snapshot.ways].reverse().map((way) => ({
        ...way,
        features: [...way.features].reverse(),
        public: [...way.public].reverse(),
      })),
      permissions: [...snapshot.permissions]
        .reverse()
        .map((permission) => ({ ...permission, operations: [...permission.operations].reverse() })),
    };
    for (const format of ["text", "json", "mermaid"] as const) {
      assert.strictEqual(renderMap(snapshot, format), renderMap(again, format));
      assert.strictEqual(renderMap(snapshot, format), renderMap(reverse, format));
    }
    assert.deepStrictEqual(JSON.parse(renderMap(snapshot, "json")), snapshot);
    assert.strictEqual(
      snapshot.modules.find((module) => module.name === "billing")?.package,
      "@example/billing",
    );
    assert.strictEqual(
      snapshot.modules.find((module) => module.name === "my-bookings")?.kind,
      "read-model",
    );
    assert.strictEqual(
      snapshot.features.find((feature) => feature.name === "make_booking")?.path,
      "src/features/make-booking/index.ts",
    );
    assert.deepStrictEqual(snapshot.ways.find((way) => way.name === "web")?.public, [
      "sign_in",
      "sign_up",
    ]);
    assert.include(renderMap(snapshot, "text"), "⚙ Party.assignRole");
    const text = renderMap(snapshot, "text");
    assert.notInclude(text, "inherited system");
    assert.include(text, "  └─ show_booking");
    assert.include(text, "      └─ Bookings.get");
    assert.include(text, "  │   └─ MyStuff.myBookings");
    assert.isTrue(text.split("\n").every((line) => line.length <= 100));
    assert.match(text, /\n {7}Party\./);
    assert.match(text, /\n {13}\w/);
    assert.match(text, /\n {14}Party\./);
  }),
);
it.effect("map ignores production postgres process config without DATABASE_URL", () =>
  Effect.gen(function* () {
    const baseline = renderMap(yield* mapSnapshot, "json");
    const keys = ["STORAGE", "NODE_ENV", "DATABASE_URL"] as const;
    const saved = keys.map((key) => [key, process.env[key]] as const);
    try {
      process.env.STORAGE = "postgres";
      process.env.NODE_ENV = "production";
      delete process.env.DATABASE_URL;
      assert.strictEqual(renderMap(yield* mapSnapshot, "json"), baseline);
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }),
);
it.effect("MAP.md matches the app map without rewriting", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const expected = `# App map\n\n\`\`\`text\n${renderMap(yield* mapSnapshot, "text")}\`\`\`\n`;
    assert.strictEqual(
      yield* fs.readFileString(new URL("../../MAP.md", import.meta.url).pathname),
      expected,
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);
it.effect("app map source lookup fails closed for missing source facts", () =>
  Effect.gen(function* () {
    const snapshot = yield* mapSnapshot;
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped();
    const exit = yield* Effect.exit(
      Effect.tryPromise(() => mapSources(snapshot, directory, directory)),
    );
    assert.strictEqual(exit._tag, "Failure");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

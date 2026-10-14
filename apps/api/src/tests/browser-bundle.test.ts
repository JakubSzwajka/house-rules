import { createRequire } from "node:module";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { build } from "esbuild";

const root = `${import.meta.dirname}/../..`;

const bundle = (contents: string) =>
  Effect.promise(() =>
    build({
      stdin: { contents, resolveDir: root, loader: "ts" },
      bundle: true,
      platform: "browser",
      format: "esm",
      write: false,
      metafile: true,
      logLevel: "silent",
    }),
  ).pipe(
    // Only modules with bytes in the output ship. effect's own barrel parses more than it keeps.
    Effect.map((result) =>
      Object.values(result.metafile.outputs).flatMap((output) =>
        Object.entries(output.inputs).flatMap(([input, { bytesInOutput }]) =>
          bytesInOutput > 0 ? [input] : [],
        ),
      ),
    ),
  );

const server =
  /(?:\/adapters\/|\/facade\.ts|\/storage\.ts|@effect\/sql|\/node_modules\/pg\/|\/(?:unstable\/)?sql\/|^node:|\/src\/index\.ts$)/u;

it.effect(
  "the contract entries and the SPA client bundle for the browser with no server code",
  () =>
    Effect.gen(function* browserSafe() {
      const inputs = yield* bundle(
        [
          'export * from "@hosti/bookings/contract";',
          'export { toHttpClient, endpoint } from "@house-rules/application/contract";',
          'export { Actor, ActorId, UnitOfWorkFailed } from "@house-rules/domain/contract";',
          'export { bookingClient } from "./src/delivery/web/booking-client.ts";',
        ].join("\n"),
      );
      expect(inputs.some((input) => input.endsWith("bookings/src/booking/show-booking.ts"))).toBe(
        true,
      );
      expect(inputs.filter((input) => server.test(input))).toEqual([]);
    }),
);

type Rule = Readonly<{ name: string; to: Readonly<{ pathNot: ReadonlyArray<string> }> }>;

const require = createRequire(import.meta.url);

const serverEffectModule = (file: string) =>
  /^(?:internal|(?!http\/)[^/]+\/)/u.test(file.replace(/^unstable\//u, ""));

it.each(["", "unstable/"])(
  "the %sEffect browser filter rejects every non-http folder",
  (prefix) => {
    for (const file of [
      "sql/SqlClient.js",
      "process/ChildProcess.js",
      "cluster/Entity.js",
      "socket/Socket.js",
      "internal/schema.js",
    ]) {
      expect(serverEffectModule(`${prefix}${file}`)).toBe(true);
    }
    for (const file of ["index.js", "Schema.js", "http/HttpClient.js"]) {
      expect(serverEffectModule(`${prefix}${file}`)).toBe(false);
    }
  },
);

const effectModules = Effect.gen(function* effectModulesOf() {
  const manifest = require("effect/package.json") as { exports: Record<string, unknown> };
  const entries = Object.keys(manifest.exports).filter(
    (key) => key === "." || (key !== "./index" && /^\.\/[a-z-]+$/u.test(key)),
  );
  const result = yield* Effect.promise(() =>
    build({
      stdin: {
        contents: entries
          .map((key, index) => `export * as e${index} from "effect${key.slice(1)}";`)
          .join("\n"),
        resolveDir: root,
        loader: "ts",
      },
      absWorkingDir: root,
      bundle: true,
      platform: "neutral",
      // Only the graph matters here. effect/testing imports node:assert, and it is not on the list.
      external: ["node:*"],
      write: false,
      metafile: true,
      logLevel: "silent",
    }),
  );
  return Object.keys(result.metafile.inputs).filter((input) => input.includes("/effect/dist/"));
});

it.effect(
  "every effect module contract-entry-is-browser-safe trusts ships no SQL or process code",
  () =>
    Effect.gen(function* effectAllowlist() {
      const config = require(`${root}/../../.dependency-cruiser.cjs`) as {
        forbidden: ReadonlyArray<Rule>;
      };
      const safe = (
        config.forbidden.find((rule) => rule.name === "contract-entry-is-browser-safe")?.to
          .pathNot ?? []
      ).map((pattern) => new RegExp(pattern, "u"));
      const modules = yield* effectModules;
      const trusted = modules.filter((file) => safe.some((pattern) => pattern.test(file)));
      const inDist = (file: string) =>
        file.slice(file.indexOf("/effect/dist/") + "/effect/dist/".length);
      expect(trusted.map(inDist)).toContain("index.js");
      expect(trusted.map(inDist)).toContain("http/HttpClient.js");
      expect(modules.map(inDist)).toContain("sql/SqlClient.js");
      expect(trusted.map(inDist).filter(serverEffectModule)).toEqual([]);
      const inputs = yield* bundle(
        trusted.map((file, index) => `export * as m${index} from "${root}/${file}";`).join("\n"),
      );
      expect(inputs.filter((input) => /(?:^|\/)(?:sql|process)\/|^node:/u.test(input))).toEqual([]);
    }),
);

it.effect("the public entry, by contrast, pulls in the Postgres adapter", () =>
  Effect.gen(function* controlCase() {
    const inputs = yield* bundle('export { Booking } from "@hosti/bookings";');
    expect(inputs.some((input) => input.includes("adapters/postgres"))).toBe(true);
  }),
);

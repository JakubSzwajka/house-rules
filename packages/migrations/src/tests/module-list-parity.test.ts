import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, layer } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";
import { Migrations } from "../index.ts";
import { scratchApp } from "./scratch-app.ts";

const Cases = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      label: Schema.String,
      accepts: Schema.Boolean,
      cwd: Schema.optionalKey(Schema.String),
      runnerReason: Schema.optionalKey(Schema.String),
      files: Schema.Record(Schema.String, Schema.String),
      links: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
);
const caseCount = 76;

layer(NodeServices.layer)("shared workspace/package module-list fixtures", (it) => {
  for (let index = 0; index < caseCount; index += 1)
    it.effect(`runner parity case ${index + 1}`, () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const text = yield* fs.readFileString(
          path.resolve(
            import.meta.dirname,
            "../../../rules/tests/fixtures/migrations/module-list-parity.json",
          ),
        );
        const cases = yield* Schema.decodeEffect(Cases)(text);
        expect(cases).toHaveLength(caseCount);
        const item = cases[index];
        if (item === undefined) return yield* Effect.die("Shared parity case is missing.");
        const app = yield* scratchApp(item.files);
        const root = path.dirname(app.list);
        for (const [link, target] of Object.entries(item.links ?? {})) {
          yield* fs.makeDirectory(path.dirname(path.join(root, link)), { recursive: true });
          yield* fs.symlink(target, path.join(root, link));
        }
        const list = item.cwd ? path.join(root, item.cwd, "migrations.json") : app.list;
        if (item.accepts) {
          const modules = yield* Migrations.readModuleList(list);
          expect(modules.length).toBeGreaterThan(0);
        } else {
          const error = yield* Migrations.readModuleList(list).pipe(Effect.flip);
          expect(error._tag).toBe("MigrationFailed");
          expect(item.runnerReason).toBeDefined();
          expect(error.message, item.label).toContain(item.runnerReason);
        }
      }),
    );
});

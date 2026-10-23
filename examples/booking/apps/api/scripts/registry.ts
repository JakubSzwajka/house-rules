import { Effect } from "effect";
import { registry, renderRegistry } from "@house-rules/application";
import { snapshotApp } from "./snapshot-app.ts";

export const registryMarkdown = Effect.gen(function* () {
  const app = snapshotApp();
  return yield* registry(app).pipe(
    Effect.map(renderRegistry),
    Effect.ensuring(Effect.promise(() => app.dispose())),
  );
});

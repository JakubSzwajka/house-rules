import { appMap, planCommand, renderMap } from "@house-rules/application";
import { Effect } from "effect";
import { snapshotApp } from "./snapshot-app.ts";
import { appDirectory, rootDirectory, mapSources } from "./map-sources.ts";

export const mapSnapshot = Effect.gen(function* () {
  const app = snapshotApp();
  return yield* appMap(app).pipe(
    Effect.flatMap((snapshot) =>
      Effect.promise(() => mapSources(snapshot, appDirectory, rootDirectory)),
    ),
    Effect.ensuring(Effect.promise(() => app.dispose())),
  );
});

export { planCommand, renderMap };
export const mapText = mapSnapshot.pipe(Effect.map((snapshot) => renderMap(snapshot, "text")));

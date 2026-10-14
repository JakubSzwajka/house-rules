import { toFetchHandler, toOpenApi } from "@house-rules/application";
import { serve } from "@house-rules/node-host";
import { Config, Effect } from "effect";
import { bookingRoutes } from "./delivery/http/routes.js";
import { app } from "./composition/index.js";

const publicOrigin = await Effect.runPromise(
  Config.String("APP_ORIGIN").pipe(Config.withDefault("")),
);
export const api = toFetchHandler(app, {
  prefix: "/api",
  routes: bookingRoutes,
  ...(publicOrigin === "" ? {} : { origins: [publicOrigin] }),
});

export const openApi = toOpenApi(bookingRoutes, {
  title: "Hosti API",
  version: "0.0.0",
  prefix: "/api",
  views: app.views,
});

if (import.meta.main) {
  await Effect.runPromise(
    Effect.gen(function* () {
      const port = yield* Config.Number("PORT").pipe(Config.withDefault(3000));
      return yield* Effect.promise(() =>
        serve(api, {
          port,
          onClose: () => api.dispose().then(() => app.dispose()),
          handleSignals: true,
        }),
      );
    }),
  );
}

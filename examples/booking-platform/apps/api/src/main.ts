import * as NodeServices from "@effect/platform-node/NodeServices";
import { toFetchHandler, toOpenApi } from "@house-rules/application";
import { Migrations } from "@house-rules/migrations";
import { serve } from "@house-rules/node-host";
import { Config, Effect, Layer, Option } from "effect";
import { databaseUrl, postgresClient } from "./composition/app-layer.js";
import { app } from "./composition/index.js";
import { bookingRoutes } from "./delivery/http/routes.js";
import { mcpAuthConfig, mcpPath } from "./delivery/mcp/config.js";
import { metadataHandler, metadataPaths } from "./delivery/mcp/metadata.js";
import { mcpRoute } from "./delivery/mcp/route.js";

const publicOrigin = await Effect.runPromise(
  Config.String("APP_ORIGIN").pipe(Config.withDefault("")),
);
const mcpAuth = await Effect.runPromise(mcpAuthConfig);

export const api = toFetchHandler(app, {
  prefix: "/api",
  routes: bookingRoutes,
  ...(publicOrigin === "" ? {} : { origins: [publicOrigin] }),
});

export const mcp = mcpRoute(app, mcpAuth);

const metadata = metadataHandler(mcpAuth);

export const handler = Object.assign(
  (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === mcpPath) return mcp(request);
    if (metadataPaths.includes(path)) return metadata(request);
    return api(request);
  },
  { dispose: () => Promise.all([mcp.dispose(), api.dispose()]).then(() => undefined) },
);

export const openApi = toOpenApi(bookingRoutes, {
  title: "Hosti API",
  version: "0.0.0",
  prefix: "/api",
  views: app.views,
});

const moduleList = new URL("../../../../../migrations.json", import.meta.url).pathname;

if (import.meta.main) {
  await Effect.runPromise(
    Effect.gen(function* () {
      // With a database, every module's migrations run before the first request.
      const database = yield* databaseUrl;
      if (Option.isSome(database)) {
        yield* Migrations.script(moduleList).pipe(
          Effect.provide(Layer.merge(postgresClient(database.value), NodeServices.layer)),
        );
      }
      const port = yield* Config.Number("PORT").pipe(Config.withDefault(3000));
      return yield* Effect.promise(() =>
        serve(handler, {
          port,
          onClose: () => handler.dispose().then(() => app.dispose()),
          handleSignals: true,
        }),
      );
    }),
  );
}

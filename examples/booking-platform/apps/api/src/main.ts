import * as NodeServices from "@effect/platform-node/NodeServices";
import { toFetchHandler, toOpenApi } from "@house-rules/application";
import { Migrations } from "@house-rules/migrations";
import { serve } from "@house-rules/node-host";
import { Config, Effect, Layer, Option } from "effect";
import { databaseUrl, postgresClient } from "./composition/app-layer.js";
import { visitorCaller } from "./composition/callers.js";
import { app } from "./composition/index.js";
import { authConfig } from "./composition/sign-in.js";
import { bookingRoutes, memberRoutes } from "./delivery/http/routes.js";
import { mcpPath, mcpResource } from "./delivery/mcp/config.js";
import { mcpRoute } from "./delivery/mcp/route.js";

const publicOrigin = await Effect.runPromise(
  Config.String("APP_ORIGIN").pipe(Config.withDefault("")),
);
const auth = await Effect.runPromise(authConfig);
const resource = await Effect.runPromise(mcpResource);
const origins = publicOrigin === "" ? {} : { origins: [publicOrigin] };

export const api = Option.isSome(auth)
  ? toFetchHandler(app, { prefix: "/api", routes: memberRoutes, ...origins })
  : toFetchHandler(app, {
      prefix: "/api",
      routes: bookingRoutes,
      caller: visitorCaller,
      ...origins,
    });

export const mcp = mcpRoute(app, resource);

export const handler = Object.assign(
  (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === mcpPath) return mcp(request);
    if (resource.paths.includes(path)) return resource.handler(request);
    return api(request);
  },
  { dispose: () => Promise.all([mcp.dispose(), api.dispose()]).then(() => undefined) },
);

export const openApi = toOpenApi(memberRoutes, {
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

import * as NodeServices from "@effect/platform-node/NodeServices";
import { toFetchHandler, toOpenApi } from "@house-rules/application";
import { Migrations } from "@house-rules/migrations";
import { serve, staticFiles } from "@house-rules/node-host";
import { Config, Effect, FileSystem, Layer, Option } from "effect";
import { databaseUrl, postgresClient } from "./composition/app-layer.js";
import { visitorCaller } from "./composition/callers.js";
import { app } from "./composition/index.js";
import { callNotes } from "./composition/request-log.js";
import { signInConfig } from "./composition/sign-in.js";
import { logRequests } from "./delivery/http/access-log.js";
import { devApi } from "./delivery/http/api.js";
import { devRoutes, memberRoutes, visitorRoutes } from "./delivery/http/routes.js";
import { mcpPath, mcpResource } from "./delivery/mcp/config.js";
import { mcpRoute } from "./delivery/mcp/route.js";

const publicOrigin = await Effect.runPromise(
  Config.String("APP_ORIGIN").pipe(Config.withDefault("")),
);
const signIn = await Effect.runPromise(signInConfig);
const resource = await Effect.runPromise(mcpResource);
const origins = publicOrigin === "" ? {} : { origins: [publicOrigin] };

const builtPage = new URL("./web", import.meta.url).pathname;
const webRoot = await Effect.runPromise(
  Effect.gen(function* findPage() {
    const configured = yield* Config.String("WEB_ROOT").pipe(Config.withDefault(""));
    if (configured !== "") return Option.some(configured);
    const exists = yield* (yield* FileSystem.FileSystem).exists(builtPage);
    return exists ? Option.some(builtPage) : Option.none<string>();
  }).pipe(Effect.provide(NodeServices.layer)),
);

const page = Option.map(webRoot, (root) =>
  staticFiles({ root, exclude: ["/api", mcpPath, "/.well-known"] }),
);

export const web =
  signIn.kind === "visitor"
    ? toFetchHandler(app, { routes: visitorRoutes, caller: visitorCaller, ...origins })
    : toFetchHandler(app, { routes: memberRoutes, ...origins });

export const devSignIn = toFetchHandler(app, {
  routes: devRoutes,
  caller: visitorCaller,
  ...origins,
});

export const mcp = mcpRoute(app, resource);

const devPrefix = `${devApi.prefix}/`;

const apiHandler = (request: Request): Promise<Response> => {
  const path = new URL(request.url).pathname;
  if (path === mcpPath) return mcp(request);
  if (resource.paths.includes(path)) return resource.handler(request);
  if (path.startsWith(devPrefix)) return devSignIn(request);
  return web(request);
};

export const handler = Object.assign(
  Option.match(page, {
    onNone: () => apiHandler,
    onSome:
      (site) =>
      (request: Request): Promise<Response> =>
        site(request).then((response) => response ?? apiHandler(request)),
  }),
  {
    dispose: () =>
      Promise.all([mcp.dispose(), web.dispose(), devSignIn.dispose()]).then(() => undefined),
  },
);

export const openApi = toOpenApi(memberRoutes, {
  title: "Booking example API",
  version: "0.0.0",
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
      const served = Option.match(webRoot, {
        onNone: () => "API only",
        onSome: (root) => `page from ${root}`,
      });
      yield* Effect.logInfo(`API on http://localhost:${port}, sign-in: ${signIn.kind}, ${served}`);
      const logged = logRequests(handler, callNotes);
      const run = Effect.runPromiseWith(yield* Effect.context<never>());
      return yield* Effect.promise(() =>
        serve((request) => run(logged(request)), {
          port,
          onClose: () => handler.dispose().then(() => app.dispose()),
          handleSignals: true,
        }),
      );
    }),
  );
}

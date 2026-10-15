import * as NodeServices from "@effect/platform-node/NodeServices";
import { toFetchHandler, toOpenApi } from "@house-rules/application";
import { Migrations } from "@house-rules/migrations";
import { serve, staticFiles } from "@house-rules/node-host";
import { Config, Effect, FileSystem, Layer, Option } from "effect";
import { databaseUrl, postgresClient } from "./composition/app-layer.js";
import { sessionCookie, visitorCaller } from "./composition/callers.js";
import { app } from "./composition/index.js";
import { callNotes } from "./composition/request-log.js";
import { signInConfig } from "./composition/sign-in.js";
import { logRequests } from "./delivery/http/access-log.js";
import { publicPaths } from "./delivery/http/api.js";
import { memberRoutes, publicRoutes } from "./delivery/http/routes.js";
import { mcpPath, mcpResource } from "./delivery/mcp/config.js";
import { mcpRoute } from "./delivery/mcp/route.js";

const publicOrigin = await Effect.runPromise(
  Config.String("APP_ORIGIN").pipe(Config.withDefault("")),
);
const signIn = await Effect.runPromise(
  Effect.tapError(signInConfig, (error) => Effect.logError(error.message)),
);
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

export const web = toFetchHandler(app, { routes: memberRoutes, ...origins });

export const accounts = toFetchHandler(app, {
  routes: publicRoutes,
  caller: visitorCaller,
  session: { cookie: sessionCookie },
  ...origins,
});

export const mcp = mcpRoute(app, resource);

const apiHandler = (request: Request): Promise<Response> => {
  const path = new URL(request.url).pathname;
  if (path === mcpPath) return mcp(request);
  if (resource.paths.includes(path)) return resource.handler(request);
  if (publicPaths.has(path)) return accounts(request);
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
      Promise.all([mcp.dispose(), web.dispose(), accounts.dispose()]).then(() => undefined),
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
      if (Option.isNone(signIn.accounts.signingKey)) {
        yield* Effect.logWarning(
          "ACCOUNTS_SIGNING_KEY is not set: sign-in uses a temporary key, so every token dies when this process stops. Development only.",
        );
      }
      const mcpIssuer = Option.match(signIn.mcp, {
        onNone: () => "off",
        onSome: ({ issuer }) => issuer,
      });
      yield* Effect.logInfo(
        `API on http://localhost:${port}, accounts issuer ${signIn.accounts.issuer}, MCP sign-in ${mcpIssuer}, ${served}`,
      );
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

import { mcpWho } from "./composition/callers.ts";
import { NodeRuntime } from "@effect/platform-node";
import { PgClient } from "@effect/sql-pg";
import { serve } from "@house-rules/node-host";
import { toFetchHandler } from "@house-rules/application";
import { Effect, Redacted } from "effect";
import {
  appConfig,
  createApp,
  resourceOf,
  mountMemoryModules,
  mountPostgresModules,
} from "./composition/index.ts";
import { webWay } from "./ways-in/web/way.ts";
import { partnerWay } from "./ways-in/partner/way.ts";
import { mcpWay } from "./ways-in/mcp/way.ts";
Effect.gen(function* () {
  const settings = yield* appConfig;
  const modules =
    settings.databaseUrl === ""
      ? mountMemoryModules()
      : mountPostgresModules(PgClient.layer({ url: Redacted.make(settings.databaseUrl) }));
  const resource = resourceOf(settings.appOrigin, settings.mcpIssuer);
  if (mcpWay.protocol !== "mcp") return yield* Effect.die("Expected MCP way");
  const app = createApp([webWay, partnerWay, { ...mcpWay, resource, who: mcpWho(resource) }], {
    modules,
    nodeEnv: settings.nodeEnv,
    issuer: settings.mcpIssuer,
  });
  const api = toFetchHandler(app);
  yield* app.runtime.contextEffect;
  yield* Effect.promise(() =>
    serve(api, {
      port: settings.port,
      handleSignals: true,
      onClose: () => api.dispose().then(() => app.dispose()),
    }),
  );
}).pipe(NodeRuntime.runMain);

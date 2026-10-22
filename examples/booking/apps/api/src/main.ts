import { mcpWho } from "./composition/callers.ts";
import * as NodePlatform from "@effect/platform-node";
import { serve, staticFiles } from "@house-rules/node-host";
import { toFetchHandler } from "@house-rules/application";
import { Effect } from "effect";
import { appConfig, createApp, resourceOf } from "./composition/index.ts";
import { webWay } from "./ways-in/web/way.ts";
import { partnerWay } from "./ways-in/partner/way.ts";
import { mcpWay } from "./ways-in/mcp/way.ts";
Effect.gen(function* () {
  const settings = yield* appConfig;
  const resource = resourceOf(settings.appOrigin, settings.mcpIssuer);
  if (webWay.protocol !== "http") return yield* Effect.die("Expected HTTP way");
  if (mcpWay.protocol !== "mcp") return yield* Effect.die("Expected MCP way");
  const app = createApp(
    [
      {
        ...webWay,
        origins: [
          ...new Set([
            settings.appOrigin || `http://localhost:${settings.port}`,
            "http://localhost:3000",
          ]),
        ],
      },
      partnerWay,
      { ...mcpWay, resource, who: mcpWho(resource) },
    ],
    {
      nodeEnv: settings.nodeEnv,
      issuer: settings.mcpIssuer,
    },
  );
  const api = toFetchHandler(app);
  yield* app.runtime.contextEffect;
  const site = staticFiles({
    root: new URL("./web", import.meta.url).pathname,
    exclude: ["/api", "/partner", "/mcp", "/.well-known"],
  });
  yield* Effect.promise(() =>
    serve((request) => site(request).then((response) => response ?? api(request)), {
      port: settings.port,
      handleSignals: true,
      onClose: () => api.dispose().then(() => app.dispose()),
    }),
  );
}).pipe(NodePlatform.NodeRuntime.runMain);

import { Effect } from "effect";
import { registry, renderRegistry } from "@house-rules/application";
import { createApp, appConfig, resourceOf } from "../src/composition/index.ts";
import { mcpWho } from "../src/composition/callers.ts";
import { webWay } from "../src/ways-in/web/way.ts";
import { partnerWay } from "../src/ways-in/partner/way.ts";
import { mcpWay } from "../src/ways-in/mcp/way.ts";

export const registryMarkdown = Effect.gen(function* () {
  const settings = yield* appConfig;
  const resource = resourceOf(settings.appOrigin, settings.mcpIssuer);
  if (mcpWay.protocol !== "mcp") return yield* Effect.die("Expected MCP way");
  const app = createApp([webWay, partnerWay, { ...mcpWay, resource, who: mcpWho(resource) }], {
    nodeEnv: settings.nodeEnv,
    issuer: settings.mcpIssuer,
  });
  return yield* registry(app).pipe(
    Effect.map(renderRegistry),
    Effect.ensuring(Effect.promise(() => app.dispose())),
  );
});

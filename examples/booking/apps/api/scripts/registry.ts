import { Effect } from "effect";
import { registry, renderRegistry } from "@house-rules/application";
import { createApp, appConfig, modulePlan } from "../src/composition/app.ts";
import { mcpWho, resourceOf } from "../src/composition/sign-in.ts";
import { webWay } from "../src/ways-in/web/way.ts";
import { partnerWay } from "../src/ways-in/partner/way.ts";
import { mcpWay } from "../src/ways-in/mcp/way.ts";
import { firstSignInWay } from "../src/ways-in/hooks/first-sign-in.ts";
import { nightlyCleanupWay } from "../src/ways-in/schedules/nightly-cleanup.ts";
import { TestClock } from "effect/testing";
import { Layer } from "effect";

export const registryMarkdown = Effect.gen(function* () {
  const settings = yield* appConfig;
  const resource = resourceOf(
    settings.appOrigin || `http://localhost:${settings.port}`,
    settings.signIn.mcpIssuer,
  );
  if (mcpWay.protocol !== "mcp") return yield* Effect.die("Expected MCP way");
  const plan = modulePlan({ settings });
  const app = createApp(
    [
      webWay,
      partnerWay,
      firstSignInWay,
      nightlyCleanupWay,
      { ...mcpWay, resource, who: mcpWho(resource) },
    ],
    {
      modules: { ...plan, layer: Layer.merge(plan.layer, TestClock.layer()) },
      settings,
    },
  );
  return yield* registry(app).pipe(
    Effect.map(renderRegistry),
    Effect.ensuring(Effect.promise(() => app.dispose())),
  );
});

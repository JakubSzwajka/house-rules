import { ConfigProvider, Layer, Logger } from "effect";
import { TestClock } from "effect/testing";
import { createApp, modulePlan } from "../src/composition/app.ts";
import { webWay } from "../src/ways-in/web/way.ts";
import { mcpWay } from "../src/ways-in/mcp/way.ts";
import { firstSignInWay } from "../src/ways-in/hooks/first-sign-in.ts";
import { nightlyCleanupWay } from "../src/ways-in/schedules/nightly-cleanup.ts";

const config = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    STORAGE: "memory",
    NODE_ENV: "test",
    PORT: "3000",
    APP_ORIGIN: "http://localhost:3000",
    ACCOUNTS_ISSUER: "https://accounts.invalid",
    ACCOUNTS_SIGNING_KEY: "",
    MCP_AUTH_ISSUER: "",
  }),
);

export const snapshotApp = () => {
  const plan = modulePlan({ identity: { providers: [] } });
  return createApp([webWay, mcpWay, firstSignInWay, nightlyCleanupWay], {
    modules: {
      ...plan,
      // ManagedRuntime cannot inherit the caller's ConfigProvider.
      layer: Layer.mergeAll(plan.layer, TestClock.layer(), Logger.layer([])).pipe(
        Layer.provideMerge(config),
      ),
    },
  });
};

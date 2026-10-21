import {
  composition,
  protectedResource,
  type WayOptions,
  type WhoSocket,
  type GatePolicy,
} from "@house-rules/application";
import { type ActorResolver, type FirstSignIn } from "@house-rules/identity";
import { Config, type Layer } from "effect";
import { Features, systemPermissions } from "../features/index.ts";
import { plugSockets } from "./app-layer.ts";
import { modulesLayer } from "./modules.ts";
import type { DemoIssuers } from "./demo-issuers.ts";
import type { McpAuthenticator } from "./mcp-authenticator.ts";
export const resourceOf = (appOrigin: string, issuer: string) =>
  issuer === ""
    ? protectedResource(undefined, "/mcp")
    : protectedResource({
        resource: `${new URL(appOrigin).origin}/mcp`,
        authorizationServers: [issuer],
        resourceName: "Booking",
      });
type WhoServices = DemoIssuers | McpAuthenticator | ActorResolver | FirstSignIn;
export type WayPlugs = {
  web: WhoSocket<WhoServices>;
  partner: WhoSocket<WhoServices>;
  mcp: WhoSocket<WhoServices>;
};
type AppWay =
  | Omit<Extract<WayOptions<WhoServices>, { protocol: "http" }>, "overrides">
  | Omit<Extract<WayOptions<WhoServices>, { protocol: "mcp" }>, "overrides">;
export type OpenWays = readonly AppWay[];
export const createApp = <E = never>(
  ways: OpenWays,
  options: {
    modules?: Parameters<typeof plugSockets<E>>[0];
    nodeEnv?: string;
    issuer?: string;
    gatePolicy?: GatePolicy;
  } = {},
) => {
  const layer = plugSockets<E | Layer.Error<ReturnType<typeof modulesLayer>>>(
    options.modules ?? modulesLayer(),
    ways,
    options.nodeEnv,
    options.issuer,
  );
  return composition({
    layer,
    features: Object.values(Features),
    ways,
    system: systemPermissions,
    ...(options.gatePolicy === undefined ? {} : { gatePolicy: options.gatePolicy }),
  });
};
export const appConfig = Config.all({
  mcpIssuer: Config.String("MCP_AUTH_ISSUER").pipe(Config.withDefault("")),
  nodeEnv: Config.String("NODE_ENV").pipe(Config.withDefault("development")),
  port: Config.Int("PORT").pipe(Config.withDefault(3000)),
  appOrigin: Config.String("APP_ORIGIN").pipe(Config.withDefault("http://localhost:3000")),
});
export { modulesLayer, readUnavailablePort } from "./modules.ts";
export { plugSockets } from "./app-layer.ts";
export { DemoIssuers, DemoForbidden } from "./demo-issuers.ts";
export { McpAuthenticator } from "./mcp-authenticator.ts";
export { Features, memberPermissions, systemPermissions } from "../features/index.ts";
export { scheduleFeatures } from "./schedule.ts";

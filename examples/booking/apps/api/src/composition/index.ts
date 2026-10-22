import {
  type Authenticator,
  composition,
  protectedResource,
  type WayOptions,
  type WhoSocket,
  type GatePolicy,
  type MaySocket,
} from "@house-rules/application";
import { type ActorResolver, type FirstSignIn } from "@house-rules/identity";
import { Config, Effect, Layer } from "effect";
import { Party } from "@house-rules/party";
import { Features } from "../features/index.ts";
import { systemPermissions } from "./roles.ts";
import { modulePlan } from "./modules.ts";
import { newLoginHook } from "./first-sign-in.ts";
import { DemoIssuers as DemoIssuerService } from "./demo-issuers.ts";
import { McpAuthenticator as McpAuthenticatorService } from "./mcp-authenticator.ts";
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
type WhoServices = Authenticator | DemoIssuers | McpAuthenticator | ActorResolver | FirstSignIn;
export type WayPlugs = {
  web: WhoSocket<WhoServices>;
  partner: WhoSocket<WhoServices>;
  mcp: WhoSocket<WhoServices>;
};
type AppWay =
  | Omit<Extract<WayOptions<WhoServices>, { protocol: "http" }>, "overrides">
  | Omit<Extract<WayOptions<WhoServices>, { protocol: "mcp" }>, "overrides">;
export type OpenWays = readonly AppWay[];
export const createApp = (
  ways: OpenWays,
  options: {
    modules?: ReturnType<typeof modulePlan>;
    nodeEnv?: string;
    issuer?: string;
    gatePolicy?: GatePolicy;
    may?: MaySocket;
  } = {},
) => {
  const plugs = Layer.merge(
    DemoIssuerService.layer(options.nodeEnv ?? "development"),
    McpAuthenticatorService.layer(options.issuer ?? ""),
  );
  const open = {
    afterRuntime: newLoginHook,
    features: Object.values(Features),
    ways,
    may: options.may === undefined ? Party.may() : Effect.succeed(options.may),
    system: systemPermissions,
    ...(options.gatePolicy === undefined ? {} : { gatePolicy: options.gatePolicy }),
  };
  const plan = options.modules ?? modulePlan();
  return composition({ ...open, modules: { ...plan, layer: Layer.merge(plan.layer, plugs) } });
};
export const appConfig = Config.all({
  mcpIssuer: Config.String("MCP_AUTH_ISSUER").pipe(Config.withDefault("")),
  nodeEnv: Config.String("NODE_ENV").pipe(Config.withDefault("development")),
  port: Config.Int("PORT").pipe(Config.withDefault(3000)),
  appOrigin: Config.String("APP_ORIGIN").pipe(Config.withDefault("http://localhost:3000")),
});
export { modulePlan } from "./modules.ts";
export { DemoIssuers, DemoForbidden } from "./demo-issuers.ts";
export { McpAuthenticator } from "./mcp-authenticator.ts";
export { Features } from "../features/index.ts";
export { builtInRoles, systemPermissions } from "./roles.ts";
export { scheduleFeatures } from "./schedule.ts";

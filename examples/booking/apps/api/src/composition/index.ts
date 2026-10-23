import {
  type Authenticator,
  composition,
  protectedResource,
  type AnyWay,
  type HookWay,
  type Principal,
  type Refused,
  type WhoSocket,
  type GatePolicy,
  type MaySocket,
} from "@house-rules/application";
import { type ActorResolver, type FirstSignIn, type DevLocalIssuers } from "@house-rules/identity";
import { Config, Effect } from "effect";
import { Party } from "@house-rules/party";
import { Features } from "../features/index.ts";
import { systemPermissions } from "./roles.ts";
import { modulePlan } from "./modules.ts";

export const resourceOf = (appOrigin: string, issuer: string) =>
  issuer === ""
    ? protectedResource(undefined, "/mcp")
    : protectedResource({
        resource: `${new URL(appOrigin).origin}/mcp`,
        authorizationServers: [issuer],
        resourceName: "Booking",
      });
type WhoServices = Authenticator | ActorResolver | FirstSignIn | DevLocalIssuers;
export type WayPlugs = {
  web: WhoSocket<WhoServices>;
  partner: WhoSocket<WhoServices>;
  mcp: WhoSocket<WhoServices>;
};
export type OpenWays = readonly (
  | Exclude<AnyWay<WhoServices>, { protocol: "hook" }>
  | HookWay<FirstSignIn, Principal, typeof Features.firstSignIn, Refused>
)[];
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
  const open = {
    features: Object.values(Features),
    ways,
    may: options.may === undefined ? Party.may() : Effect.succeed(options.may),
    system: systemPermissions,
    ...(options.gatePolicy === undefined ? {} : { gatePolicy: options.gatePolicy }),
  };
  const plan =
    options.modules ??
    modulePlan({
      ...(options.nodeEnv === undefined ? {} : { nodeEnv: options.nodeEnv }),
      ...(options.issuer === undefined ? {} : { issuer: options.issuer }),
    });
  return composition({ ...open, modules: plan });
};
export const appConfig = Config.all({
  mcpIssuer: Config.String("MCP_AUTH_ISSUER").pipe(Config.withDefault("")),
  nodeEnv: Config.String("NODE_ENV").pipe(Config.withDefault("development")),
  port: Config.Int("PORT").pipe(Config.withDefault(3000)),
  appOrigin: Config.String("APP_ORIGIN").pipe(Config.withDefault("http://localhost:3000")),
});
export { modulePlan } from "./modules.ts";
export { testIssuers } from "./callers.ts";
export { Features } from "../features/index.ts";
export { builtInRoles, systemPermissions } from "./roles.ts";

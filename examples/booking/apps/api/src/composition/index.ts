import {
  composition,
  protectedResource,
  type WayOptions,
  type WhoSocket,
  type GatePolicy,
  type MaySocket,
} from "@house-rules/application";
import { type ActorResolver, type FirstSignIn } from "@house-rules/identity";
import { Config, Context, Effect, Layer } from "effect";
import { Party, PartyUnavailable } from "@house-rules/party";
import { Features } from "../features/index.ts";
import { systemPermissions } from "./roles.ts";
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
    may?: MaySocket;
  } = {},
) => {
  let plug: Effect.Success<ReturnType<typeof Party.may>> | undefined;
  const may = {
    permissionsOf: (caller: Parameters<NonNullable<typeof plug>["permissionsOf"]>[0]) =>
      Effect.suspend(() =>
        plug === undefined
          ? Effect.fail(new PartyUnavailable({ cause: "Party May not acquired" }))
          : plug.permissionsOf(caller),
      ),
  };
  const layer = plugSockets<E | Layer.Error<ReturnType<typeof modulesLayer>>>(
    options.modules ?? modulesLayer(),
    ways,
    options.nodeEnv,
    options.issuer,
  ).pipe(
    Layer.tap((context) =>
      Party.may().pipe(
        Effect.provideContext(Context.make(Party, Context.get(context, Party))),
        Effect.tap((value) =>
          Effect.sync(() => {
            plug = value;
          }),
        ),
      ),
    ),
  );
  return composition({
    layer,
    features: Object.values(Features),
    ways,
    may: options.may ?? may,
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
export { Features } from "../features/index.ts";
export { builtInRoles, systemPermissions } from "./roles.ts";
export { scheduleFeatures } from "./schedule.ts";

import {
  type Authenticator,
  composition,
  type AnyWay,
  type HookWay,
  type Principal,
  type Refused,
  type MaySocket,
} from "@house-rules/application";
import {
  type ActorResolver,
  type FirstSignIn,
  type DevLocalIssuers,
  type IdentityOptions,
} from "@house-rules/identity";
import { Config, Effect } from "effect";
import { Features } from "../features/index.ts";
import { may, systemPermissions } from "./access.ts";
import { modulePlan as mountModules } from "./modules.ts";
import { identityOptions, signInConfig } from "./sign-in.ts";

export const appConfig = Config.all({
  nodeEnv: Config.String("NODE_ENV").pipe(Config.withDefault("development")),
  port: Config.Int("PORT").pipe(Config.withDefault(3000)),
  appOrigin: Config.String("APP_ORIGIN").pipe(Config.withDefault("")),
  signIn: signInConfig,
});
type AppSettings = Config.Success<typeof appConfig>;
export const modulePlan = (
  options: Omit<Parameters<typeof mountModules>[0], "identity"> & {
    settings?: AppSettings;
    nodeEnv?: string;
    issuer?: string;
    identity?: IdentityOptions;
  } = {},
) =>
  mountModules({
    ...options,
    identity:
      options.identity === undefined
        ? Effect.gen(function* () {
            const settings = options.settings ?? (yield* appConfig);
            return yield* identityOptions({
              ...settings,
              nodeEnv: options.nodeEnv ?? settings.nodeEnv,
              signIn: {
                ...settings.signIn,
                mcpIssuer: options.issuer ?? settings.signIn.mcpIssuer,
              },
            });
          })
        : Effect.succeed(options.identity),
  });
type WhoServices = Authenticator | ActorResolver | FirstSignIn | DevLocalIssuers;
export type OpenWays = readonly (
  | Exclude<AnyWay<WhoServices>, { protocol: "hook" }>
  | HookWay<FirstSignIn, Principal, typeof Features.firstSignIn, Refused>
)[];
export const createApp = (
  ways: OpenWays,
  options: {
    modules?: ReturnType<typeof modulePlan>;
    settings?: AppSettings;
    nodeEnv?: string;
    issuer?: string;
    may?: MaySocket;
  } = {},
) =>
  composition({
    modules: options.modules ?? modulePlan(options),
    features: Object.values(Features),
    ways,
    may: options.may === undefined ? may : Effect.succeed(options.may),
    system: systemPermissions,
  });

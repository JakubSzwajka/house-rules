import {
  Authenticator,
  Refused,
  type ProtectedResource,
  type WhoSocket,
} from "@house-rules/application";
import { Identity } from "@house-rules/identity";
import { Effect } from "effect";
import { DemoIssuers } from "./demo-issuers.ts";
import { McpAuthenticator } from "./mcp-authenticator.ts";
export const localWho = (way: "web" | "partner") =>
  ({
    resolve: (incoming) =>
      Effect.gen(function* () {
        const demo = yield* DemoIssuers;
        return yield* Identity.who({ token: "bearer" })
          .resolve(incoming)
          .pipe(Effect.provide(demo[way].layer));
      }),
  }) satisfies WhoSocket<
    | DemoIssuers
    | import("@house-rules/identity").ActorResolver
    | import("@house-rules/identity").FirstSignIn
  >;
export const mcpWho = (resource: ProtectedResource) =>
  ({
    resolve: (incoming) =>
      Effect.gen(function* () {
        if (!resource.configured)
          return yield* new Refused({
            status: 503,
            code: "not_configured",
            message: "MCP is not configured.",
          });
        const auth = yield* McpAuthenticator;
        return yield* Identity.who({
          token: "bearer",
          audience: resource.metadata.resource,
          challenge: resource.challenge,
        })
          .resolve(incoming)
          .pipe(Effect.provideService(Authenticator, auth));
      }),
  }) satisfies WhoSocket<
    | McpAuthenticator
    | import("@house-rules/identity").ActorResolver
    | import("@house-rules/identity").FirstSignIn
  >;

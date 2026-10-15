import { call, composition } from "@house-rules/application";
import { AuthJwtTesting } from "@house-rules/auth-jwt";
import { Effect, Option } from "effect";
import { memoryAppLayer } from "../../../composition/app-layer.js";
import { localSignIn } from "../../../composition/sign-in.js";
import { mcpCaller, memberPermissions, visitorCaller } from "../../../composition/callers.js";
import { webCaller } from "../../../composition/index.js";
import { signIn } from "../../../use-cases/accounts/sign-in.js";
import { signUp } from "../../../use-cases/accounts/sign-up.js";
import { bookingViews } from "../../../composition/views.js";
import { mcpResourceOf } from "../config.js";
import { mcpRoute } from "../route.js";

export const issuer = "https://id.example";
export const audience = "https://booking.example/mcp";
export const resource = mcpResourceOf("https://booking.example", issuer);

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export const incomingWith = (token: string) => ({
  headers: new Headers(bearer(token)),
  url: "https://booking.example",
});

const visitor = { headers: new Headers(), url: "https://booking.example" };

export const mcpMemberCaller = mcpCaller(resource, memberPermissions);

export const signedInApp = Effect.acquireRelease(
  Effect.gen(function* mount() {
    const keys = yield* AuthJwtTesting.keys;
    const app = composition({
      layer: memoryAppLayer({ ...localSignIn, mcp: Option.some({ issuer, jwks: keys.jwks }) }),
      caller: webCaller,
      views: bookingViews,
    });
    const mcp = mcpRoute(app, resource);
    return {
      app,
      mcp,
      noAudienceToken: (sub: string) => keys.sign({ iss: issuer, sub }),
      mcpToken: (sub: string) => keys.sign({ iss: issuer, sub, aud: audience }),
      // A token from the app's own sign-in: another issuer, so another identity.
      accountsToken: (email: string) =>
        Effect.gen(function* accountsToken() {
          const credentials = { email, password: "a long enough secret" };
          const options = { caller: visitorCaller };
          yield* Effect.promise(() =>
            call(app, signUp, { ...credentials, displayName: "Web" }, visitor, options),
          );
          const signedIn = yield* Effect.promise(() =>
            call(app, signIn, credentials, visitor, options),
          );
          if (!signedIn.ok) return yield* Effect.die("sign-in failed");
          return signedIn.value.token;
        }),
    };
  }),
  ({ app, mcp }) => Effect.promise(() => mcp.dispose().then(() => app.dispose())),
);

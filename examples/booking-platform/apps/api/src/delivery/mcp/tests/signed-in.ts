import { composition } from "@house-rules/application";
import { AuthJwtTesting } from "@house-rules/auth-jwt";
import { Effect, Option } from "effect";
import { memoryAppLayer } from "../../../composition/app-layer.js";
import { webCaller } from "../../../composition/index.js";
import { bookingViews } from "../../../composition/views.js";
import { mcpResourceOf } from "../config.js";
import { mcpRoute } from "../route.js";

export const issuer = "https://id.example";
export const audience = "https://hosti.example/mcp";
export const resource = mcpResourceOf("https://hosti.example", issuer);

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export const incomingWith = (token: string) => ({
  headers: new Headers(bearer(token)),
  url: "https://hosti.example",
});

export const signedInApp = Effect.acquireRelease(
  Effect.gen(function* mount() {
    const keys = yield* AuthJwtTesting.keys;
    const app = composition({
      layer: memoryAppLayer(Option.some({ issuer, jwks: keys.jwks })),
      caller: webCaller,
      views: bookingViews,
    });
    const mcp = mcpRoute(app, resource);
    return {
      app,
      mcp,
      webToken: (sub: string) => keys.sign({ iss: issuer, sub }),
      mcpToken: (sub: string) => keys.sign({ iss: issuer, sub, aud: audience }),
    };
  }),
  ({ app, mcp }) => Effect.promise(() => mcp.dispose().then(() => app.dispose())),
);

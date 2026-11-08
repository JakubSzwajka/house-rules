import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { AuthProvider } from "./auth-provider.ts";
import { credentialOf } from "./credential.ts";
import type { Principal } from "./principal.ts";

export const devTokens = (tokens: Readonly<Record<string, Principal>>) =>
  Layer.succeed(AuthProvider, {
    authenticate: (headers) =>
      Effect.succeed(
        Option.flatMap(credentialOf(headers, "__session"), (token) =>
          Option.fromNullishOr(Object.hasOwn(tokens, token) ? tokens[token] : undefined),
        ),
      ),
  });

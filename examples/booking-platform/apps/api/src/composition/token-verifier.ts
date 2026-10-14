import type { Actor } from "@house-rules/domain";
import { Context, Effect, Layer, type Option } from "effect";

export class TokenVerifier extends Context.Service<
  TokenVerifier,
  { readonly verify: (token: string, audience: string) => Effect.Effect<Option.Option<Actor>> }
>()("@example/api/TokenVerifier") {
  // No identity provider yet: every token is refused, so MCP fails closed until a real verifier fills this slot.
  static readonly none: Layer.Layer<TokenVerifier> = Layer.succeed(this, {
    verify: () => Effect.succeedNone,
  });
}

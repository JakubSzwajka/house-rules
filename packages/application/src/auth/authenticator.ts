import { Context, type Effect } from "effect";
import type { Principal } from "./principal.ts";
import type { TokenRejected } from "./token-rejected.ts";

export type VerifyOptions = Readonly<{ audience?: string }>;

export type AuthenticatorService = Readonly<{
  verify: (token: string, options?: VerifyOptions) => Effect.Effect<Principal, TokenRejected>;
}>;

export class Authenticator extends Context.Service<Authenticator, AuthenticatorService>()(
  "@house-rules/application/Authenticator",
) {}

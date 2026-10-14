import { Context, type Effect } from "effect";
import type { JSONWebKeySet } from "jose";

export type LocalClaims = Readonly<{ sub: string; name?: string; [claim: string]: unknown }>;

export type LocalIssuerService = Readonly<{
  issuer: string;
  audience?: string;
  jwks: JSONWebKeySet;
  issue: (claims: LocalClaims) => Effect.Effect<string>;
}>;

export class AuthJwtLocalIssuer extends Context.Service<AuthJwtLocalIssuer, LocalIssuerService>()(
  "@house-rules/auth-jwt/AuthJwtLocalIssuer",
) {}

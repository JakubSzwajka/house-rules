import type { JSONWebKeySet } from "jose";

export type AuthJwtOptions = Readonly<{
  issuer: string;
  audience?: string;
  jwksUrl?: string;
  clockTolerance?: number;
  jwks?: JSONWebKeySet;
  authorizedParties?: ReadonlyArray<string>;
  rejectPending?: boolean;
}>;

export type ClerkOptions = Readonly<{
  publishableKey: string;
  authorizedParties: ReadonlyArray<string>;
  rejectPending?: boolean;
  audience?: string;
  clockTolerance?: number;
  jwks?: JSONWebKeySet;
}>;

import type { JSONWebKeySet } from "jose";

export type AuthJwtOptions = Readonly<{
  issuer: string;
  audience?: string;
  jwksUrl?: string;
  clockTolerance?: number;
  jwks?: JSONWebKeySet;
}>;

export type ClerkOptions = Readonly<{
  publishableKey: string;
  audience?: string;
  clockTolerance?: number;
  jwks?: JSONWebKeySet;
}>;

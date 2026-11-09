import * as Option from "effect/Option";
import { type Claims, type Delegation, principalWithAgent, tokenProvider } from "./jwt.ts";

export interface ClerkOptions {
  readonly issuer: string;
  readonly jwtKey?: string;
  readonly authorizedParties?: ReadonlyArray<string>;
  readonly clockTolerance?: number;
  readonly agent?: (claims: Claims) => Delegation;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const organisationOf = (
  claims: Claims,
): { readonly id: string | undefined; readonly role: string | undefined } => {
  const o = claims["o"];
  if (typeof o === "object" && o !== null) {
    const nested = o as Record<string, unknown>;
    return { id: text(nested["id"]), role: text(nested["rol"]) };
  }
  return { id: text(claims["org_id"]), role: text(claims["org_role"]) };
};

const clerkRole = (role: string): string => (role.startsWith("org:") ? role : `org:${role}`);

export const clerk = (options: ClerkOptions) => {
  const issuer = options.issuer.replace(/\/+$/, "");
  return tokenProvider(
    {
      issuer,
      key:
        options.jwtKey === undefined
          ? { jwksUrl: `${issuer}/.well-known/jwks.json` }
          : { publicKey: options.jwtKey, algorithm: "RS256" },
      algorithms: ["RS256"],
      cookie: "__session",
      // Clerk's own backend allows 5 seconds of clock skew by default.
      clockTolerance: options.clockTolerance ?? 5,
    },
    (claims) => {
      const subject = text(claims.sub);
      if (subject === undefined || claims["sts"] === "pending") return Option.none();
      const azp = text(claims["azp"]);
      // Clerk treats an empty list as no check.
      const parties = options.authorizedParties ?? [];
      if (azp !== undefined && parties.length > 0 && !parties.includes(azp)) return Option.none();
      const organisation = organisationOf(claims);
      return principalWithAgent(
        {
          subject,
          orgId: organisation.id ?? null,
          roles:
            organisation.id === undefined || organisation.role === undefined
              ? []
              : [clerkRole(organisation.role)],
        },
        claims,
        options.agent,
      );
    },
  );
};

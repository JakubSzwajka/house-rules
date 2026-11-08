# Auth

`Session` is the RPC middleware every client-facing command lists. `SessionLive` asks the `AuthProvider` slot who is signed in, turns the principal's roles into permissions with `Roles`, and provides `CurrentActor`. No principal means `Unauthenticated` (401).

```ts
const Live = SessionLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      clerk({ issuer: "https://clerk.example.com", authorizedParties: ["https://app.example.com"] }),
      Roles.layer({ "org:admin": ["projects:write"], "org:member": [] }),
    ),
  ),
);
```

## Providers

Each reads the token from `Authorization: Bearer` or a cookie. A token that is missing, malformed, expired, early, signed by another key, for another issuer or audience, or with a refused algorithm means signed out. A key set that cannot be fetched also means signed out, logged with `Effect.logWarning`.

| Provider | Use |
| --- | --- |
| `clerk({ issuer, jwtKey?, authorizedParties?, clockTolerance? })` | Clerk session tokens, RS256. Keys from `${issuer}/.well-known/jwks.json`, or the PEM `jwtKey` without network. Cookie `__session`. Reads the organisation from v1 (`org_id`, `org_role`) and v2 (`o.id`, `o.rol`) tokens; the role becomes `org:<key>`. A pending session (`sts: "pending"`) and an `azp` outside `authorizedParties` are signed out. 5 seconds of clock skew, as Clerk's backend allows |
| `jwt({ key, issuer, audience?, cookie?, clockTolerance?, subject?, orgId?, roles? })` | any JWT issuer. `key` is `{ jwksUrl }`, `{ jwks }`, `{ publicKey, algorithm? }` (PEM, RS256 by default) or `{ secret }` (HS256). By default the subject is `sub`, there is no organisation and roles come from a `roles` claim |
| `devTokens({ token: principal })` | fixed tokens for tests and local play |

## Agents

An agent acts as its user. `DomainAi.toMcp(AppApi)` passes the MCP request's headers (its bearer token or cookie) to `Session`, so the agent gets exactly the person's permissions. There is no separate agent marker and no approval step.

Not built: MCP as an OAuth resource server (protected-resource metadata, the 401 `WWW-Authenticate` challenge, checking that the token's audience is this resource). Today an MCP client signs in with the same session token as the app's own clients, through whichever provider is plugged in.

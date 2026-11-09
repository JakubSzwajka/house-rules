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
| `clerk({ issuer, jwtKey?, authorizedParties?, clockTolerance?, agent? })` | Clerk session tokens, RS256. Keys from `${issuer}/.well-known/jwks.json`, or the PEM `jwtKey` without network. Cookie `__session`. Reads the organisation from v1 (`org_id`, `org_role`) and v2 (`o.id`, `o.rol`) tokens; the role becomes `org:<key>`. A pending session (`sts: "pending"`) and an `azp` outside `authorizedParties` are signed out. 5 seconds of clock skew, as Clerk's backend allows |
| `jwt({ key, issuer, audience?, cookie?, clockTolerance?, subject?, orgId?, roles?, agent? })` | any JWT issuer. `key` is `{ jwksUrl }`, `{ jwks }`, `{ publicKey, algorithm? }` (PEM, RS256 by default) or `{ secret }` (HS256). By default the subject is `sub`, there is no organisation and roles come from a `roles` claim |
| `devTokens({ token: principal })` | fixed tokens for tests and local play |

## Agents

An agent is its own party. It signs in with its own token, and `SessionLive` provides an `Agent` actor: its own id, a name, the person it works for (`forPerson`), the token's `orgId`, and permissions from its own roles through `Roles`. `authorOf` names the agent, so events say who acted; `actingFor(actor)` names the person, so an app can show "Claude · for Kuba". `DomainAi.toMcp(AppApi)` passes the MCP request's headers to `Session` unchanged.

A principal is an agent when it has `agent: { name, forPerson }`, and its `subject` is the agent's id:

```ts
devTokens({
  "kuba-token": { subject: "kuba", orgId: null, roles: ["owner"] },
  "claude-token": {
    subject: "claude",
    orgId: null,
    roles: ["agent"],
    agent: { name: "Claude", forPerson: "kuba" },
  },
});
```

`jwt` and `clerk` read an agent only through their `agent` option, a function from claims to `{ id, name, forPerson }` or `undefined`. Without it every token stays a person, as before. `agentFromAct` reads the RFC 8693 `act` claim: `act.sub` is the agent, `act.name` its name and `sub` the person. Do not use it with Clerk, whose `act` claim marks impersonation by a person.

`SessionLive` refuses (`Unauthenticated`) an agent whose id or `forPerson` starts with `system:`, is empty, or that acts for itself. Person and agent ids share one namespace, so an app must not give an agent a person's id. The stack has no approval step; an app gates an agent with its own rules.

Not built: MCP as an OAuth resource server (protected-resource metadata, the 401 `WWW-Authenticate` challenge, checking that the token's audience is this resource). Today an MCP client signs in with the same session token as the app's own clients, through whichever provider is plugged in.

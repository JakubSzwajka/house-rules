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
| `clerk({ issuer, jwtKey?, authorizedParties?, clockTolerance?, agent? })` | Clerk session tokens, RS256. Keys from `${issuer}/.well-known/jwks.json`, or the PEM `jwtKey` without network. Cookie `__session`. Reads the organisation from v1 (`org_id`, `org_role`) and v2 (`o.id`, `o.rol`) tokens; the role becomes `org:<key>`. A pending session (`sts: "pending"`), a token without `exp`, and, when `authorizedParties` is set, a token whose `azp` is missing or outside it are signed out. 5 seconds of clock skew, as Clerk's backend allows |
| `jwt({ key, issuer, audience?, cookie?, clockTolerance?, subject?, orgId?, roles?, agent? })` | any JWT issuer. `key` is `{ jwksUrl }`, `{ jwks }`, `{ publicKey, algorithm? }` (PEM, RS256 by default) or `{ secret }` (HS256). A token without `exp` is signed out. By default the subject is `sub`, there is no organisation and roles come from a `roles` claim |
| `devTokens({ token: principal })` | fixed tokens for tests and local play |

## Agents

An agent is its own party. It signs in with its own token, and `SessionLive` provides an `Agent` actor: its own id, a name, the person it works for (`forPerson`), the token's `orgId`, and permissions from its own roles through `Roles`. Its id starts with `agent:`, such as `agent:claude`. `attributionOf(actor)` gives the `by` and `for` an event records: `by` names the agent and `for` its person, so the history can show "Claude · for Kuba" after the request ends. `actingFor(actor)` names the person during the request. `DomainAi.toMcp(AppApi)` passes the MCP request's headers to `Session` unchanged.

A principal is an agent when it has `agent: { name, forPerson }`, and its `subject` is the agent's id:

```ts
devTokens({
  "kuba-token": { subject: "kuba", orgId: null, roles: ["owner"] },
  "claude-token": {
    subject: "agent:claude",
    orgId: null,
    roles: ["agent"],
    agent: { name: "Claude", forPerson: "kuba" },
  },
});
```

`jwt` and `clerk` read an agent only through their `agent` option, a function from claims to a `Delegation`: `{ _tag: "None" }` for a person, `{ _tag: "Agent", agent: { id, name, forPerson } }` for an agent, or `{ _tag: "Malformed", reason }`, which signs the token out (`Unauthenticated`), so a broken delegation never falls back to the person. Without the option every token stays a person, as before. `agentFromAct` reads the RFC 8693 `act` claim: `act.sub` is the agent, `act.name` its name and `sub` the person. No `act` claim is a person; an `act` that is not an object, has no `act.sub` starting with `agent:`, has a `name` that is not a non-empty string, or whose `sub` is no person id is malformed. Do not use it with Clerk, whose `act` claim marks impersonation by a person.

`SessionLive` refuses (`Unauthenticated`) a person subject that starts with `agent:`, an agent id without the `agent:` prefix, and an agent whose `forPerson` is empty, starts with `system:` or `agent:`. `Organisations.withMemberships` never adds a membership role to an agent: it holds only the roles in its own token. The stack has no approval step; an app gates an agent with its own rules.

Not built: MCP as an OAuth resource server (protected-resource metadata, the 401 `WWW-Authenticate` challenge, checking that the token's audience is this resource). Today an MCP client signs in with the same session token as the app's own clients, through whichever provider is plugged in.

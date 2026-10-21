# @house-rules/identity

Identity maps verified logins to ActorIds. It owns `(issuer, subject) -> actor_id` bindings and never links by email. An `Authenticator`, such as auth-jwt, verifies the token. Identity resolves the actor through storage or through a single-issuer subject rule.

```text
Identity.who(options).resolve(incoming)
  token source -> Authenticator.verify -> ActorResolver
    known login -> Actor
    unknown login -> FirstSignIn -> Actor
```

`Identity.who({ token, audience?, challenge? })` returns a `WhoSocket<Authenticator | ActorResolver | FirstSignIn>`. Exported `IdentityWhoOptions` describes those options. It returns an Actor, not request services. There is no grant callback; a way's May plug owns its permissions. Construction captures no request context or new-login hook, and verification runs once per resolution.

Mount `Identity.layerPostgres` with the shared SQL client, or `Identity.layerMemory`. Both fill `ActorResolver` too. Register the package in `migrations.json`. `Identity.subject({ issuer })` needs no table: it uses the subject as the ActorId for that issuer only. A foreign issuer is refused before the hook runs. `Identity.refuse` fills `FirstSignIn` for invite-only signup.

For open signup, acquire the module services and `bindIdentity(service)`, build `Runtime`, then acquire the hook. The hook captures that runtime, trace, watch and unit. It calls the app's system-start first-sign-in feature with `May.system`, system permissions and approval; it neither authenticates again nor builds another runtime. That feature creates the Person and calls `IdentityOperations.bindLogin` in one lifted unit. Hook failures map to `Refused`.

The browser-safe `./contract` door exports binding schemas, errors and `IdentityOperations.bindLogin`. `defineOperation` declares it; `bindIdentity` uses `bindOperation`. The operation is named `Identity.bindLogin`, requires `identity:bind`, has no edges and is transactional. It takes `{ issuer, subject, personId }`, binds the login and returns the ActorId. Person callers get forbidden `IdentityCallerDenied`. App features call this operation through declared edges. Only features are exposed.

Service methods remain `resolve`, `bind`, `unbind`, `bindingsOf` and `unbindAll`, with no Effect requirements. Writes require an open unit, never open one, and retain idempotent same-actor binding and conflict protection. Call `unbindAll` in the account-deletion unit.

Version 0.1.0 is prepared for its first release. Pin domain 0.1.0, application 0.2.0 and Effect 4.0.3 exactly. Published packages load built `dist/`; this workspace loads source. See [AGENTS.md](AGENTS.md) for refusal codes, mounting and tests.

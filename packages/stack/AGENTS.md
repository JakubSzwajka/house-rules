# @house-rules/stack

## What it does

Auth, access and reusable domain modules for apps built on Alchemy Domain (`@alchemy.run/domain` 2.0.0-beta.85, Effect 4.1.2). It ships the actor model (`Actor`, `person`, `system`, `CurrentActor`), permissions (`Permission`, `can`, `requirePermission`, `Forbidden`, `Roles`) and authentication (`AuthProvider`, `Session`, `SessionLive`, `devTokens`, `sessionClient`). Reusable modules join as namespace exports from the one door, `@house-rules/stack`. [DESIGN.md](DESIGN.md) maps every old house-rules concept to its replacement and holds the rules for each block.

## How an app mounts it

Spread a module's block lists into the app's own `Domain.Model`, beside the app's blocks, and provide the module's `handlers` Layer when it has one:

```ts
class App extends Domain.Model("App", {
  aggregates: [...Comments.aggregates, Booking],
  views: [...Comments.views, MyBookings],
}) {}
```

Wire authentication once, in the server package:

```ts
const Auth = SessionLive.pipe(
  Layer.provide(Layer.mergeAll(devTokens({ "ann-token": { subject: "ann", orgId: null, roles: ["member"] } }), Roles.layer({ member: [CommentsPermissions.write] }))),
);
```

- `AuthProvider` is the slot: `authenticate(headers)` returns `Option<Principal>` (`subject`, `orgId`, `roles`). `devTokens` fills it for tests and local play; Clerk or JWT providers fill it in production.
- `Roles.layer(definitions)` turns role names into permissions once per request. Roles never reach a `decide`; permissions do.
- `SessionLive` provides `CurrentActor` as a `Person` for every command or view that lists `middleware: [Session]`. No principal fails `Unauthenticated` (401). The `x-house-rules-via: agent` header marks the person as acting through an agent.
- Clients add the bearer token with `sessionClient(token)`.

## Fixed rules

- Every `decide` and every private view's `validate` starts with `yield* requirePermission(<Module>Permissions.x)`. It returns the actor or fails `Forbidden` (403), so list `Forbidden` in `rejects`.
- Object access (owner, member, holder) lives in the aggregate's state and is checked after the permission, with its own rejection.
- Policies and webhooks have no session. They act as a system actor with explicit grants: `.pipe(Effect.provideService(CurrentActor, system("digest", [NotesPermissions.read])))`. A system actor holds only what it is granted; it never borrows the author's roles.
- Events that record a change by someone carry `by: authorOf(actor)`.
- No storage ports, adapters, units of work or migrations. The platform stores events.

## Tests

Use `@effect/vitest` (`it.effect`, `it.live`) and `@alchemy.run/domain/Story`, never `Effect.run*`. Provide the actor with `Story.provide(CurrentActor, person("ann", { permissions: [...] }))`, and cover the permission holder, a person without it, the wrong owner and the system actor. Test the Api once end to end through `SessionLive`, `devTokens` and `Roles` over `Domain.InMemory`. The worked example is [src/access/tests/require-permission.test.ts](src/access/tests/require-permission.test.ts).

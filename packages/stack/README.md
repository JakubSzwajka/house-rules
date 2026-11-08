# @house-rules/stack

Auth, access and reusable domain modules for apps built on [Alchemy Domain](https://alchemy.run/domain). One package, one door: `import { Session, requirePermission } from "@house-rules/stack"`.

```sh
pnpm add --save-exact @house-rules/stack @alchemy.run/domain@2.0.0-beta.85 alchemy@2.0.0-beta.85 effect@4.1.2
```

## What is in it

| Area | Exports | Job |
| --- | --- | --- |
| Actor | `Actor`, `Person`, `System`, `person`, `system`, `authorOf`, `CurrentActor` | who is acting: a signed-in person or a named system actor, carried with each command |
| Access | `Permission`, `can`, `requirePermission`, `Forbidden`, `Roles` | permissions as `resource:action` strings; roles resolve to permissions once per request |
| Auth | `AuthProvider`, `Principal`, `Session`, `SessionLive`, `Unauthenticated`, `devTokens`, `credentialOf`, `sessionClient` | the Session middleware over a swappable provider slot |

Reusable modules are added as namespace exports. Each brings its blocks, its block lists for `Domain.Model`, its `<Module>Permissions` and an optional `handlers` Layer.

## Use it

A command checks its permission in `decide`:

```ts
class Bump extends Domain.Command("Bump", {
  target: CounterId,
  middleware: [Session],
  events: [Bumped],
  rejects: [Forbidden],
  reply: { total: Schema.Int },
}) {}

// in the aggregate
decide: {
  Bump: Effect.fn(function* (s) {
    const actor = yield* requirePermission("counters:bump");
    return [new Bumped({ by: authorOf(actor), total: s.total + 1 })];
  }),
},
```

The server provides `SessionLive` over an `AuthProvider` and `Roles.layer({...})`. See [AGENTS.md](AGENTS.md) for wiring and [DESIGN.md](DESIGN.md) for the rules every block follows.

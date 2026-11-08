# @house-rules/stack

Operating guide for agents working on an app built on the stack.

## What it does

Sign-in, permissions and reusable domain modules for apps on Alchemy Domain (`@alchemy.run/domain` 2.0.0-beta.85, Effect 4.1.2), all from one door, `@house-rules/stack`. [README.md](README.md) lists what is inside and walks through a new app step by step; [DESIGN.md](DESIGN.md) holds the design and the rules for every block. Each module documents its commands, permissions and rules in `src/<module>/README.md`. When docs and code disagree, the code and its tests win.

## How an app mounts it

### Compose modules into a Model

Spread each module's block lists beside your own blocks. Modules export only the kinds they have (`aggregates`, `views`, `policies`). The snippets named `Kitchen` and `Recipe` come from [src/tests/new-app.test.ts](src/tests/new-app.test.ts):

```ts
export class Kitchen extends Domain.Model("Kitchen", {
  aggregates: [...Notes.aggregates, Recipe],
  views: [...Notes.views],
}) {}
```

A module with policies brings a `handlers` Layer. Merge every module's `handlers` with your own into the one `App.layer(...)`, and provide the adapters they need. Adapted from [src/tests/compose.test.ts](src/tests/compose.test.ts), which hosts every module at once:

```ts
const Hosted = Everything.layer(
  Layer.mergeAll(Notifications.handlers, Contacts.handlers, Projects.handlers, WorkItems.handlers),
).pipe(
  Layer.provide(
    Layer.mergeAll(
      fromEnv({ schema: "app" }),
      Delivery.memoryEmail("app@example.test"),
      Delivery.memoryPush(),
      Contacts.memoryVerificationCodes(),
    ),
  ),
);
```

- The platform Layer stores the model. `fromEnv({ schema })` from `@house-rules/domain-postgres` picks Postgres or `Domain.InMemory` from `DOMAIN_STORE`; on Cloudflare use the Durable Object host. The model does not change.
- A model with no handlers takes `App.layer(Layer.empty)`.
- `Notifications` needs `Email` and `Push` adapters from `Delivery` (`consoleEmail`, `consolePush` locally), `Contacts` a `VerificationCodes` adapter, `Projects` the `Projects.projectsConfig(...)` middleware Layer and `WorkItems` `WorkItems.workflowConfig(...)`, both merged beside `SessionLive`.
- `Domain.verify(App)` must be `[]`. It reports duplicate event tags and duplicate aggregate, view or stream names across modules.

### Sign-in: Session, SessionLive, Roles, AuthProvider

- `AuthProvider` is the slot: `authenticate(headers)` returns `Option<Principal>` (`subject`, `orgId`, `roles`). Fill it with `devTokens({...})` for tests and local play, `clerk({ issuer, jwtKey?, authorizedParties? })` or `jwt({ key, issuer, ... })` in production. See [src/auth/README.md](src/auth/README.md).
- `Roles.layer(definitions)` maps role names to permissions once per request. Clerk organisation roles arrive as `org:<key>`; map those names too. Roles never reach a `decide`; permissions do.
- `SessionLive` needs `AuthProvider` and `Roles`, and provides `CurrentActor` as a `Person` to every command and view that lists `middleware: [Session]`. No principal fails `Unauthenticated` (401). A subject starting with `system:` is refused.
- Wire it once, in the server package, and host the model under it:

```ts
export const kitchenLive = <E, R>(auth: Layer.Layer<AuthProvider, E, R>) =>
  SessionLive.pipe(
    Layer.provide(Layer.mergeAll(auth, Roles.layer(KitchenRoles))),
    Layer.provideMerge(Kitchen.layer(Layer.empty)),
  );
```

- Clients send the bearer token with `sessionClient(token)`. An agent over MCP sends its user's token and acts as that user.
- With a provider that knows no organisations (JWT, dev tokens), `Organisations.withMemberships(provider)` adds the person's role in their active organisation.

## Fixed rules

### Commands check permissions in decide

```ts
    RenameRecipe: Effect.fn(function* (recipe, cmd) {
      const actor = yield* requirePermission(RecipePermissions.write);
      if (recipe._tag !== "Written") return yield* new NoSuchRecipe();
      if (authorOf(actor) !== recipe.owner) return yield* new NotRecipeOwner();
      if (recipe.title === cmd.title) return [];
      return [new RecipeRenamed({ by: authorOf(actor), title: cmd.title })];
    }),
```

- Every client-sent command lists `middleware: [Session]` and `Forbidden` in `rejects`, and its `decide` starts with `yield* requirePermission(...)`, which returns the actor or fails `Forbidden` (403).
- Object access (owner, member, holder) lives in the aggregate's state, checked after the permission, with its own rejection (`NotRecipeOwner`, `httpApiStatus: 403`).
- Private views list `middleware: [Session]` and check in `validate`: `requirePermission`, then any ownership rule, such as the key against `authorOf(actor)` in the booking example's `MyBookings`.
- Events that record a change by someone carry `by: authorOf(actor)`. Time comes from `decide`'s `{ now }`; ids come from the caller.

### Policies act as system actors with explicit grants

Policies, sagas and webhooks have no session. They provide a `system(name, permissions)` actor holding only what it is granted, never the author's roles:

```ts
export const billing = system("billing", [PaymentPermissions.settle]);
```

```ts
      yield* payments
        .send(source.id, command)
        .pipe(Effect.orDie, Effect.provideService(CurrentActor, billing));
```

The first is the booking example's `roles.ts`, the second its `BookingPayment` policy.

Commands only a policy sends still check a permission; the system actor holds it by explicit grant. Every grant is an owner decision. A module's README names the grants its own policies hold and the ones your policies need (for example `notifications:notify` to send `Notify`).

### Middleware order

Effect 4.1.2 runs a command's middleware from the **last** entry to the first, the reverse of what Alchemy's beta.85 docs say. A guard that reads the actor goes before `Session`:

```ts
middleware: [OrgOnly, Session],
```

Listed the other way the guard sees no actor. [src/auth/tests/middleware-order.test.ts](src/auth/tests/middleware-order.test.ts) pins the order.

### Event tags are unique across the app

Every event tag must be unique across every module an app composes. Prefix generic names with the module or aggregate (`EdgeRelated`, `NotificationDelivered`, `OrganisationMemberAdded`, `RecipeAdded`), never a bare `Added` or `Deleted`.

## Tests

Tests sit in `tests/` beside the code and use `@effect/vitest` (`it.effect`, `it.live`), never `Effect.run*`.

- One `Domain.verify(App)` test that expects `[]`.
- Stories (`@alchemy.run/domain/Story`) for every command's happy path and every rejection. Stories skip middleware, so provide the actor: `Story.provide(CurrentActor, person("ann", { permissions: [...] }))`. Cover the permission holder, a person without it, the wrong owner and a system actor. Stub external systems with `Story.make(App, { layer: Handlers, stub: [PaymentProvider] })`.
- Every policy reaction and every view's state after the events it folds.
- One Api test through `SessionLive`, `devTokens` and `Roles` over `platformForTests` from `@house-rules/domain-postgres` (a fresh Postgres schema per test, or `Domain.InMemory` with `DOMAIN_STORE=memory`), with `Api.clientInProcess` and `sessionClient(token)`. Read views with `{ atLeast: receipt }` after a write. Middleware is tested here, since stories skip it.

Worked examples: [src/tests/new-app.test.ts](src/tests/new-app.test.ts) (a whole small app), [src/access/tests/require-permission.test.ts](src/access/tests/require-permission.test.ts) and `examples/booking/packages/domain/src/tests` in the template.

## Checks

From the repo root, with the Node version in `.nvmrc`:

```sh
pnpm exec biome check --write <changed files>
pnpm check
pnpm test
```

Both `pnpm check` and `pnpm test` must exit 0. The pre-commit hook runs them; never bypass it.

# @house-rules/stack

Sign-in, permissions and reusable domain modules for apps built on [Alchemy Domain](https://alchemy.run/domain). An app models its backend as Alchemy aggregates, commands, events, views and policies; the stack adds who is acting (`CurrentActor`), what they may do (`requirePermission`, `Roles`), how they sign in (`Session` over a swappable `AuthProvider`: Clerk, any JWT issuer, or dev tokens) and ready modules such as comments, organisations or work items that an app spreads into its own `Domain.Model`. Everything comes through one door: `import { Session, requirePermission, Notes } from "@house-rules/stack"`.

[DESIGN.md](DESIGN.md) holds the design and the rules every block follows. [AGENTS.md](AGENTS.md) is the short operating guide for building an app on the stack.

## What is inside

| Part | Exports | Job |
| --- | --- | --- |
| Actor | `Actor`, `Person`, `Agent`, `System`, `Party`, `PartyId`, `PersonId`, `AgentId`, `person`, `agent`, `system`, `authorOf`, `partyOf`, `actingFor`, `CurrentActor` | who is acting: a signed-in person, an agent (its own party, working for one person) or a named system actor, carried with each command |
| Access | `Permission`, `can`, `requirePermission`, `Forbidden`, `Roles`, `RoleDefinitions` | permissions are `resource:action` strings; `Roles` turns role names into permissions once per request; `decide` checks them |
| Auth | `AuthProvider`, `Principal`, `AgentPrincipal`, `Session`, `SessionLive`, `Unauthenticated`, `sessionClient`, `credentialOf` | the `Session` RPC middleware over a provider slot; [auth README](src/auth/README.md) |
| Auth providers | `clerk`, `jwt`, `agentFromAct`, `AgentClaims`, `devTokens` | Clerk session tokens (v1 `org_id`/`org_role` and v2 `o.id`/`o.rol` claims), any JWT issuer (JWKS, PEM or HS256 secret), fixed tokens for tests and local play; each can sign an agent in |
| Target | `Target`, `TargetKey`, `targetKey` | `{ kind, id }` of an app's own object, shared by comments and notes |
| `Comments` | module | flat comments on a target, author edits, moderated deletes; [README](src/comments/README.md) |
| `Contacts` | module | email, phone and postal contacts per owner, primaries, verification by one-time code; [README](src/contacts/README.md) |
| `Delivery` | module | `Email` and `Push` external systems with memory and console adapters; [README](src/delivery/README.md) |
| `Notes` | module | immutable notes on a target; [README](src/notes/README.md) |
| `Notifications` | module | a person's inbox, preferences, quiet hours and delivery ledger over `Delivery`; [README](src/notifications/README.md) |
| `Organisations` | module | organisations, members and their roles, `withMemberships` for providers without organisations; [README](src/organisations/README.md) |
| `Projects` | module | projects with configurable statuses and unique slugs; [README](src/projects/README.md) |
| `Relations` | module | typed, directed edges between opaque nodes; [README](src/relations/README.md) |
| `WorkItems` | module | work items with an app-configured workflow, a priority, a due date, a person or agent holder and one level of children; [README](src/work-items/README.md) |

Each module is a namespace export. It brings its blocks, the block lists an app spreads into its model (`aggregates`, `views`, `policies`, only the kinds it has), its `<Module>Permissions` and, when it has policies, a `handlers` Layer.

## Install

Every pin is exact. Effect packages share 4.1.2; Alchemy packages share 2.0.0-beta.85.

```sh
pnpm add --save-exact @house-rules/stack @alchemy.run/domain@2.0.0-beta.85 alchemy@2.0.0-beta.85 effect@4.1.2
pnpm add --save-exact --save-dev @effect/vitest@4.1.2 vitest@5.0.1 typescript@7.0.2
```

Inside this template, workspace packages pin the stack as `"@house-rules/stack": "workspace:0.1.0"`, as [the booking domain's package.json](../../examples/booking/packages/domain/package.json) does. A server that runs on Node also adds `@effect/platform-node@4.1.2` and `@effect/platform-node-shared@4.1.2`; one that deploys to Cloudflare adds `@alchemy.run/cloudflare@2.0.0-beta.85`. Copy [the booking server's package.json](../../examples/booking/apps/server/package.json).

## Start a new app from scratch

Every snippet below is cut, unchanged, from [src/tests/new-app.test.ts](src/tests/new-app.test.ts), which compiles and passes with the rest of the package. In that file it is one file importing `../index.ts`; in your app it is split across the files named in each step and imports `@house-rules/stack`. The app is a kitchen: people own recipes, and anyone who cooks can leave notes on a recipe through the stack's `Notes` module.

### 1. Make the workspace

```sh
gh repo create my-app --private --clone --template JakubSzwajka/house-rules
cd my-app
corepack enable
pnpm install --frozen-lockfile
```

Make two workspace packages, shaped like the example: `packages/domain` (the model; it imports only `@alchemy.run/domain`, `effect` and `@house-rules/stack`) and `apps/server` (hosting, auth providers, routes). Copy their `package.json`, `tsconfig.json` and `vitest.config.ts` from `examples/booking/packages/domain` and `examples/booking/apps/server`, rename the packages, and point the server's dependency on the domain package at yours. Keep `examples/booking` until your app runs, then remove it and its roots from `eslint.config.mjs` and the other thin configs.

### 2. Permissions and your own aggregate

`packages/domain/src/permissions.ts`:

```ts
export const RecipePermissions = {
  write: "recipes:write",
} as const;
```

`packages/domain/src/recipe/recipe.id.ts`:

```ts
export const RecipeId = Schema.NonEmptyString.pipe(Schema.brand("RecipeId"));
export type RecipeId = typeof RecipeId.Type;
```

`packages/domain/src/recipe/add-recipe.command.ts` and `rename-recipe.command.ts` hold each command with the events and rejections only it uses. Every command a client sends lists `middleware: [Session]` and `Forbidden`:

```ts
export class AddRecipe extends Domain.Command("AddRecipe", {
  target: RecipeId,
  middleware: [Session],
  input: { title: Schema.NonEmptyString },
  events: [RecipeAdded],
  rejects: [Forbidden, RecipeExists],
}) {}

export class RenameRecipe extends Domain.Command("RenameRecipe", {
  target: RecipeId,
  middleware: [Session],
  input: { title: Schema.NonEmptyString },
  events: [RecipeRenamed],
  rejects: [Forbidden, NoSuchRecipe, NotRecipeOwner],
}) {}
```

The events carry `by` and the rejections carry their HTTP status (see the test file for `RecipeAdded`, `RecipeRenamed`, `RecipeExists`, `NoSuchRecipe`, `NotRecipeOwner` and the `Written` state). `packages/domain/src/recipe/recipe.aggregate.ts` decides them. `decide` checks the permission first, then the owner from its own state:

```ts
export class Recipe extends Domain.Aggregate("Recipe", {
  id: RecipeId,
  state: Schema.Union([Schema.TaggedStruct("Unwritten", {}), Written]),
  initial: { _tag: "Unwritten" },
  commands: [AddRecipe, RenameRecipe],
  decide: {
    AddRecipe: Effect.fn(function* (recipe, cmd) {
      const actor = yield* requirePermission(RecipePermissions.write);
      if (recipe._tag !== "Unwritten") return yield* new RecipeExists();
      return [
        new RecipeAdded({
          by: authorOf(actor),
          owner: PersonId.make(authorOf(actor)),
          title: cmd.title,
        }),
      ];
    }),
    RenameRecipe: Effect.fn(function* (recipe, cmd) {
      const actor = yield* requirePermission(RecipePermissions.write);
      if (recipe._tag !== "Written") return yield* new NoSuchRecipe();
      if (authorOf(actor) !== recipe.owner) return yield* new NotRecipeOwner();
      if (recipe.title === cmd.title) return [];
      return [new RecipeRenamed({ by: authorOf(actor), title: cmd.title })];
    }),
  },
  evolve: {
    RecipeAdded: (_, e) => ({ _tag: "Written" as const, owner: e.owner, title: e.title }),
    RecipeRenamed: (s, e) => (s._tag === "Written" ? { ...s, title: e.title } : s),
  },
}) {}
```

### 3. The model, with a stack module, and its Api

`packages/domain/src/kitchen.model.ts` spreads the module's block lists beside your own. A module with policies also brings `handlers`; you would pass `Layer.mergeAll(Module.handlers, YourHandlers)` to `Kitchen.layer(...)`.

```ts
export class Kitchen extends Domain.Model("Kitchen", {
  aggregates: [...Notes.aggregates, Recipe],
  views: [...Notes.views],
}) {}
```

`packages/domain/src/kitchen.api.ts` names what clients may send and read. Listing `aggregates: []` and `streams: []` keeps raw reads off the wire:

```ts
export class KitchenApi extends Domain.Api("KitchenApi", {
  model: Kitchen,
  commands: ["AddRecipe", "RenameRecipe", "AddNote"],
  views: ["NotesOnTarget"],
  aggregates: [],
  streams: [],
}) {}
```

### 4. Roles

`packages/domain/src/roles.ts` grants permissions to role names. Clerk turns an organisation role into `org:<key>`, so map those names too; a Clerk user with no active organisation has no roles (the booking server's `everyoneIsMember` in [auth.ts](../../examples/booking/apps/server/src/auth.ts) shows one way to give them a base role):

```ts
const cook = [RecipePermissions.write, Notes.NotesPermissions.write, Notes.NotesPermissions.read];

export const KitchenRoles = {
  cook,
  "org:member": cook,
  "org:admin": cook,
  guest: [],
} satisfies RoleDefinitions;
```

### 5. Stories

`packages/domain/src/tests/recipe.test.ts`. A Story runs the model in memory without middleware, so you provide the actor yourself. Cover the permission holder, a person without it, the wrong owner and a system actor:

```ts
const story = Story.make(Kitchen, {});
const ann = person("ann", { roles: ["cook"], permissions: KitchenRoles.cook });
const bob = person("bob", { roles: ["cook"], permissions: KitchenRoles.cook });
const soup = Recipe.ref(RecipeId.make("soup"));
const added = new RecipeAdded({ by: "ann", owner: PersonId.make("ann"), title: "Soup" });
```

```ts
  it.effect("a cook adds a recipe they then own", () =>
    story(
      Story.provide(CurrentActor, ann),
      Story.when(soup, new AddRecipe({ title: "Soup" })),
      Story.then(soup, added),
    ),
  );

  it.effect("only the owner renames it", () =>
    story(
      Story.given(soup, added),
      Story.provide(CurrentActor, bob),
      Story.when(soup, new RenameRecipe({ title: "Stew" })),
      Story.rejected(new NotRecipeOwner()),
    ),
  );
```

Add `it("is well defined", () => expect(Domain.verify(Kitchen)).toEqual([]))` to every model's tests.

### 6. Sign-in: SessionLive, Roles, dev tokens or Clerk

`apps/server/src/auth.ts` picks the provider: Clerk when `CLERK_ISSUER` is set, dev tokens otherwise. Declare `CLERK_ISSUER` in `.env.schema`.

```ts
export const DEV_TOKENS: Readonly<Record<string, Principal>> = {
  "ann-token": { subject: "ann", orgId: null, roles: ["cook"] },
  "bob-token": { subject: "bob", orgId: null, roles: ["cook"] },
  "gus-token": { subject: "gus", orgId: null, roles: ["guest"] },
  "claude-token": {
    subject: "claude",
    orgId: null,
    roles: ["kitchen-agent"],
    agent: { name: "Claude", forPerson: "ann" },
  },
};

export const AuthFromEnv = Layer.unwrap(
  Effect.gen(function* () {
    const issuer = yield* Config.option(Config.NonEmptyString("CLERK_ISSUER"));
    return Option.isSome(issuer) ? clerk({ issuer: issuer.value }) : devTokens(DEV_TOKENS);
  }),
);
```

`apps/server/src/kitchen-live.ts` hosts the model and serves `Session` over any provider. The platform Layer is provided last: `fromEnv` from `@house-rules/domain-postgres` on Node (Postgres, or `Domain.InMemory` with `DOMAIN_STORE=memory`), Cloudflare Durable Objects on Cloudflare. Tests provide `platformForTests` or `Domain.InMemory`:

```ts
export const kitchenLive = <E, R>(auth: Layer.Layer<AuthProvider, E, R>) =>
  SessionLive.pipe(
    Layer.provide(Layer.mergeAll(auth, Roles.layer(KitchenRoles))),
    Layer.provideMerge(Kitchen.layer(Layer.empty)),
  );
```

### 7. One Api test, end to end

`apps/server/src/tests/kitchen-api.test.ts` goes through the real `Session`, the provider and `Roles`. It reads the view `atLeast` the receipt of the write, so it never races the projection:

```ts
  it.live("serves the Api through Session, dev tokens and Roles", () =>
    Effect.gen(function* () {
      const as = (token: string) =>
        KitchenApi.clientInProcess.pipe(Effect.provide(sessionClient(token)));
      const ann = yield* as("ann-token");
      const id = RecipeId.make("soup");
      yield* ann.AddRecipe(id, { title: "Soup" });
      const target = { kind: "recipe", id };
      const noted = yield* ann.AddNote(Notes.NoteId.make("n-1"), { target, body: "Less salt" });
      const notes = yield* ann.NotesOnTarget.get(targetKey(target), { atLeast: noted });
      expect(notes?.notes.map((note) => note.body)).toEqual(["Less salt"]);
      const bob = yield* as("bob-token");
      const notOwner = yield* bob.RenameRecipe(id, { title: "Stew" }).pipe(Effect.flip);
      expect(notOwner._tag).toBe("NotRecipeOwner");
      const gus = yield* as("gus-token");
      const forbidden = yield* gus
        .AddRecipe(RecipeId.make("pie"), { title: "Pie" })
        .pipe(Effect.flip);
      expect(forbidden._tag).toBe("Forbidden");
      const stranger = yield* as("nope");
      const anonymous = yield* stranger.AddRecipe(id, { title: "Soup" }).pipe(Effect.flip);
      expect(anonymous._tag).toBe("Unauthenticated");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        kitchenLive(AuthFromEnv).pipe(
          Layer.provide(Domain.InMemory),
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({}))),
        ),
      ),
    ),
  );
```

The empty `ConfigProvider` pins the test to dev tokens whatever the shell exports.

### 8. Serve it locally

Copy the booking server's two hosting files and swap the names; nothing else changes:

- [routes.ts](../../examples/booking/apps/server/src/routes.ts): `KitchenApi` in place of `BookingApi` serves plain HTTP with OpenAPI at `/openapi.json`, Effect RPC at `/rpc` and MCP at `/mcp`.
- [local.ts](../../examples/booking/apps/server/src/local.ts): `kitchenLive(AuthFromEnv).pipe(Layer.provide(fromEnv({ schema: "kitchen" })))` in place of `bookingLive(...)`, served by `NodeHttpServer` on `PORT` (default 3000). `fromEnv` from `@house-rules/domain-postgres` keeps the data in Postgres (`pnpm db:up`), or in memory with `DOMAIN_STORE=memory`.
- Optional: [cli.ts](../../examples/booking/apps/server/src/cli.ts) for a CLI over `/rpc`, [booking-worker.ts](../../examples/booking/apps/server/src/booking-worker.ts) and [alchemy.run.ts](../../examples/booking/apps/server/alchemy.run.ts) to deploy on Cloudflare Durable Objects, [local-http.test.ts](../../examples/booking/apps/server/src/tests/local-http.test.ts) for an HTTP smoke test.

```sh
cd apps/server && node src/local.ts
curl localhost:3000/AddRecipe -H 'authorization: Bearer ann-token' \
  --json '{"target":"soup","input":{"title":"Soup"}}'
```

Then run `pnpm check` and `pnpm test` from the root; both must exit 0 before a commit.

## Next

- Add a policy: it has no session, so it acts as a system actor with explicit grants. See `BookingPayment` in [the booking example](../../examples/booking/packages/domain/src/payment/booking-payment.policy.ts) and [AGENTS.md](AGENTS.md).
- Read [DESIGN.md](DESIGN.md) before writing a new module.
